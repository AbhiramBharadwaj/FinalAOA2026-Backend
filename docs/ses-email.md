# AWS SES email sending (temporarily disabled)

Backend email currently uses Resend (75 recipients/day), then Zoho CPaaS.
Zoho retries once after an explicit rejection. After both rejections the send
fails with the Zoho error; SES is never invoked. A legacy EMAIL_PROVIDER=ses
setting also uses Resend and Zoho while SES is disabled.

SES implementation remains in services/sesEmail.js for future reactivation.
Timeouts and unknown acceptance never trigger a retry through another provider.
