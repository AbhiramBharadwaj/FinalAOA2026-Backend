# AOACON 2026 welcome emails

Run from the backend directory. The existing `.env` database and Resend/Zoho configuration are used. No credentials need to be entered in the command.

Preview an inclusive registration-number range (no sending or database writes):

```sh
node scripts/send-registration-welcome.js --from AOA2026-0001 --to AOA2026-0100
```

Send that range:

```sh
node scripts/send-registration-welcome.js --from AOA2026-0001 --to AOA2026-0100 --send
```

Numeric bounds such as `--from 1 --to 100` also work. Bounds refer to the registration number suffix, not attendee count; gaps are allowed and both online/import numbers are included. To select all existing numbers:

```sh
node scripts/send-registration-welcome.js --from 1 --to 99999
node scripts/send-registration-welcome.js --from 1 --to 99999 --send
```

Only `PAID` conference registrations qualify, including complimentary registrations. Pending/failed registrations are reported and skipped. Each message contains the attendee's name, registration ID, package, their existing entry QR as an inline PNG attachment, and `assets/AOACON 2026  Scientific Program.pdf` as a PDF attachment. No invoice, payment amount, or faculty category is included.

The programme sentence is: **The scientific programme is attached** for your reference, with details of the sessions and schedule.

A random 8–10 second pause occurs after each accepted email before the next one. Existing provider routing can add time for quota checks/retries. A full batch of 771 takes at least 103–129 minutes of pauses, plus delivery time. Keep the terminal running.

Campaign-prefixed records in the existing `counters` collection track each attempt (no new collection is created) under campaign `aoacon2026-welcome-scientific-programme-v1`. Rerunning the same or overlapping ranges skips already accepted emails, including sends from other machines using this database. Previous faculty invitations belong to a different flow and do not prevent this welcome message.

Press Ctrl+C once to stop after the current email. Rerun to resume. Uncertain or failed sends stop the run and remain blocked for provider review, to avoid accidental duplicates. A provider acceptance is not proof of inbox delivery. Never delete attempt records merely to force a retry without checking provider logs.

An alternate PDF may be supplied with `--pdf '/absolute/path/programme.pdf'`. Its hash is recorded per attempt. Changing the PDF does not resend this campaign to earlier recipients automatically.

Missing/invalid recipients or missing/inactive QR records stop preflight before any messages are sent. The script does not create users, registrations, QR records, or payment records.
