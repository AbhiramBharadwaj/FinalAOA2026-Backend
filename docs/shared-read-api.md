# Shared database read API

This API provides read-only business records across the database. It does not expose arbitrary collections, passwords, reset tokens, documents, payment identifiers, or internal notes. It includes attendee names, email addresses and phone numbers; share its key only with the intended recipient.

## Enable

Generate a separate key with `openssl rand -hex 32`. Set `SHARED_READ_API_KEY` in the backend environment to that value and restart the backend. Missing keys or keys shorter than 32 characters disable access with HTTP 503. Production CI appends `/home/ubuntu/aoa-data/shared-read-api.env` to the generated `.env`. Keep only `SHARED_READ_API_KEY=<key>` in this file, owned by ubuntu with mode 600, so deployments preserve access without committing secrets.

The key is a separate credential from database passwords and user login tokens. Rotate or remove it to revoke access. Do not commit it or include it in URLs.

## Read

```bash
read -s AOA_SHARED_KEY
export AOA_SHARED_KEY
curl --fail-with-body 'https://api.aoacon2026.com/api/shared/registrations?page=1&limit=50' \
  -H "Authorization: Bearer $AOA_SHARED_KEY"
unset AOA_SHARED_KEY
```

Paste the key at the `read` prompt. For Bash use `read -s AOA_SHARED_KEY`; for Zsh use `read -s 'AOA_SHARED_KEY?API key: '`.

Supported parameters: `page` (default 1), `limit` (default 50, maximum 100), and optional `paymentStatus` (`PAID`, `PENDING`, `FAILED`). Responses contain `data` and `pagination` with `page`, `limit`, `total`, and `totalPages`. Registrations are sorted by database ID. Pagination is not a snapshot; totals can change as registrations arrive.

Each row includes registration number/type, payment status, booking phase, workshop/course/membership selections, accompanying count, timestamps, and an `attendee` object (name, email, phone, role, institute/hospital, designation, profile-complete flag). Deleted attendees appear as `null`.

Requests are limited to 60 per minute per IP and responses have `Cache-Control: no-store`. Missing/incorrect credentials return 401. Invalid queries return 400. Unsupported routes or write methods return 405 after authentication. This endpoint never writes to the database.


## Resources

`GET /api/shared` lists supported resources. Each endpoint supports `page` and `limit`:

- `/api/shared/registrations` — selections, totals, payment status, attendee
- `/api/shared/profiles` — personal/contact/profile details and completion status
- `/api/shared/payments` — amounts, currency, method, status, timestamps and related record IDs
- `/api/shared/accommodations` — properties, capacity, rates and booking windows
- `/api/shared/accommodation-bookings` — stays, guests, charges and booking/payment status
- `/api/shared/abstracts` — submission and poster metadata, review status and comments
- `/api/shared/videos` — submission metadata and review status
- `/api/shared/attendance` — registration ID, scan totals and scan times/locations/counts
- `/api/shared/faculty` — faculty details and CV metadata/status
- `/api/shared/feedback` — ratings, comments and suggestions

Rows include `id` for cross-referencing. Registrations and accommodation bookings accept `paymentStatus`. Passwords, OTPs, reset/upload tokens, attendance QR payloads, document paths/contents, provider payment IDs/signatures, admin accounts and internal notes are excluded. Related record IDs let consumers join datasets without credentials to the database.
