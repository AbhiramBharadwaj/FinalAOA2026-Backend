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

Run whenever new registrations or changed details need to appear. Keep the terminal open until it reports all six tabs and QR images verified. Images upload in batches of 25, so a full update can take several minutes. It does not send emails or write to the conference database.

## Refresh behavior

- The six named tabs are generated reports. Their managed columns are replaced each run; stale rows are cleared. Keep personal notes in a separate tab. Unrelated tabs and columns outside the report are not overwritten.
- Existing tab IDs, including the master tab link, remain the same. Missing candidate tabs are created once, not duplicated each run.
- Existing master QR images are removed and recreated at the correct candidate rows. The existing attendance QR payload is used; missing QR records are reported as Missing and no invented entry code is created.
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
