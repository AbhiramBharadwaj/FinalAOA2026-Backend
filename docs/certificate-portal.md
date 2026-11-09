# AOACON certificate portal — local review draft

The public portal is served by the existing Express backend at `/certificates/`. The organiser workspace is `/certificates/admin.html`, using the existing administrator email and password. It is not yet linked from the main frontend or deployed.

## Review locally without sending anything

From this backend directory:

```sh
node scripts/preview-certificate-portal.js
```

Open http://127.0.0.1:4177/certificates/ and search `Ananya`. This preview uses fictitious records. Search and the query form can be exercised; sending, downloads, administrator login and database writes are disabled. Stop with Ctrl+C.

Screenshots: `reports/certificate-portal/desktop-preview.png` and `mobile-preview.png`.

## Included behaviour

- Conference, the five workshops, paper/poster presentations and video awards. Nursing is excluded.
- Search by name, exact registration number or exact medical council number; no OTP.
- Download approved existing Canva exports through private storage links expiring after two minutes.
- Email a certificate to an address entered by the visitor without changing registration details.
- Explicit no-record result and a query form for missing records, name/role/workshop corrections and email issues. No WhatsApp handoff.
- Queries receive a reference. Organisers save New / In review / Resolved status, a response and history, then explicitly email the saved response.
- Organisers can upload an approved certificate for a missing record, replace a corrected file, change contact details, or hide a record. Name or role changes require a replacement certificate image; the portal does not redraw Canva files.
- Certificate requests use request IDs, per-IP limits and a one-minute per-certificate sending cooldown. Provider timeouts are recorded as unknown rather than automatically retried.
- Public responses exclude stored email addresses, council numbers, storage keys and organiser notes. As requested, search and downloads themselves require no identity verification.
- Different names sharing an inbox remain separate. Name variants may appear as separate matches rather than being merged automatically.

## Verified local source plan

```sh
python3 scripts/prepare-certificate-portal.py
node scripts/import-certificate-portal.js
```

Both commands above are offline: no uploads, database writes or emails. The plan has 1,340 certificate records, including superseded conference delegate records hidden where a matching faculty certificate exists. This is not a count of unique people or previously delivered emails.

| Category | Records |
| --- | ---: |
| Conference delegate/faculty | 843 |
| Critical Incidents | 51 |
| Obstetric PoCUS | 66 |
| Maternal Resuscitation | 60 |
| Labour Analgesia | 70 |
| Certified Critical Care | 75 |
| Paper/poster presentation | 171 |
| Video awards | 4 |

Files are checked against the prior identity-verified hashes and mappings. The four recently downloaded video exports were revalidated using macOS Vision: exact normalized names, titles and award wording matched the approved manifest; their updated hashes and OCR evidence are in `reports/certificate-portal/video-revalidation.json`. Replacing any file later makes validation fail until it is checked again.

Keep the reports and manifests private. They contain personal data and local paths. Only `public/certificates/` is served as static content.

## Storage and activation — after draft review

The certificates must be copied to private cloud storage before visitors can access them while this Mac is offline. This implementation reuses the backend's Cloudflare R2 integration for both files and metadata. No MongoDB collections are used for the portal. It stores the approved exports unchanged, with SHA-256 integrity checks for emailed attachments.

Set these variables in the intended backend environment; do not put credentials into frontend code:

```text
CERTIFICATE_BUCKET_NAME=<private R2 bucket>
R2_ENDPOINT=<R2 S3 endpoint>  # alternatively R2_ACCOUNT_ID
R2_ACCESS_KEY_ID=<access key>
R2_SECRET_ACCESS_KEY=<secret key>
CERTIFICATE_PORTAL_ENABLED=false
```

`R2_PRIVATE_BUCKET_NAME` is accepted if `CERTIFICATE_BUCKET_NAME` is unset. No public-bucket fallback is used. Keep public bucket access disabled and preserve the backend's existing email configuration for `info@aoacon2026.com`.

When the local plan and draft are approved, the explicit import command is:

```sh
node scripts/import-certificate-portal.js --apply
```

First run `node scripts/upload-certificate-portal.js` to upload files. The import command then writes the private Cloudflare lookup index. It does not send emails. Re-running preserves organiser corrections and uses stable source IDs. It does not delete existing records. The existing registration database remains unchanged. Query records, correction history, email request IDs and sending cooldowns are stored as private R2 JSON objects. Conditional writes prevent concurrent edits from overwriting each other and duplicate email attempts.

Before setting `CERTIFICATE_PORTAL_ENABLED=true`, review the imported records with administrator access, verify a signed download and an explicitly authorised sample email, then link the portal from the main website. The feature defaults off; a local preview does not activate production.

The organiser can then handle correction requests within the portal. A provider-accepted email is not proof of delivery; reconcile unknown attempts with provider records before manually resending.

## Announcement draft

**AOACON 2026 — E-Certificates**

Dear Delegates and Faculty Members,

Your conference, workshop, paper/poster presentation and video-award certificates are available through the AOACON 2026 certificate portal.

**Certificate portal:** [insert approved live URL]

Search using your name, registration number or medical council number. You may download your certificate or have it sent to your preferred email address.

If a certificate is missing or any detail needs correction, please use **Report a correction / Submit a query** in the portal and include your remarks. The organising team will review your request and email you an update.

Regards,  
**AOACON 2026 Organising Committee**

Conditional write reference: [Cloudflare R2 consistency and atomic conditional writes](https://developers.cloudflare.com/r2/reference/consistency/).
