import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const resendEndpoint = 'https://api.resend.com/emails';
const defaultAttachments = [
  path.resolve(
    process.cwd(),
    'assets/AnnouncementBroucher/Abstract Submission - AOACON2026.pdf'
  ),
  path.resolve(
    process.cwd(),
    'assets/AnnouncementBroucher/Award Video Competition - AOACON2026.pdf'
  ),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
};

const formatTimestamp = (date = new Date()) =>
  date.toLocaleString('en-IN', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

const normalizeHeader = (value) =>
  String(value || '')
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const parseCsvContent = (content) => {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(field.trim());
      field = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i += 1;
      }

      row.push(field.trim());
      field = '';

      if (row.some((value) => value !== '')) {
        rows.push(row);
      }

      row = [];
      continue;
    }

    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((value) => value !== '')) {
      rows.push(row);
    }
  }

  const headers = rows.shift() || [];
  return { headers, rows };
};

const findColumnIndex = (headers, aliases) => {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  for (const alias of aliases) {
    const index = normalizedHeaders.indexOf(normalizeHeader(alias));
    if (index !== -1) return index;
  }
  return -1;
};

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    file: null,
    send: false,
    cc: [],
    attachments: [...defaultAttachments],
    emailColumn: 'email',
    nameColumn: 'name',
    serialColumn: '#',
    template: 'abstract-video',
    start: null,
    end: null,
    minDelayMs: 30000,
    maxDelayMs: 45000,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--file') options.file = args[i + 1];
    if (arg === '--send') options.send = true;
    if (arg === '--cc') {
      options.cc = args[i + 1].split(',').map((value) => value.trim()).filter(Boolean);
    }
    if (arg === '--attachment') options.attachments = [args[i + 1]];
    if (arg === '--attachments') {
      options.attachments = args[i + 1].split(',').map((value) => value.trim());
    }
    if (arg === '--email-column') options.emailColumn = args[i + 1];
    if (arg === '--name-column') options.nameColumn = args[i + 1];
    if (arg === '--serial-column') options.serialColumn = args[i + 1];
    if (arg === '--template') options.template = args[i + 1];
    if (arg === '--start') options.start = Number(args[i + 1]);
    if (arg === '--end') options.end = Number(args[i + 1]);
    if (arg === '--min-delay-ms') options.minDelayMs = Number(args[i + 1]);
    if (arg === '--max-delay-ms') options.maxDelayMs = Number(args[i + 1]);
  }

  return options;
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const getSubject = (name, template) => {
  if (template === 'registration') {
    return `Dear ${name}, Invitation to Register for AOACON 2026`;
  }

  return `Dear ${name}, AOACON 2026 Abstract Submissions & Award Video Competition Now Open`;
};

const getTextBody = (name, template) => {
  if (template === 'registration') {
    return [
      `Dear ${name},`,
      '',
      'Greetings from the Organizing Committee of AOACON 2026, Shivamogga.',
      '',
      'We are pleased to invite you to register for AOACON 2026, the 19th National Conference of the Association of Obstetric Anaesthesiologists, being held from 30th October to 1st November 2026 in Shivamogga, Karnataka.',
      '',
      'Please find the conference brochure attached for further details. We request you to complete your registration at the earliest through the conference website:',
      'https://www.aoacon2026.com/',
      '',
      'We look forward to welcoming you to AOACON 2026.',
      '',
      'If you have already registered, please ignore this message.',
      '',
      'Warm regards,',
      'Organizing Committee',
      'AOACON 2026',
      'Shivamogga, Karnataka',
    ].join('\n');
  }

  return [
    `Dear ${name},`,
    '',
    'Greetings from the Organizing Committee of AOACON 2026, Shivamogga.',
    '',
    'Conference registration is compulsory before submitting an abstract or video entry. The presenting author/participant must be registered for the conference to proceed with submission.',
    '',
    'We are pleased to inform you that abstract submissions are now open for AOACON 2026. Abstracts may be submitted under the following categories:',
    '',
    'Original Research',
    'Clinical Audit / Quality Improvement',
    'Case Report / Case Series',
    'Review / Educational Poster',
    'Innovations in Labour Analgesia / Obstetric Anaesthesia',
    'Patient Safety in Obstetric Anaesthesia',
    'Simulation / Training Initiatives',
    '',
    'All abstract presentations will be in e-poster format. Abstracts must be submitted through the conference website and should be within 300 words.',
    '',
    'We are also inviting entries for the AOACON 2026 Award Video Competition. Participants may submit a 5-minute clinical video showcasing a procedure related to obstetric anaesthesia, obstetric analgesia, or obstetric critical care.',
    '',
    'Video specifications: 720p or above, clear audio, maximum file size 500 MB.',
    'Judging criteria: Scientific accuracy, technical quality, and creativity.',
    'Recognition: The best two videos will be recognised and showcased during the main conference.',
    '',
    'Last date for abstract/video submission: 10th October 2026',
    'Conference dates: 30th October - 1st November 2026',
    'Website: http://www.aoacon2026.com/',
    '',
    'We request all members to complete their registration and submit their abstracts or video entries at the earliest.',
    '',
    'Warm regards,',
    'Organizing Committee',
    'AOACON 2026',
    'Shivamogga, Karnataka',
  ].join('\n');
};

const getHtmlBody = (name, template) => {
  if (template === 'registration') {
    return `
  <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">
    <p>Dear ${escapeHtml(name)},</p>
    <p>Greetings from the Organizing Committee of AOACON 2026, Shivamogga.</p>
    <p>We are pleased to invite you to register for AOACON 2026, the 19th National Conference of the Association of Obstetric Anaesthesiologists, being held from 30th October to 1st November 2026 in Shivamogga, Karnataka.</p>
    <p>Please find the conference brochure attached for further details. We request you to complete your registration at the earliest through the conference website:<br />
      <a href="https://www.aoacon2026.com/">www.aoacon2026.com</a>
    </p>
    <p>We look forward to welcoming you to AOACON 2026.</p>
    <p><em>If you have already registered, please ignore this message.</em></p>
    <p>Warm regards,<br />Organizing Committee<br />AOACON 2026<br />Shivamogga, Karnataka</p>
  </div>
`;
  }

  return `
  <div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">
    <p>Dear ${escapeHtml(name)},</p>
    <p>Greetings from the Organizing Committee of AOACON 2026, Shivamogga.</p>
    <p>Conference registration is compulsory before submitting an abstract or video entry. The presenting author/participant must be registered for the conference to proceed with submission.</p>
    <p>We are pleased to inform you that abstract submissions are now open for AOACON 2026. Abstracts may be submitted under the following categories:</p>
    <ul>
      <li>Original Research</li>
      <li>Clinical Audit / Quality Improvement</li>
      <li>Case Report / Case Series</li>
      <li>Review / Educational Poster</li>
      <li>Innovations in Labour Analgesia / Obstetric Anaesthesia</li>
      <li>Patient Safety in Obstetric Anaesthesia</li>
      <li>Simulation / Training Initiatives</li>
    </ul>
    <p>All abstract presentations will be in e-poster format. Abstracts must be submitted through the conference website and should be within 300 words.</p>
    <p>We are also inviting entries for the AOACON 2026 Award Video Competition. Participants may submit a 5-minute clinical video showcasing a procedure related to obstetric anaesthesia, obstetric analgesia, or obstetric critical care.</p>
    <p>
      Video specifications: 720p or above, clear audio, maximum file size 500 MB.<br />
      Judging criteria: Scientific accuracy, technical quality, and creativity.<br />
      Recognition: The best two videos will be recognised and showcased during the main conference.
    </p>
    <p>
      Last date for abstract/video submission: 10th October 2026<br />
      Conference dates: 30th October - 1st November 2026<br />
      Website: <a href="http://www.aoacon2026.com/">www.aoacon2026.com</a>
    </p>
    <p>We request all members to complete their registration and submit their abstracts or video entries at the earliest.</p>
    <p>Warm regards,<br />Organizing Committee<br />AOACON 2026<br />Shivamogga, Karnataka</p>
  </div>
`;
};

const getRandomDelay = (minDelayMs, maxDelayMs) => {
  if (maxDelayMs <= minDelayMs) return minDelayMs;
  return Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
};

const sendEmail = async ({ apiKey, from, to, cc, name, attachments, template }) => {
  const effectiveCc = cc.filter(
    (email) => email.toLowerCase() !== String(to).toLowerCase()
  );
  const payload = {
    from,
    to: [to],
    subject: getSubject(name, template),
    text: getTextBody(name, template),
    html: getHtmlBody(name, template),
    attachments: attachments.map((attachment) => {
      const attachmentBuffer = fs.readFileSync(attachment);
      return {
        filename: path.basename(attachment),
        content: attachmentBuffer.toString('base64'),
        content_type: 'application/pdf',
      };
    }),
  };

  if (effectiveCc.length) {
    payload.cc = effectiveCc;
  }

  const idempotencyKey = `aoacon-2026/${crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        from,
        to,
        cc: effectiveCc,
        subject: payload.subject,
        template,
        attachments: attachments.map((attachment) => path.basename(attachment)),
      })
    )
    .digest('hex')}`;
  const retryableStatuses = new Set([408, 429, 500, 502, 503, 504]);
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(resendEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        return response.json();
      }

      const errorText = await response.text();
      if (!retryableStatuses.has(response.status) || attempt === maxAttempts) {
        throw new Error(`Resend error ${response.status}: ${errorText}`);
      }

      const retryDelay = attempt * 5000;
      console.log(
        `[RETRY] Resend returned ${response.status}. Retrying in ${formatDuration(retryDelay)} (attempt ${attempt + 1}/${maxAttempts}).`
      );
      await sleep(retryDelay);
    } catch (error) {
      if (String(error?.message || error).startsWith('Resend error') || attempt === maxAttempts) {
        throw error;
      }

      const retryDelay = attempt * 5000;
      console.log(
        `[RETRY] Network error: ${error?.message || error}. Retrying in ${formatDuration(retryDelay)} (attempt ${attempt + 1}/${maxAttempts}).`
      );
      await sleep(retryDelay);
    }
  }

  throw new Error('Resend request failed after all retry attempts.');
};

const main = async () => {
  const options = parseArgs();
  if (!options.file) {
    throw new Error('Missing --file path to CSV.');
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;

  if (!apiKey) {
    throw new Error('RESEND_API_KEY not configured');
  }
  if (!from) {
    throw new Error('RESEND_FROM not configured');
  }

  if (Number.isNaN(options.minDelayMs) || Number.isNaN(options.maxDelayMs)) {
    throw new Error('Delay values must be valid numbers.');
  }
  if (!['abstract-video', 'registration'].includes(options.template)) {
    throw new Error('Template must be either abstract-video or registration.');
  }
  const invalidCcAddresses = options.cc.filter((email) => !isValidEmail(email));
  if (invalidCcAddresses.length) {
    throw new Error(`Invalid CC email address: ${invalidCcAddresses.join(', ')}`);
  }

  const filePath = path.resolve(process.cwd(), options.file);
  const attachmentPaths = options.attachments.map((attachment) =>
    path.resolve(process.cwd(), attachment)
  );

  if (!fs.existsSync(filePath)) {
    throw new Error(`Input file not found: ${filePath}`);
  }
  for (const attachmentPath of attachmentPaths) {
    if (!fs.existsSync(attachmentPath)) {
      throw new Error(`Attachment not found: ${attachmentPath}`);
    }
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const { headers, rows } = parseCsvContent(raw);
  if (!headers.length) {
    throw new Error('Input file has no header row.');
  }

  const emailIndex = findColumnIndex(headers, [options.emailColumn, 'email', 'emailid', 'mail']);
  const nameIndex = findColumnIndex(headers, [options.nameColumn, 'name', 'fullname', 'full name']);
  const serialIndex = findColumnIndex(headers, [options.serialColumn, '#', 'serialno', 'sno', 'srno']);

  if (emailIndex === -1) {
    throw new Error(`Email column not found. Looked for: ${options.emailColumn}`);
  }
  if (nameIndex === -1) {
    throw new Error(`Name column not found. Looked for: ${options.nameColumn}`);
  }

  const recipients = rows
    .map((row, index) => {
      const email = String(row[emailIndex] || '').trim().toLowerCase();
      const name = String(row[nameIndex] || '').trim();
      const serialRaw = serialIndex === -1 ? '' : String(row[serialIndex] || '').trim();
      const serial = Number(serialRaw);

      return {
        csvRowNumber: index + 2,
        serial: Number.isNaN(serial) ? null : serial,
        email,
        name: name || 'Member',
      };
    })
    .filter((row) => row.email);

  const filteredRecipients = recipients.filter((recipient, index) => {
    const value = recipient.serial ?? index + 1;
    if (options.start !== null && value < options.start) return false;
    if (options.end !== null && value > options.end) return false;
    return true;
  });

  if (!filteredRecipients.length) {
    throw new Error('No recipient rows found for the selected range.');
  }

  const validRecipients = filteredRecipients.filter((recipient) => isValidEmail(recipient.email));
  const invalidRecipients = filteredRecipients.filter((recipient) => !isValidEmail(recipient.email));

  console.log(
    JSON.stringify(
      {
        mode: options.send ? 'send' : 'dry-run',
        totalRecipients: filteredRecipients.length,
        validRecipients: validRecipients.length,
        invalidRecipients: invalidRecipients.length,
        start: options.start,
        end: options.end,
        minDelayMs: options.minDelayMs,
        maxDelayMs: options.maxDelayMs,
        template: options.template,
        cc: options.cc,
        file: filePath,
        attachments: attachmentPaths,
        startedAt: formatTimestamp(),
      },
      null,
      2
    )
  );

  for (const recipient of invalidRecipients) {
    const label = recipient.serial ?? recipient.csvRowNumber;
    console.log(
      `[SKIP] Invalid email for #${label} (${recipient.name}): ${recipient.email || '<empty>'}`
    );
  }

  for (let i = 0; i < validRecipients.length; i += 1) {
    const recipient = validRecipients[i];
    const label = recipient.serial ?? recipient.csvRowNumber;

    console.log(
      `[${i + 1}/${validRecipients.length}] ${options.send ? 'Sending' : 'Would send'} #${label} to ${recipient.email} (${recipient.name}) at ${formatTimestamp()}`
    );

    if (!options.send) {
      continue;
    }

    const result = await sendEmail({
      apiKey,
      from,
      to: recipient.email,
      cc: options.cc,
      name: recipient.name,
      attachments: attachmentPaths,
      template: options.template,
    });

    console.log(
      `[${i + 1}/${validRecipients.length}] Sent #${label} to ${recipient.email} with id ${result.id || 'N/A'} at ${formatTimestamp()}`
    );

    if (i < validRecipients.length - 1 && options.maxDelayMs > 0) {
      const delay = getRandomDelay(options.minDelayMs, options.maxDelayMs);
      const nextSendAt = new Date(Date.now() + delay);
      console.log(
        `[${i + 1}/${validRecipients.length}] Waiting ${delay}ms (${formatDuration(delay)}) before next email. Next send at approximately ${formatTimestamp(nextSendAt)}`
      );
      await sleep(delay);
    }
  }
};

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
