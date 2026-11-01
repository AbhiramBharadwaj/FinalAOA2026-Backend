import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import Counter from '../models/Counter.js';
import { sendEmail } from '../utils/email.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const campaign = 'aoacon2026-thank-you-v1';
export function parseId(value) {
  const match = /^(?:AOA2026-)?(\d{1,5})$/i.exec(value || '');
  const number = match ? Number(match[1]) : 0;
  if (number < 1) throw new Error(`Invalid registration ID: ${value}`);
  return number;
}
export function parseOptions(args) {
  const options = { send: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--send') options.send = true;
    else if (arg === '--help') options.help = true;
    else if (['--from', '--to'].includes(arg)) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = args[++i];
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (options.help) return options;
  options.from = parseId(options.from);
  options.to = parseId(options.to);
  if (options.from > options.to) throw new Error('--from must be less than or equal to --to');
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
export function buildMessage(user) {
  const name = user.name.trim();
  const greeting = `Dear ${/^(dr\.?|prof\.?)\s/i.test(name) ? name : `Dr ${name}`},`;
  const paragraphs = [
    greeting,
    'Thank you for being part of AOACON 2026 in Shivamogga.',
    'As the conference comes to a close, we extend our heartfelt thanks for your participation. Your presence, thoughtful discussions and enthusiasm helped make this gathering a memorable experience.',
    'We hope you take home valuable insights, meaningful connections and fond memories of your time with us.',
    'You will receive your e-certificate of participation in the next few days.',
    'On behalf of the Organising Committee, thank you for your support and for contributing to the success of AOACON 2026. We look forward to meeting you again.',
    'Warm regards,\nOrganising Committee\nAOACON 2026',
  ];
  return {
    to: user.email.trim(),
    subject: 'Thank you for being part of AOACON 2026',
    text: paragraphs.join('\n\n'),
    html: `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank you · AOACON 2026</title></head>
<body style="margin:0;padding:0;background-color:#f2efe9;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Thank you for being part of AOACON 2026. Your e-certificate of participation will arrive in the next few days.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f2efe9"><tr><td align="center" style="padding:32px 12px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" bgcolor="#fffdf9" style="width:100%;max-width:600px;border:1px solid #e4ded3;">
<tr><td bgcolor="#152f40" style="padding:28px 30px;border-top:3px solid #b99860;">
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:27px;line-height:1.3;letter-spacing:1px;color:#ffffff;">AOACON <span style="color:#d7ba85;">2026</span></p>
<p style="margin:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:#d5dee3;">30 October – 1 November 2026 &nbsp;·&nbsp; Shivamogga</p>
</td></tr>
<tr><td style="padding:32px 30px 0;">
<p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.5;font-weight:bold;letter-spacing:2px;color:#92703c;">WITH SINCERE GRATITUDE</p>
<h1 style="margin:0 0 26px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:32px;line-height:1.3;color:#152f40;">Thank you for being part<br>of AOACON 2026.</h1>
</td></tr>
<tr><td style="padding:0 30px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.85;color:#4c5358;">
<p style="margin:0 0 20px;color:#243846;">${escapeHtml(greeting)}</p>
${paragraphs.slice(1,4).map(p => `<p style="margin:0 0 18px;">${escapeHtml(p)}</p>`).join('')}
</td></tr>
<tr><td style="padding:6px 30px 24px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#f4efe5" style="border-left:2px solid #b99860;"><tr><td style="padding:18px 20px;">
<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:10px;line-height:1.6;font-weight:bold;letter-spacing:1.5px;color:#92703c;">E-CERTIFICATE OF PARTICIPATION</p>
<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.8;color:#243846;">${escapeHtml(paragraphs[4])}</p>
</td></tr></table>
</td></tr>
<tr><td style="padding:0 30px 32px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.85;color:#4c5358;">
<p style="margin:0 0 26px;">${escapeHtml(paragraphs[5])}</p>
<p style="margin:0 0 6px;font-size:14px;">Warm regards,</p>
<p style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:20px;line-height:1.5;color:#152f40;">Organising Committee</p>
<p style="margin:4px 0 0;font-size:11px;letter-spacing:1px;color:#92703c;">AOACON 2026</p>
</td></tr>
</table></td></tr></table></body></html>`,
  };
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/send-thank-you.js --from AOA2026-0001 --to AOA2026-0100 [--send]\nRange is inclusive. Default: dry run. Only PAID registrations are eligible. One email per unique address. Random delay: 1–1.5 seconds. Successful sends are skipped on rerun.');
    return;
  }
  dotenv.config({ path: path.join(root, '.env') });
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
    const priorSends = await ledger.find({ campaign }).toArray();
    const priorById = new Map(priorSends.map(record => [record._id, record]));
    const queuedEmails = new Set();
    const jobs = [];
    let alreadySent = 0;
    let notPaid = 0;
    const errors = [];
    for (const registration of inRange) {
      if (registration.paymentStatus !== 'PAID') { console.log(`[SKIP] ${registration.registrationNumber}: ${registration.paymentStatus}`); notPaid++; continue; }
      const user = registration.userId;
      const email = user?.email?.trim().toLowerCase();
      const id = `${campaign}:${email}`;
      const prior = priorById.get(id);
      if (prior?.status === 'ACCEPTED') { console.log(`[SKIP] ${registration.registrationNumber}: already sent`); alreadySent++; continue; }
      if (prior) { errors.push(`${registration.registrationNumber}: earlier send attempt needs provider review (${prior.status}); no automatic resend`); continue; }
      if (!user?.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user?.email?.trim() || '') || user.isActive === false) {
        errors.push(`${registration.registrationNumber}: missing/invalid name or email, or inactive account`); continue;
      }
      if (queuedEmails.has(email)) continue;
      queuedEmails.add(email);
      jobs.push({ id, registration, user });
    }
    console.log(`\n${options.send ? 'SEND' : 'DRY RUN'} | inclusive ID range ${options.from}–${options.to} | found ${inRange.length} | to send ${jobs.length} | already sent ${alreadySent} | unpaid skipped ${notPaid}`);
    console.log(`Campaign: ${campaign}\nDelay: random 1–1.5 seconds between emails`);
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
        const { id, registration, user } = jobs[i];

        // Atomic claim prevents duplicate sends from overlapping ranges/processes.
        try {
          await ledger.insertOne({ _id: id, name: id, seq: 0, campaign, registrationId: registration._id, registrationNumber: registration.registrationNumber, email: user.email, status: 'SENDING', startedAt: new Date() });
        } catch (error) {
          if (error.code === 11000) throw new Error(`Another process claimed ${registration.registrationNumber}. Stop and rerun after it finishes.`);
          throw error;
        }
        try {
          const result = await sendEmail(buildMessage(user));
          await ledger.updateOne({ _id: id }, { $set: { status: 'ACCEPTED', acceptedAt: new Date(), provider: result.provider, messageId: result.messageId } });
          accepted++;
          console.log(`[${i + 1}/${jobs.length}] SENT ${registration.registrationNumber} -> ${user.email} (${result.provider}: ${result.messageId})`);
        } catch (error) {
          await ledger.updateOne({ _id: id }, { $set: { status: 'NEEDS_REVIEW', error: error.message, failedAt: new Date() } });
          throw new Error(`Stopped at ${registration.registrationNumber}: ${error.message}. Check provider acceptance before retrying; the script will not resend this record automatically.`);
        }
        if (i < jobs.length - 1 && !stopping) {
          const milliseconds = randomInt(1000, 1501);
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
