#!/usr/bin/env python3
"""Build a local, hash-verified certificate import plan. Never uploads or sends mail."""
import argparse
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOWNLOADS = Path.home() / 'Downloads'


def read(path):
    return json.loads((ROOT / path).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scan-missing', action='store_true', help='Find moved PNGs by their verified content hashes')
    args = parser.parse_args()
    rows = []

    def add(source_id, name, email, category, role, title, digest, candidates, council='', registration='', verified=True):
        path = next((p for p in candidates if p.is_file()), candidates[0])
        rows.append(dict(sourceId=source_id, name=name, email=email.strip().lower(), category=category,
                         role=role, title=title, sha256=digest, file=str(path), councilNumber=council,
                         registrationNumber=registration, identityVerified=verified, published=True))

    for r in read('tools/certificates/delegate-delivery-manifest.json')['recipients']:
        relative = Path(r['certificate'])
        add('conference-' + r['id'], r['name'], r['email'], 'conference', 'Delegate', 'AOACON 2026 Conference',
            r['certificate_sha256'], [DOWNLOADS / relative, DOWNLOADS / 'Delegates and faculties conference Certificates' / relative],
            r['medical_council_number'], verified=r['image_identity_verified'])
    faculty = {r['id']: r for r in read('reports/faculty-certificate-records.json')}
    for a in read('reports/faculty-export-check.json')['records']:
        r = faculty[a['id']]
        path = Path(a['file'])
        add('conference-' + r['id'], r['name'], r['email'], 'conference', 'Faculty', 'AOACON 2026 Conference',
            a['sha256'], [path, DOWNLOADS / 'Delegates and faculties conference Certificates' / path.parent.name / path.name],
            r['medical_council_number'], verified=all(a[k] for k in ['nameMatched', 'facultyMatched', 'creditsMatched']))
    correction = read('reports/faculty-delivery/bharti-correction.json')
    add('conference-' + correction['id'], correction['name'], correction['email'], 'conference', 'Faculty',
        'AOACON 2026 Conference', correction['certificate_sha256'], [Path(correction['file'])])
    for category, title in [('critical-incidents', 'Critical Incidents in Obstetric Anaesthesia'),
                            ('pocus', 'Obstetric PoCUS Workshop'), ('maternal', 'Maternal Collapse & Resuscitation'),
                            ('labour', 'Labour Analgesia Workshop'), ('occc', 'AOA Certified Obstetric Critical Care Course')]:
        checks = read(f'tools/certificates/{category}-checks.json')
        for r in read(f'reports/{category}-certificate-records.json'):
            a = checks['images'][r['reference']]
            assert all(a[k] == r[k] for k in ['name', 'email', 'role', 'page']), 'Mapping mismatch: ' + r['reference']
            add(category + '-' + r['reference'], r['name'], r['email'], category, r['role'].title(), title,
                a['sha256'], [Path(a['file'])], r['council_number'],
                verified=all(a[k] for k in ['name_matched', 'role_matched', 'workshop_matched']))
    for r in read('tools/certificates/delivery-manifest.json')['recipients']:
        add('presentation-' + r['id'], r['name'], r['email'], 'presentation', r['category'], r['title'],
            r['certificate_sha256'], [DOWNLOADS / 'EP and RP' / r['certificate']], registration=r.get('registration_id', ''),
            verified=r['image_identity_verified'])
    video_evidence_file = ROOT / 'reports/certificate-portal/video-revalidation.json'
    video_evidence = {r['sourceId']: r for r in json.loads(video_evidence_file.read_text())['records']} if video_evidence_file.exists() else {}
    for r in read('tools/certificates/video-award-manifest.json')['recipients']:
        evidence = video_evidence.get('video-award-' + r['id'])
        digest = r['certificate_sha256']
        if evidence and all(evidence.get(k) == r[k] for k in ['name', 'email', 'title']) and evidence.get('previousSha256') == digest and all(evidence.get(k) for k in ['nameMatched', 'titleMatched', 'awardMatched']):
            digest = evidence['sha256']
        add('video-award-' + r['id'], r['name'], r['email'], 'video-award', 'Video Award', r['title'],
            digest, [DOWNLOADS / 'AOACON 2026 — Approved Video Awards — 4 Certificates' / r['file']],
            verified=r['image_identity_verified'])
    def identity(row):
        name = re.sub(r'^dr\.?\s*', '', row['name'].lower())
        return (row['email'], re.sub(r'[^a-z0-9]', '', name))
    faculty_identities = {identity(r) for r in rows if r['category'] == 'conference' and r['role'] == 'Faculty'}
    registrations = {}
    for r in rows:
        if r['registrationNumber']:
            registrations.setdefault(r['email'], set()).add(r['registrationNumber'])
    for r in rows:
        if r['category'] == 'conference' and r['role'] == 'Delegate' and identity(r) in faculty_identities:
            r['published'] = False
            r['publicationNote'] = 'Conference faculty certificate supersedes delegate certificate for this person.'
        if not r['registrationNumber'] and len(registrations.get(r['email'], [])) == 1:
            r['registrationNumber'] = next(iter(registrations[r['email']]))
    missing = {r['sha256'] for r in rows if not Path(r['file']).is_file()}
    if missing and args.scan_missing:
        found = {}
        for p in DOWNLOADS.rglob('*.png'):
            try:
                digest = sha(p)
                if digest in missing:
                    found[digest] = p
                    if len(found) == len(missing): break
            except OSError:
                continue
        for r in rows:
            if not Path(r['file']).is_file() and r['sha256'] in found:
                r['file'] = str(found[r['sha256']])
    issues = []
    for r in rows:
        p = Path(r['file'])
        reason = None
        if not r['identityVerified']: reason = 'Image identity was not verified'
        elif not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', r['email']): reason = 'Invalid email'
        elif not p.is_file(): reason = 'File missing'
        elif sha(p) != r['sha256']: reason = 'Image hash differs from verified certificate'
        if reason: issues.append(dict(sourceId=r['sourceId'], name=r['name'], file=r['file'], reason=reason))
    assert len({r['sourceId'] for r in rows}) == len(rows)
    output = ROOT / 'reports/certificate-portal'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'import-plan.json').write_text(json.dumps({'version': 1, 'records': rows, 'issues': issues}, indent=2) + '\n')
    counts = {c: sum(r['category'] == c for r in rows) for c in sorted({r['category'] for r in rows})}
    (output / 'readiness.json').write_text(json.dumps({'total': len(rows), 'byCategory': counts, 'issues': issues}, indent=2) + '\n')
    print(json.dumps({'total': len(rows), 'byCategory': counts, 'issues': issues}, indent=2))
    print('LOCAL PLAN ONLY. No uploads, database writes or emails.')


if __name__ == '__main__':
    main()
