import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import Registration from '../models/Registration.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';

const root = fileURLToPath(new URL('../', import.meta.url));
export const spreadsheetId = '12GRQlhlcViFTK4y8od9y_YuV3hTg1yP1czvOjrV9ljY';
export const tracks = [
  { title: 'Labour Analgesia', keys: ['labour-analgesia'] },
  { title: 'Critical Incidents in Obstetric Anaesthesia', keys: ['critical-incidents', 'critical-incidents-ob-anaesthesia'] },
  { title: 'POCUS in Obstetrics', keys: ['pocus', 'pocus-regional-anaesthesia-obstetrics'] },
  { title: 'Maternal Resuscitation', keys: ['maternal-collapse'] },
  { title: 'AOA Certified Obstetric Critical Care Course', course: true },
];
const candidateHeaders = ['Registration ID', 'Name', 'Email', 'Phone', 'Membership Category', 'Institute', 'Designation', 'City', 'Payment Status'];
const masterHeaders = ['Registration No', 'QR Data', 'Name', 'Phone', 'Email', 'Role', 'Package', 'Workshop', 'Amount Paid', 'Payment', 'QR Status', 'Checked In', 'Total Scans', 'Created At'];
const candidate = r => { const u = r.userId || {}; return [r.registrationNumber, u.name || '', u.email || '', u.phone || '', u.role || '', u.instituteHospital || '', u.designation || '', u.city || '', r.paymentStatus]; };
const sequence = r => Number(/^AOA2026-(\d+)$/.exec(r.registrationNumber || '')?.[1]);
const isCourse = r => r.addAoaCourse === true || r.registrationType === 'AOA_CERTIFIED_COURSE';
const isWorkshop = r => Boolean(r.addWorkshop || r.selectedWorkshop || r.registrationType === 'WORKSHOP_CONFERENCE');
const packageLabel = r => { const labels = []; if (isWorkshop(r)) labels.push('Workshop'); if (isCourse(r)) labels.push('AOA Certified Course'); if (r.addLifeMembership) labels.push('AOA Life Membership'); return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only'; };
export function buildTabs(registrations, attendances) {
  const paid = registrations.filter(r => r.paymentStatus === 'PAID').sort((a, b) => sequence(a) - sequence(b));
  const qrById = new Map(attendances.map(a => [String(a.registrationId), a]));
  const errors = [];
  for (const r of paid) {
    if (!sequence(r)) errors.push(`Invalid registration number: ${r.registrationNumber}`);
    if (!r.userId) errors.push(`Missing user: ${r.registrationNumber}`);
    if (isWorkshop(r) && !tracks.some(t => t.keys?.includes(r.selectedWorkshop))) errors.push(`Unknown/missing workshop ${JSON.stringify(r.selectedWorkshop)} for ${r.registrationNumber}`);
    if (r.registrationType === 'COMBO' && !r.addWorkshop && !r.addAoaCourse) errors.push(`Ambiguous legacy COMBO selection: ${r.registrationNumber}`);
  }
  if (new Set(paid.map(r => r.registrationNumber)).size !== paid.length) errors.push('Duplicate registration IDs');
  if (errors.length) throw new Error(errors.join('\n'));
  const master = paid.map(r => {
    const u = r.userId;
    const a = qrById.get(String(r._id));
    return [r.registrationNumber, a?.qrCodeData || '', u.name || '', u.phone || '', u.email || '', u.role || '', packageLabel(r), tracks.find(t => t.keys?.includes(r.selectedWorkshop))?.title || '', Number(r.totalPaid ?? 0), r.paymentStatus, a?.qrCodeData ? (a.isActive === false ? 'Inactive' : 'Generated') : 'Missing', Number(a?.totalScans || 0) > 0 ? 'Yes' : 'No', Number(a?.totalScans || 0), r.createdAt ? new Date(r.createdAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : ''];
  });
  return [{ title: 'Offline List', values: [masterHeaders, ...master] }, ...tracks.map(t => ({ title: t.title, values: [candidateHeaders, ...paid.filter(r => t.course ? isCourse(r) : t.keys.includes(r.selectedWorkshop)).map(candidate)] }))];
}
const configFile = process.env.REGISTRATION_SHEET_SYNC_CONFIG || path.join(root, '.local', 'registration-sheet-sync.json');
export function signRequest(secret, request) {
  const payload = JSON.stringify({ ...request, timestamp: Date.now() });
  return { payload, signature: createHmac('sha256', secret).update(payload).digest('base64') };
}
async function loadConfig() {
  try { return JSON.parse(await fs.readFile(configFile, 'utf8')); }
  catch { throw new Error('Run --setup first, then follow docs/google-sheets-sync.md.'); }
}
async function saveConfig(config) {
  await fs.mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
}
async function main() {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--web-app') { if (!args[++i]) throw new Error('Missing web app URL'); continue; }
    if (!['--setup', '--apply', '--help'].includes(args[i])) throw new Error(`Unknown option: ${args[i]}`);
  }
  if (args.includes('--help')) {
    console.log('Preview: node scripts/sync-registration-sheets.js\nOne-time setup: --setup, then --web-app GOOGLE_WEB_APP_URL\nRefresh six Google Sheets tabs with embedded QR images: --apply\nInstructions: docs/google-sheets-sync.md'); return;
  }
  if (args.includes('--setup')) {
    let config;
    try { config = JSON.parse(await fs.readFile(configFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    config ||= { secret: randomBytes(32).toString('hex') };
    await saveConfig(config);
    console.log(`Set the Google Apps Script property SYNC_SECRET to:\n${config.secret}\n\nKeep this key private. Setup instructions: docs/google-sheets-sync.md`); return;
  }
  if (args.includes('--web-app')) {
    const url = new URL(args[args.indexOf('--web-app') + 1]);
    if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) throw new Error('Use the deployed https://script.google.com/macros/s/.../exec URL.');
    const config = await loadConfig(); config.url = url.toString(); await saveConfig(config);
    console.log('Web app URL saved. Run without flags to preview, or with --apply to update.'); return;
  }
  dotenv.config({ path: path.join(root, '.env') });
  const server = await fs.readFile(path.join(root, 'server.js'), 'utf8');
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || server.match(/mongoose\.connect\(\s*["']([^"']+)["']/)?.[1];
  if (!uri) throw new Error('MongoDB configuration is missing');
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  let tabs;
  try {
    const registrations = await Registration.find({ paymentStatus: 'PAID' }).populate({ path: 'userId', model: User, select: 'name email phone role instituteHospital designation city' }).lean();
    const attendance = await Attendance.find({ registrationId: { $in: registrations.map(r => r._id) } }).lean();
    tabs = buildTabs(registrations, attendance);
  } finally { await mongoose.disconnect(); }
  for (const tab of tabs) console.log(`${tab.title}: ${tab.values.length - 1} candidates`);
  if (!args.includes('--apply')) { console.log('Preview only. No spreadsheet changes. Add --apply after one-time setup.'); return; }
  if (tabs[0].values.length < 2) throw new Error('No paid registrations returned; refusing to clear the spreadsheet.');
  const config = await loadConfig();
  if (!config.url || !config.secret) throw new Error('Finish --setup and --web-app first.');
  const call = async request => {
    const started = Date.now();
    const heartbeat = setInterval(() => console.log(`Waiting for Google: ${request.action} (${Math.round((Date.now() - started) / 1000)} seconds)…`), 20000);
    try {
      const response = await fetch(config.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signRequest(config.secret, request)), signal: AbortSignal.timeout(360000) });
      const text = await response.text();
      let result;
      try { result = JSON.parse(text); } catch { throw new Error('Google did not return JSON. Check deployment access is Anyone and use the /exec URL.'); }
      if (!response.ok || !result.ok) throw new Error(result.error || `Google web app returned ${response.status}`);
      return result;
    } finally { clearInterval(heartbeat); }
  };
  const qrItems = tabs[0].values.slice(1).flatMap((row, i) => row[1] ? [{
    row: i + 2, registrationNumber: row[0],
    hash: createHash('sha256').update(row[1]).digest('hex'), data: row[1],
  }] : []);
  console.log('Backing up current spreadsheet values…');
  const snapshot = await call({ action: 'snapshot' });
  if (!snapshot.incrementalQr) throw new Error('Redeploy the updated RegistrationSync.gs helper before syncing. No spreadsheet changes made.');
  await fs.mkdir(path.join(root, '.local'), { recursive: true, mode: 0o700 });
  const backupFile = path.join(root, '.local', `sheet-backup-${Date.now()}.json`);
  await fs.writeFile(backupFile, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  const runId = randomBytes(16).toString('hex');
  const googleTabs = tabs.map((tab, index) => index ? tab : { ...tab, values: tab.values.map((row, i) => { const copy = [...row]; copy[1] = i ? '' : 'QR Code'; return copy; }) });
  console.log('Updating changed cells and reconciling existing QR images…');
  const updated = await call({ action: 'replace', tabs: googleTabs, runId,
    qrItems: qrItems.map(({ data, ...item }) => item) });
  if (!Array.isArray(updated.neededImages)) throw new Error('Redeploy the updated RegistrationSync.gs helper before syncing.');
  const needed = new Set(updated.neededImages);
  const images = [];
  for (const item of qrItems.filter(item => needed.has(item.registrationNumber))) {
    const { data, ...metadata } = item;
    const png = await QRCode.toBuffer(data, { width: 200, margin: 2, color: { dark: '#0d47a1', light: '#ffffff' } });
    images.push({ ...metadata, png: png.toString('base64') });
  }
  console.log(`${qrItems.length - images.length} QR images retained; ${images.length} require upload.`);
  for (let i = 0; i < images.length; i += 25) {
    await call({ action: 'images', images: images.slice(i, i + 25), runId });
    console.log(`QR images: ${Math.min(i + 25, images.length)}/${images.length}`);
  }
  const verified = await call({ action: 'verify', runId });
  for (let i = 0; i < googleTabs.length; i++) {
    const actual = verified.tabs.find(t => t.title === googleTabs[i].title)?.values;
    // Apps Script prefixes formula-looking text with an apostrophe to keep it literal.
    const normalize = rows => rows?.map(row => row.map(value => typeof value === 'string' && /^'[=+\-@]/.test(value) ? value.slice(1) : value));
    if (JSON.stringify(normalize(actual)) !== JSON.stringify(normalize(googleTabs[i].values))) throw new Error(`Readback mismatch: ${googleTabs[i].title}. Inspect the sheet.`);
  }
  const expected = new Set(qrItems.map(i => `${i.registrationNumber}:${i.row}`));
  if (verified.images.length !== qrItems.length || verified.images.some(i => !expected.has(`${i.registrationNumber}:${i.row}`))) throw new Error('QR image verification failed. Rerun the complete sync after 15 minutes.');
  console.log(`Updated and verified all six tabs and ${qrItems.length} QR images (${images.length} uploaded).\n${verified.url}\nPrevious cell values saved: ${backupFile}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
