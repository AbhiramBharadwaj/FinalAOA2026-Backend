# AOACON 2026 project wrap-up

The conference is closed. Keep historical records view-only and continue certificate delivery and organiser support.

## Active services

- Certificate search, download, email and correction queries, including organiser uploads and responses.
- Existing account/admin login and password recovery.
- Historical record lookup and authenticated read-only exports.
- MongoDB for accounts, historical records and organiser authentication.
- Private Cloudflare R2 certificate files, metadata, queries and delivery history.
- Email providers, backend hosting, TLS/domain renewal, monitoring and upload storage.
- Signed payment callbacks for transactions already taken. Retain reconciliation/refund records and tools until financial closeout is confirmed.

The event-read-only middleware blocks registration, payment creation, bookings, submissions, check-in changes and feedback writes. Certificate support is explicitly allowed.

## Retired automation

- Registration Google Sheets sync: CLI rejects execution; scheduler runner exits without syncing; installer rejects new cron installation.
- Faculty CV sync: CLI rejects execution before fetching the sheet or connecting to MongoDB.
- Deployment removes only the cron entry tagged `# aoa-registration-sheet-sync`, preserving unrelated jobs.

Historical source/import logic is retained for reference. Retirement does not delete historical sheets, files or database records. One-off campaign, seed, migration and backfill scripts must not be scheduled or run as routine operations.

## Deployment and verification

Deploy through the existing master workflow. It verifies private certificate metadata and restarts the existing backend. Check the workflow result before treating production as updated.

On the deployment host, verify `crontab -l` no longer contains the tagged registration sync entry. Check other externally configured jobs or Apps Script triggers separately; the repository cannot enumerate or retire external schedulers automatically.

Run `npm test` for regression checks and `node scripts/system-health-check.js` for read-only live checks. The live checks send no emails and expect HTTP 403 for closed event writes. Certificate delivery/correction tests use test doubles rather than emailing real attendees.

## Archive and unresolved closeout

- A private MongoDB logical dump and checksum were created on 13 November 2026 under ignored `backups/`. Archive parsing passed a restore dry run; an isolated restore was not performed.
- The requested GitHub backup upload remains unresolved because the selected repository is public. Keep the raw database archive out of source control; choose private storage or encryption before uploading.
- MongoDB backups do not cover R2 certificate files, metadata, queries, correction history, delivery state, or local/server uploads. Preserve these separately before retiring any storage.
- Do not cancel MongoDB, R2, email, hosting or domains while certificate services and record lookup depend on them.
- No records, buckets, credentials, payment integrations or infrastructure are deleted by this wrap-up.

Certificate support remains an ongoing responsibility until the organiser closes outstanding corrections and confirms final delivery.
