import { normalizeCertificateName } from './certificatePortal.js';
const canonical = value => String(value || '').trim().toLowerCase();
export function buildCertificateQueryContext(query, certificates, otherQueries, deliveries, evidence = {}) {
  const selected = certificates.find(c => c.publicId === query.certificateId);
  const contactEmails = new Set([canonical(query.email), canonical(selected?.email)].filter(Boolean));
  const name = normalizeCertificateName(query.name).replace(/\s/g, '');
  const registration = canonical(query.registrationNumber);
  const matched = certificates.flatMap(c => {
    const reasons = [];
    if (c.publicId === query.certificateId) reasons.push('Selected in this query');
    if (contactEmails.has(canonical(c.email))) reasons.push('Matching contact email');
    if (registration.length >= 3 && canonical(c.registrationNumber) === registration) reasons.push('Matching registration number');
    if (registration.length >= 3 && canonical(c.councilNumber) === registration) reasons.push('Matching council number');
    const sameName = name.length >= 3 && normalizeCertificateName(c.name).replace(/\s/g, '') === name;
    if (!reasons.length && sameName) reasons.push('Same full name — verify identity');
    if (!reasons.length) return [];
    const source = evidence[c.sourceId] || {};
    return [{ id: c.publicId, sourceId: c.sourceId, name: c.name, email: c.email, role: c.role, title: c.title,
      category: c.category, contentType: c.contentType, registrationNumber: c.registrationNumber, councilNumber: c.councilNumber,
      published: c.published, matchReasons: reasons, nameDiffers: !sameName, possibleMatch: reasons.every(r => r.startsWith('Same full name')),
      creditHours: source.creditHours || '', creditWording: source.creditWording || '', eventDates: source.eventDates || '',
      sourceFile: source.sourceFile || '', sourceRow: source.sourceRow || '',
      historicalEmails: source.historicalEmails || [], changes: c.history || [] }];
  });
  const ids = new Set(matched.map(c => c.id));
  return {
    selectedCertificateId: query.certificateId || '', eventCategory: query.eventCategory || 'unspecified',
    certificates: matched,
    emailRequests: deliveries.filter(d => ids.has(d.certificateId)).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    previousQueries: otherQueries.filter(q => q.reference !== query.reference && (contactEmails.has(canonical(q.email)) || (q.certificateId && ids.has(q.certificateId))))
      .map(q => ({ reference: q.reference, name: q.name, issue: q.issue, remarks: q.remarks, status: q.status, resolution: q.resolution, createdAt: q.createdAt })),
    note: 'Matches show approved certificate records, not independent proof of attendance. Provider acceptance does not confirm inbox delivery. Name-only matches require identity review.',
  };
}
