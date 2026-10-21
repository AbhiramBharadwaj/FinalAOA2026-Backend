import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Counter from '../models/Counter.js';
import { sendEmail } from '../utils/email.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const campaign = 'aoacon2026-welcome-scientific-programme-v1';
const defaultPdf = path.join(root, 'assets/AOACON 2026  Scientific Program.pdf');
export function parseId(value) {
  const match = /^(?:AOA2026-)?(\d{1,5})$/i.exec(value || '');
  const number = match ? Number(match[1]) : 0;
  if (number < 1) throw new Error(`Invalid registration ID: ${value}`);
  return number;
}
export function parseOptions(args) {
  const options = { send: false, pdf: defaultPdf };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--send') options.send = true;
    else if (arg === '--help') options.help = true;
    else if (['--from', '--to', '--pdf'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return options;
  options.from = parseId(options.from);
  options.to = parseId(options.to);
  if (options.from > options.to) throw new Error('--from must be less than or equal to --to');
  options.pdf = path.resolve(options.pdf);
  return options;
}
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export function packageLabel(registration) {
  const labels = [];
  if (registration.addWorkshop || registration.selectedWorkshop || ['WORKSHOP_CONFERENCE', 'COMBO'].includes(registration.registrationType)) labels.push('Workshop');
  if (registration.addAoaCourse || ['AOA_CERTIFIED_COURSE', 'COMBO'].includes(registration.registrationType)) labels.push('AOA Certified Course');
  if (registration.addLifeMembership) labels.push('AOA Life Membership');
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
}
export function buildMessage(user, registration) {
  const name = user.name.trim();
  const greeting = `Dear ${/^(dr\.?|prof\.?)\s/i.test(name) ? name : `Dr ${name}`},`;
  const welcome = 'We are delighted to welcome you to AOACON 2026, taking place from 30 October to 1 November 2026 in Shivamogga, Karnataka.';
  const programme = 'The scientific programme is attached for your reference, with details of the sessions and schedule.';
  const learning = 'We look forward to your participation in an enriching programme of learning, collaboration and scientific exchange.';
  const instructions = 'Please present this QR code at the registration desk for check-in and badge collection.';
  const number = registration.registrationNumber;
  const registeredPackage = packageLabel(registration);
  return {
    to: user.email.trim(),
    subject: `Welcome to AOACON 2026 | Registration ${number}`,
    text: [greeting, '', welcome, '', learning, '', `Registration ID: ${number}`, `Registered package: ${registeredPackage}`, '', 'Your individual registration QR code is attached.', instructions, '', programme, '', 'We look forward to welcoming you to Shivamogga!', '', 'Warm regards,', 'Organising Committee', 'AOACON 2026'].join('\n'),
    html: `<div style="background:#f7f7fb;padding:24px 12px;font-family:Arial,sans-serif;font-size:14px;color:#1f2937;line-height:1.7;">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<div style="background:#9c3253;color:#fff;padding:20px;"><div style="font-size:22px;font-weight:700;">AOACON 2026</div><div>30 October – 1 November 2026 · Shivamogga, Karnataka</div></div>
<div style="padding:24px;"><h2 style="font-size:20px;margin-top:0;">Welcome to AOACON 2026</h2>
<p>${escapeHtml(greeting)}</p><p>${welcome}</p><p>${learning}</p>
<div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:16px;"><div><strong>Registration ID:</strong> ${escapeHtml(number)}</div><div><strong>Registered package:</strong> ${escapeHtml(registeredPackage)}</div></div>
<div style="text-align:center;padding:20px 0 4px;"><img src="cid:welcome-qr" width="180" height="180" alt="Your registration QR code" /></div>
<p>${instructions}</p><p><strong>The scientific programme is attached</strong> for your reference, with details of the sessions and schedule.</p>
<p>We look forward to welcoming you to Shivamogga!</p><p>Warm regards,<br><strong>Organising Committee</strong><br><strong>AOACON 2026</strong></p></div></div></div>`,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/send-registration-welcome.js --from AOA2026-0001 --to AOA2026-0100 [--send] [--pdf /path/to/programme.pdf]\nRange is inclusive. Default: dry run. Only PAID registrations are eligible. Successful sends are skipped on rerun.');
    return;
  }
  dotenv.config({ path: path.join(root, '.env') });
  const pdf = await fs.readFile(options.pdf);
  if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Attachment is not a PDF');
  const pdfHash = createHash('sha256').update(pdf).digest('hex');
  const server = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || server.match(/mongoose\.connect\(\s*["']([^"']+)["']/)?.[1];
  if (!uri) throw new Error('MongoDB connection configuration missing');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  try {
    // Reuse the existing collection: this database is at its collection limit.
    // Campaign-prefixed IDs/names cannot overlap numbering or email quota counters.
    const ledger = Counter.collection;
    const all = await Registration.find({ registrationNumber: /^AOA2026-\d+$/ }).populate({ path: 'userId', model: User, select: 'name email isActive' }).lean();
    const inRange = all.filter(r => { const seq = parseId(r.registrationNumber); return seq >= options.from && seq <= options.to; }).sort((a, b) => parseId(a.registrationNumber) - parseId(b.registrationNumber));
    const [priorSends, attendances] = await Promise.all([
      ledger.find({ _id: { $in: inRange.map(r => `${campaign}:${r._id}`) } }).toArray(),
      Attendance.find({ registrationId: { $in: inRange.map(r => r._id) } }).select('registrationId qrCodeData isActive').lean(),
    ]);
    const priorById = new Map(priorSends.map(record => [record._id, record]));
    const attendanceById = new Map(attendances.map(record => [String(record.registrationId), record]));
    const jobs = [];
    let alreadySent = 0;
    let notPaid = 0;
    const errors = [];
    for (const registration of inRange) {
      if (registration.paymentStatus !== 'PAID') { console.log(`[SKIP] ${registration.registrationNumber}: ${registration.paymentStatus}`); notPaid++; continue; }
      const id = `${campaign}:${registration._id}`;
      const prior = priorById.get(id);
      if (prior?.status === 'ACCEPTED') { console.log(`[SKIP] ${registration.registrationNumber}: already sent`); alreadySent++; continue; }
      if (prior) { errors.push(`${registration.registrationNumber}: earlier send attempt needs provider review (${prior.status}); no automatic resend`); continue; }
      const user = registration.userId;
      if (!user?.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user?.email?.trim() || '') || user.isActive === false) {
        errors.push(`${registration.registrationNumber}: missing/invalid name or email, or inactive account`); continue;
      }
      const attendance = attendanceById.get(String(registration._id));
      if (!attendance?.qrCodeData || attendance.isActive === false) { errors.push(`${registration.registrationNumber}: missing/inactive entry QR`); continue; }
      jobs.push({ id, registration, user, qrCodeData: attendance.qrCodeData });
    }
    console.log(`\n${options.send ? 'SEND' : 'DRY RUN'} | inclusive ID range ${options.from}–${options.to} | found ${inRange.length} | to send ${jobs.length} | already sent ${alreadySent} | unpaid skipped ${notPaid}`);
    console.log(`Attachment: ${options.pdf} (${Math.round(pdf.length / 1024)} KB)\nCampaign: ${campaign}\nDelay: random 8–10 seconds between emails`);
    for (const job of jobs) console.log(`[${options.send ? 'QUEUED' : 'PREVIEW'}] ${job.registration.registrationNumber} -> ${job.user.email} | ${packageLabel(job.registration)}`);
    if (errors.length) throw new Error(`Preflight failed; no emails sent:\n${errors.join('\n')}`);
    if (!options.send) { console.log('\nDry run complete. Add --send to send these emails.'); return; }
    let accepted = 0;
    let stopping = false;
    const stop = () => { stopping = true; console.log('\nStopping after the current email; rerun the same command to resume.'); };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    try {
      for (let i = 0; i < jobs.length; i++) {
        if (stopping) break;
        const { id, registration, user, qrCodeData } = jobs[i];
        const qr = await QRCode.toBuffer(qrCodeData, { width: 512, margin: 1, color: { dark: '#005aa9', light: '#ffffff' } });
        // Atomic claim prevents duplicate sends from overlapping ranges/processes.
        try {
          await ledger.insertOne({ _id: id, name: id, seq: 0, campaign, registrationId: registration._id, registrationNumber: registration.registrationNumber, email: user.email, status: 'SENDING', startedAt: new Date(), pdfHash });
        } catch (error) {
          if (error.code === 11000) throw new Error(`Another process claimed ${registration.registrationNumber}. Stop and rerun after it finishes.`);
          throw error;
        }
        try {
          const result = await sendEmail({ ...buildMessage(user, registration), attachments: [
            { filename: `AOACON_2026_QR_${registration.registrationNumber}.png`, content: qr, contentType: 'image/png', cid: 'welcome-qr' },
            { filename: 'AOACON 2026 Scientific Programme.pdf', content: pdf, contentType: 'application/pdf' },
          ] });
          await ledger.updateOne({ _id: id }, { $set: { status: 'ACCEPTED', acceptedAt: new Date(), provider: result.provider, messageId: result.messageId } });
          accepted++;
          console.log(`[${i + 1}/${jobs.length}] SENT ${registration.registrationNumber} -> ${user.email} (${result.provider}: ${result.messageId})`);
        } catch (error) {
          await ledger.updateOne({ _id: id }, { $set: { status: 'NEEDS_REVIEW', error: error.message, failedAt: new Date() } });
          throw new Error(`Stopped at ${registration.registrationNumber}: ${error.message}. Check provider acceptance before retrying; the script will not resend this record automatically.`);
        }
        if (i < jobs.length - 1 && !stopping) {
          const milliseconds = randomInt(8000, 10001);
          console.log(`Waiting ${(milliseconds / 1000).toFixed(2)} seconds…`);
          await delay(milliseconds);
        }
      }
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
    console.log(`Run complete: ${accepted} emails accepted by provider${stopping ? ' (stopped early)' : ''}.`);
  } finally { await mongoose.disconnect(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
