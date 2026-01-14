import logger from './logger.js';

const resendEndpoint = 'https://api.resend.com/emails';

const getResendFromAddress = () => {
  const from = process.env.RESEND_FROM;
  if (!from) {
    throw new Error('RESEND_FROM not configured');
  }
  return from;
};

const normalizeResendAttachments = (attachments = []) =>
  attachments.map((attachment) => {
    const content = attachment.content;
    let encodedContent = content;
    if (Buffer.isBuffer(content)) {
      encodedContent = content.toString('base64');
    }
    if (typeof encodedContent !== 'string') {
      throw new Error('Unsupported attachment content type for Resend');
    }
    return {
      filename: attachment.filename,
      content: encodedContent,
      content_type: attachment.contentType || attachment.content_type,
      content_id: attachment.cid || attachment.contentId,
    };
  });

const sendViaResend = async ({ to, subject, text, html, attachments }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }
  if (typeof fetch !== 'function') {
    throw new Error('Fetch API not available; use Node 18+ or add a fetch polyfill');
  }

  const payload = {
    from: getResendFromAddress(),
    to: Array.isArray(to) ? to : [to],
    subject,
    text,
    html,
  };

  if (attachments?.length) {
    payload.attachments = normalizeResendAttachments(attachments);
  }

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
};

const sendEmail = async ({ to, subject, text, html, attachments }) => {
  const recipients = Array.isArray(to) ? to : [to];
  logger.info(`Sending email to ${recipients.join(', ')} with subject "${subject}".`);
  try {
    await sendViaResend({ to, subject, text, html, attachments });
    logger.info(`Email sent to ${recipients.join(', ')} with subject "${subject}".`);
  } catch (error) {
    logger.error(`Failed to send email to ${recipients.join(', ')}.`, {
      message: error?.message || error,
    });
    throw error;
  }
};

const wrapEmail = (title, bodyHtml) => `
  <div style="background:#f7f7fb;padding:24px 12px;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
      <div style="background:#9c3253;color:#ffffff;padding:16px 20px;">
        <div style="font-size:16px;font-weight:700;letter-spacing:0.4px;">AOACON 2026</div>
        <div style="font-size:12px;opacity:0.9;">Shivamogga, Karnataka</div>
      </div>
      <div style="padding:20px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#0f172a;">${title}</h2>
        ${bodyHtml}
      </div>
      <div style="padding:14px 20px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px;">
        <div>AOACON 2026 Team</div>
      </div>
    </div>
  </div>
`;

export const sendPasswordResetEmail = async ({ email, name, resetLink, isAdmin = false }) => {
  const title = isAdmin ? 'Admin Password Reset' : 'Password Reset';
  const subject = `AOACON 2026 ${isAdmin ? 'Admin ' : ''}Password Reset`;
  const text = [
    `Hello ${name || 'there'},`,
    '',
    'We received a request to reset your password.',
    `Reset link: ${resetLink}`,
    '',
    'If you did not request this, you can safely ignore this email.',
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ].join('\n');

  const bodyHtml = `
    <p style="margin:0 0 10px;">Hello ${name || 'there'},</p>
    <p style="margin:0 0 12px;">We received a request to reset your password.</p>
    <p style="margin:0 0 16px;">
      <a href="${resetLink}" style="display:inline-block;padding:10px 16px;background:#9c3253;color:#ffffff;text-decoration:none;border-radius:6px;">
        Reset Password
      </a>
    </p>
    <p style="margin:0 0 10px;font-size:12px;color:#6b7280;">If the button does not work, copy and paste this URL into your browser:</p>
    <p style="margin:0;font-size:12px;color:#6b7280;">${resetLink}</p>
    <p style="margin:12px 0 0;">If you did not request this, you can safely ignore this email.</p>
  `;

  const html = wrapEmail(title, bodyHtml);

  return sendEmail({
    to: email,
    subject,
    text,
    html,
  });
};

export const sendRegistrationEmail = async (user) => {
  const subject = 'AOACON 2026 Registration Received';
  const text = [
    `Hello ${user.name},`,
    '',
    'Your AOACON 2026 account has been created successfully.',
    `Category: ${user.role}`,
    `Email: ${user.email}`,
    '',
    'You can now complete registration and payment from your dashboard.',
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ].join('\n');

  const bodyHtml = `
    <p style="margin:0 0 10px;">Hello ${user.name},</p>
    <p style="margin:0 0 12px;">Your AOACON 2026 account has been created successfully.</p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
      <div style="margin:0 0 6px;"><strong>Category:</strong> ${user.role}</div>
      <div style="margin:0;"><strong>Email:</strong> ${user.email}</div>
    </div>
    <p style="margin:0;">You can now complete registration and payment from your dashboard.</p>
  `;

  const html = wrapEmail('Registration Received', bodyHtml);

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
  });
};

export const sendCollegeLetterReviewEmail = async ({ user, status }) => {
  const normalizedStatus = status === 'APPROVED' ? 'approved' : 'rejected';
  const subject = `AOACON 2026 Recommendation Letter ${normalizedStatus}`;
  const text = [
    `Hello ${user.name},`,
    '',
    `Your recommendation letter has been ${normalizedStatus}.`,
    'If you have questions, please reach out to the AOACON 2026 team.',
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ].join('\n');

  const bodyHtml = `
    <p style="margin:0 0 10px;">Hello ${user.name},</p>
    <p style="margin:0 0 12px;">Your recommendation letter has been <strong>${normalizedStatus}</strong>.</p>
    <p style="margin:0 0 12px;">If you have questions, please reach out to the AOACON 2026 team.</p>
  `;

  const html = wrapEmail('Recommendation Letter Review', bodyHtml);

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
  });
};

export const sendPaymentSuccessEmail = async ({
  user,
  subject,
  summaryLines,
  qrCid,
  attachments = [],
}) => {
  const text = [
    `Hello ${user.name},`,
    '',
    'Your payment was successful.',
    ...summaryLines,
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ].join('\n');

  const summaryHtml = summaryLines
    .map((line) => `<div style="margin:0 0 6px;">${line}</div>`)
    .join('');

  const qrSection = qrCid
    ? `
      <div style="margin-top:14px;padding:12px;border:1px dashed #e5e7eb;border-radius:8px;text-align:center;">
        <div style="font-weight:600;margin-bottom:8px;">Your Entry QR</div>
        <img src="cid:${qrCid}" alt="QR Code" style="width:180px;height:180px;border-radius:8px;" />
        <div style="font-size:12px;color:#6b7280;margin-top:6px;">Show this QR at entry</div>
      </div>
    `
    : '';

  const html = wrapEmail(
    'Payment Successful',
    `
      <p style="margin:0 0 10px;">Hello ${user.name},</p>
      <p style="margin:0 0 12px;">Your payment was successful. Please find your invoice attached.</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
        ${summaryHtml}
      </div>
      ${qrSection}
    `
  );

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
    attachments,
  });
};

export const sendAbstractSubmittedEmail = async (abstract) => {
  const user = abstract.userId;
  const subject = 'AOACON 2026 Abstract Submitted';
  const text = [
    `Hello ${user.name},`,
    '',
    'Your abstract has been submitted for review.',
    `Title: ${abstract.title || 'N/A'}`,
    `Category: ${abstract.category || 'N/A'}`,
    '',
    'You can track status from your dashboard.',
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ].join('\n');

  const bodyHtml = `
    <p style="margin:0 0 10px;">Hello ${user.name},</p>
    <p style="margin:0 0 12px;">Your abstract has been submitted for review.</p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
      <div style="margin:0 0 6px;"><strong>Title:</strong> ${abstract.title || 'N/A'}</div>
      <div style="margin:0;"><strong>Category:</strong> ${abstract.category || 'N/A'}</div>
    </div>
    <p style="margin:0;">You can track status from your dashboard.</p>
  `;

  const html = wrapEmail('Abstract Submitted', bodyHtml);

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
  });
};

export const sendAbstractReviewEmail = async (abstract) => {
  const user = abstract.userId;
  const status = abstract.status;
  const statusLabel = status === 'APPROVED' ? 'Approved' : 'Rejected';
  const subject = `AOACON 2026 Abstract ${statusLabel}`;
  const text = [
    `Hello ${user.name},`,
    '',
    `Your abstract has been ${statusLabel.toLowerCase()}.`,
    `Title: ${abstract.title || 'N/A'}`,
    `Category: ${abstract.category || 'N/A'}`,
    abstract.reviewComments ? `Comments: ${abstract.reviewComments}` : null,
    '',
    'Thanks,',
    'AOACON 2026 Team',
  ]
    .filter(Boolean)
    .join('\n');

  const commentsHtml = abstract.reviewComments
    ? `<div style="margin-top:10px;"><strong>Comments:</strong> ${abstract.reviewComments}</div>`
    : '';

  const bodyHtml = `
    <p style="margin:0 0 10px;">Hello ${user.name},</p>
    <p style="margin:0 0 12px;">Your abstract has been <strong>${statusLabel}</strong>.</p>
    <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin:0 0 12px;">
      <div style="margin:0 0 6px;"><strong>Title:</strong> ${abstract.title || 'N/A'}</div>
      <div style="margin:0;"><strong>Category:</strong> ${abstract.category || 'N/A'}</div>
      ${commentsHtml}
    </div>
    <p style="margin:0;">You can view your abstract status in the dashboard.</p>
  `;

  const html = wrapEmail(`Abstract ${statusLabel}`, bodyHtml);

  return sendEmail({
    to: user.email,
    subject,
    text,
    html,
  });
};

export const sendTestEmail = async (to) => {
  const subject = 'AOACON 2026 Email Test';
  const text = [
    'This is a test email from AOACON 2026.',
    `Sent at: ${new Date().toLocaleString('en-IN')}`,
  ].join('\n');
  const html = wrapEmail(
    'Email Test',
    `
      <p style="margin:0 0 10px;">This is a test email from AOACON 2026.</p>
      <p style="margin:0;">Sent at: ${new Date().toLocaleString('en-IN')}</p>
    `
  );

  return sendEmail({
    to,
    subject,
    text,
    html,
  });
};
