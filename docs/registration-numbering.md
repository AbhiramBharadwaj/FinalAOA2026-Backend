# Registration numbering

Online registrations use `registrationNumber` and continue through AOA2026-0600.
Manual/import registrations use `registrationImportNumber`, initially 600, so the
first import is AOA2026-0601. Imports never advance the online counter.

Once online allocations exceed 0600, both paths allocate above the highest
registered or reserved ID and counter. A shared transactional lock serializes
allocation. Unique reservation records in the existing counters collection keep
an allocated ID from being reused while its registration save is still in flight.
Failed online saves may leave reserved gaps; these must not be recycled blindly.

New manual registrations should set `isManualRegistration: true` and allow the
Registration model to assign the number. Historical gap requests can use
`document.$locals.preferredRegistrationSeq`. Explicit IDs are checked for conflicts;
unissued IDs through 0600 cannot be assigned to imports.

## Setup and deployment

Run `node scripts/initialize-registration-numbering.js` to inspect the state.
Run it with `--apply` to initialize missing counters and the shared lock. It is
idempotent and does not create attendee records, change existing IDs, or send email.
The counters collection must have its existing unique `name` index.

Deploy the updated backend before running an import. The previous backend still
uses a single counter, so mixing old and new allocation code is unsupported.
Do not use old import scripts that directly advance `registrationNumber`.

The admin counter endpoint keeps its existing `counter`, `maxUsed`, and
`suggestedNext` fields, and adds both counters and both next IDs. `source=import`
selects the import cursor for GET; PUT accepts `{ "source": "import", "seq": 600 }`.
Omitting `source` selects online. Counters cannot be rewound below their allocation.
Manual availability returns `reservedForOnlineNumbers` separately from used IDs.

Existing attendee profiles, registrations, badges, and QR payloads are unchanged.
