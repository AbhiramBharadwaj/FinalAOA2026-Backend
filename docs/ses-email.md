# AWS SES email sending

SES domain and production access must be verified in eu-north-1 (Stockholm).
The approved provider order is Resend (75/day), then Zoho without an application
cap (up to two attempts on confirmed rejection), then SES after both attempts fail.
Configure these values on the backend:

```
EMAIL_PROVIDER=auto
RESEND_DAILY_SWITCH_LIMIT=75
ZOHO_QUOTA_TIMEZONE=Asia/Kolkata
SES_REGION=eu-north-1
SES_FROM_EMAIL=AOACON 2026 <info@aoacon2026.com>
```

Use the AWS SDK credential chain. On EC2, prefer an instance IAM role allowed
`ses:SendEmail` for the verified sender identity. Keep credentials out of git.
`ses:GetAccount` is additionally needed to read live sending quotas.
An optional `SES_CONFIGURATION_SET` can select an existing SES event destination.

With EMAIL_PROVIDER unset or set to auto, Resend quota is checked first. Once that
quota is exhausted, sends go to Zoho. The Zoho counter tracks usage only and never
blocks a send; the provider's own limits still apply. Resend's counter follows its
API quota reset; Zoho's usage counter changes at midnight in the configured
timezone. Set that timezone to match the account's day boundary if needed.
Zoho usage outside this shared sender is not automatically visible.

EMAIL_PROVIDER=ses is available for a direct SES test, with no backup retry.
Zoho retries once after a one-second pause for definite non-acceptance, including
authentication, quota and other explicit API rejections. If its second attempt is
also rejected, the same message is sent through SES. An accepted response is never
retried, even if recording usage fails afterward.
Timeouts and unknown failures never advance to another provider, because the original
send may already have been accepted. SDK retries are disabled.

The sender supports the existing text/HTML, PDF attachments and inline QR images.
An SES MessageId confirms API acceptance, not delivery to the recipient inbox.
Batch scripts retain their 12–15-second delay between emails independently.
