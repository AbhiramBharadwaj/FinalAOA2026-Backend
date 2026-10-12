# Email provider routing

Backend emails use Resend until RESEND_DAILY_SWITCH_LIMIT is reached, then
use Zoho CPaaS. The temporary testing threshold is 20 recipients per day.
Set the threshold to 90 after verifying the switch.

Production configuration is stored in the GitHub Actions PROD_ENV_FILE secret:

```env
ZOHO_CPAAS_API_KEY="<Zoho API key>"
ZOHO_FROM_EMAIL=info@aoacon2026.com
RESEND_DAILY_SWITCH_LIMIT=20
```

Preserve all other settings when replacing that secret. Pushes to master
recreate the backend .env and restart aoa-backend using PM2.

Resend usage checks require a full-access RESEND_API_KEY. If usage cannot
be checked, backend emails go to Zoho. MongoDB counters reserve Resend quota
across concurrent backend sends, and the provider's reset timestamp starts
a new counter. Standalone announcement scripts still use Resend directly.

Check backend logs for "Email provider resend accepted message" or
"Email provider zoho accepted message" to identify the selected provider.
Run npm test to verify routing without sending real emails.
