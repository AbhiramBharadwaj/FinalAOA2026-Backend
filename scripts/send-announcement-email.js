import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const resendEndpoint = 'https://api.resend.com/emails';
const attachmentPath = path.resolve(
  process.cwd(),
  'assets/AnnouncementBroucher/AOA CON BROCHURE ANNOUNCEMENT.pdf'
);

const sendAnnouncementEmail = async () => {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }
  if (!from) {
    throw new Error('RESEND_FROM not configured');
  }
  if (!fs.existsSync(attachmentPath)) {
    throw new Error(`Attachment not found: ${attachmentPath}`);
  }

  const pdfBuffer = fs.readFileSync(attachmentPath);
  const to = 'abhirambharadwaj10@gmail.com';
  const subject = 'Dear Abhiram Gupta, Invitation to AOACON 2026';
  const text = [
    'Dear Abhiram Gupta,',
    '',
    'We are pleased to invite you to AOACON 2026.',
    '',
    'Please find the brochure attached for further details. We would be glad to have your presence at the event.',
    '',
    'Warm regards,',
    'AOACON 2026 Team',
  ].join('\n');

  const html = `
    <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">
      <p>Dear Abhiram Gupta,</p>
      <p>We are pleased to invite you to AOACON 2026.</p>
      <p>Please find the brochure attached for further details. We would be glad to have your presence at the event.</p>
      <p>Warm regards,<br />AOACON 2026 Team</p>
    </div>
  `;

  const payload = {
    from,
    to: [to],
    subject,
    text,
    html,
    attachments: [
      {
        filename: 'AOA CON BROCHURE ANNOUNCEMENT.pdf',
        content: pdfBuffer.toString('base64'),
        content_type: 'application/pdf',
      },
    ],
  };

  const response = await fetch(resendEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
};

sendAnnouncementEmail().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
