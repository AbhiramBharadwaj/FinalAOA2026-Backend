// Upload approved files only. Does not connect to MongoDB or send mail.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { certificateStorage } from '../services/certificateStorage.js';
import { fileType } from '../utils/certificatePortal.js';
const reportPath = 'reports/certificate-portal/storage-upload.json';
const plan = JSON.parse(await fs.readFile('reports/certificate-portal/import-plan.json', 'utf8'));
if (plan.issues.length || !plan.records.length) throw new Error('Import plan must be completely verified.');
let previous;
try { previous = JSON.parse(await fs.readFile(reportPath, 'utf8')); } catch(e) { if(e.code !== 'ENOENT') throw e; }
const bucket = process.env.CERTIFICATE_BUCKET_NAME;
if (bucket !== 'aoacon2026-certificates-private') throw new Error('Dedicated certificate bucket required.');
const saved = new Map((previous?.bucket === bucket ? previous.records : []).map(r => [r.sourceId, r]));
const storage = certificateStorage();
for (const row of plan.records) {
 const bytes = await fs.readFile(row.file);
 if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Changed certificate ${row.sourceId}`);
 fileType(bytes);
}
let completed = 0, cursor = 0;
const checkpoint = async () => {
 await fs.writeFile(`${reportPath}.tmp`, JSON.stringify({ bucket, checkedAt: new Date().toISOString(), records: [...saved.values()] }, null, 2)+'\n');
 await fs.rename(`${reportPath}.tmp`, reportPath);
};
// Serialize checkpoints so parallel uploads never race report writes.
let saveQueue = Promise.resolve();
async function worker() {
 while (cursor < plan.records.length) {
  const row = plan.records[cursor++];
  const prior = saved.get(row.sourceId);
  if (!prior || prior.sha256 !== row.sha256) {
   const bytes = await fs.readFile(row.file);
   if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error(`Changed certificate ${row.sourceId}`);
   const stored = await storage.put(bytes, fileType(bytes));
   saved.set(row.sourceId, { sourceId: row.sourceId, ...stored, bytes: bytes.length });
   saveQueue = saveQueue.then(checkpoint); await saveQueue;
  }
  completed++;
  if (completed % 25 === 0 || completed === plan.records.length) console.log(`Stored ${completed}/${plan.records.length}`);
 }
}
const outcomes = await Promise.allSettled(Array.from({ length: 12 }, worker));
await saveQueue;
const failure = outcomes.find(r => r.status === 'rejected');
if (failure) throw failure.reason;
console.log(`Private upload complete: ${completed}. No database writes or emails.`);
