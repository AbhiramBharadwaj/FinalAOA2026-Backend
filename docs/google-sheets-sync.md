# Refresh the AOACON spreadsheet from the terminal

Target: https://docs.google.com/spreadsheets/d/12GRQlhlcViFTK4y8od9y_YuV3hTg1yP1czvOjrV9ljY/edit

The script refreshes six tabs from the database:

1. Offline List — every PAID registration, including ₹0 complimentary registrations, and embedded scannable QR images.
2. Labour Analgesia
3. Critical Incidents in Obstetric Anaesthesia
4. POCUS in Obstetrics
5. Maternal Resuscitation
6. AOA Certified Obstetric Critical Care Course

The five candidate tabs contain registration ID, name, email, phone, membership category, institute, designation, city and payment status. Missing details remain blank. Workshop/course assignments come from registration fields, not inferred from fees. Unknown workshop assignments stop before any spreadsheet edits.

## Why this setup differs from the OAuth proposal

The Sheets REST API does not insert embedded image blobs. A small Google Apps Script web app uses Google's `insertImage(blob, column, row)` method instead. You authorize that helper in your browser once during deployment. Terminal requests are signed using a private local key; there is no Google Cloud OAuth-client setup, service-account JSON, extra npm installation or public QR-image hosting. No QR payload goes to a third-party image generator.

## One-time setup

1. From this backend directory, run:

   ```sh
   node scripts/sync-registration-sheets.js --setup
   ```

   This creates `.local/registration-sheet-sync.json` and displays a private signing key. Keep it private; do not paste it into chat or commit it.

2. Open the target Google Sheet. Choose **Extensions → Apps Script**.
3. Replace the default `Code.gs` contents with the full contents of `scripts/google-apps-script/RegistrationSync.gs`, then save.
4. In Apps Script, open **Project Settings → Script properties → Add script property**. Set the property name to `SYNC_SECRET` and its value to the signing key displayed by step 1. Save.
5. Select **Deploy → New deployment**, select **Web app**:
   - **Execute as:** Me (your Google account with edit access to this sheet).
   - **Who has access:** Anyone. This allows the terminal to reach the endpoint without a browser cookie. The helper itself rejects requests without a valid signed payload and a recent timestamp. It does not make the spreadsheet public or change its sharing permissions.
   - Click **Deploy** and authorize the Google Sheets access. For your own unverified script, Google may display an unverified-app screen; review the script and select Advanced to continue if appropriate.
6. Copy the deployed **Web app URL** ending in `/exec` and run:

   ```sh
   node scripts/sync-registration-sheets.js --web-app 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
   ```

If your Workspace administrator does not permit “Anyone” web app access, stop here; this deployment method needs an alternative authentication setup. Do not change organization policy for this script.

## Upgrade the helper for incremental updates

Replace the Apps Script `Code.gs` contents with the updated `scripts/google-apps-script/RegistrationSync.gs`, then choose **Deploy → Manage deployments → Edit → New version → Deploy**. Keep the existing URL and signing key. Update both the helper and terminal script before running `--apply`.

## Every update

Preview counts without changing Google Sheets or needing Google authorization:

```sh
node scripts/sync-registration-sheets.js
```

Refresh the six tabs, including QR images:

```sh
node scripts/sync-registration-sheets.js --apply
```

Equivalent command:

```sh
npm run sheets:sync -- --apply
```

Run whenever new registrations or changed details need to appear. Keep the terminal open until it reports all six tabs and QR images verified. Only missing or changed QR images upload, in batches of 25. The first update after upgrading the helper replaces existing images once to record their payload fingerprints; subsequent runs retain unchanged images. It does not send emails or write to the conference database.

## Refresh behavior

- The six named tabs are generated reports. Only changed cells in their managed columns are written; stale rows are cleared. Keep personal notes in a separate tab. Unrelated tabs and columns outside the report are not overwritten.
- Existing tab IDs, including the master tab link, remain the same. Missing candidate tabs are created once, not duplicated each run.
- Existing master QR images are matched by registration ID and a SHA-256 fingerprint of the QR payload. Unchanged images are retained and moved if candidate rows shift; missing or changed images are uploaded, and obsolete or duplicate images are removed. The existing attendance QR payload is used; missing QR records are reported as Missing and no invented entry code is created.
- All existing images on Offline List are considered generated QR images. Do not place logos or unrelated pictures on that tab.
- Before updating, previous cell values are backed up in `.local/sheet-backup-*.json`. This is a values backup, not a full image/format backup; use Google Sheets version history to restore the complete workbook if needed.
- After updating, the script reads back every report cell and checks every QR image's registration ID and anchor row. Scannability/visual fit still requires checking the first live run in Google Sheets.
- Concurrent or interrupted runs hold a session for 15 minutes after the last batch. If a run fails partway, wait 15 minutes, then rerun the full command. There is no automatic retry that could duplicate images.
- `.local/` is ignored by Git and token/config files use owner-only permissions. Changing the shared key requires updating both the local config and the Script Property.
- When the `.gs` helper changes, use **Deploy → Manage deployments → Edit → New version → Deploy** so the existing `/exec` URL runs the new code.

## Troubleshooting

- **Unauthorized:** `SYNC_SECRET` differs from the key in the local JSON file.
- **Google did not return JSON:** wrong URL (use `/exec`, not `/dev`), deployment access not Anyone, or the helper has not been deployed/authorized.
- **Expired request:** correct the Mac's clock and try again.
- **Another sync is active:** let the other process finish, or wait 15 minutes after an interrupted run.
- **Readback mismatch / QR verification failed:** inspect the sheet; rerun the complete sync after the session expires. Do not use a partially refreshed report for check-in.

Google references:
- https://developers.google.com/apps-script/guides/web
- https://developers.google.com/apps-script/reference/spreadsheet/sheet#insertImage(BlobSource,Integer,Integer)

## Hourly sync on the production server

The existing self-hosted Ubuntu deployment can install a cron job that runs at
minute zero of every hour. The Mac and terminal can be off. The server and its
cron service must stay running, with outbound access to MongoDB and Google.

1. In the GitHub repository, open **Settings → Secrets and variables → Actions**.
   Add a repository secret named `REGISTRATION_SHEET_SYNC_CONFIG`. Its value is
   the complete contents of the working local `.local/registration-sheet-sync.json`
   file (the existing `url` and `secret` fields). Copy it directly into GitHub;
   do not paste it into chat or commit it. Preserve the existing `PROD_ENV_FILE`
   and its MongoDB configuration.
2. Deploy these changes through the existing push-to-`master` workflow. The job
   saves the configuration with owner-only permissions outside the checkout,
   then installs the cron entry for the runner's Linux account. Installing it
   does not immediately start a sync. If the secret is absent, setup is skipped.
3. On the server, check `crontab -l` and confirm cron is running. Required commands:
   `node`, `bash`, `crontab` and `flock` (usually supplied by cron and util-linux
   on Ubuntu). Node must support the existing script's built-in fetch API.
4. To test immediately from the deployed backend directory, run:

   ```sh
   bash scripts/server/run-registration-sheet-sync.sh
   ```

Daily logs are in `/home/ubuntu/aoa-data/registration-sheet-sync/logs/` and are
retained for approximately 30 days. They include start/end times, skipped runs,
progress and failures. A failed sync is attempted again at the next hourly run;
there are no immediate retries. Logs do not send failure alerts.

The wrapper uses an OS file lock, released automatically when the process exits.
If an hourly run is still active, the next one skips it rather than interrupting
it. Use the wrapper for manual server runs too. Direct runs from a Mac are still
subject to the Google helper's shared 15-minute session protection; avoid running
them during a scheduled sync. Interrupted Google sessions expire before the next
hourly attempt.

The MongoDB settings are read from the backend `.env` generated by deployment;
PM2's process environment is not inherited by cron. Ensure `PROD_ENV_FILE` includes
the correct MongoDB connection setting and the server IP is allowed by MongoDB.
The current updated Google Apps Script deployment is also required.

For another Linux host, provision the same private `config.json` under a persistent
directory and run `bash scripts/server/install-registration-sheet-cron.sh` as the
backend account. Set `REGISTRATION_SHEET_SYNC_STATE_DIR` to change that directory.
The installer captures the absolute Node path and preserves unrelated cron jobs.
Reinstall after changing Node installations or the backend checkout path.

To disable, run `crontab -e` on the server and remove the line ending in
`# aoa-registration-sheet-sync`; remove the GitHub secret as well to prevent
future deployments from reinstalling it. Removing the secret alone does not
remove an already installed job. This stops future runs; an active run finishes.
Cell backups continue to use the backend's ignored `.local/sheet-backup-*.json`
files; monitor disk space and archive old backups as needed.
