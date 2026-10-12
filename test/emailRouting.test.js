import test from 'node:test';
import assert from 'node:assert/strict';
import Counter from '../models/Counter.js';
import { sendEmail } from '../utils/email.js';

test('email routing respects quota, reset, rejection and attachments', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUpdate = Counter.updateOne;
  const originalFind = Counter.findOneAndUpdate;
  const env = { ...process.env };
  t.after(() => {
    globalThis.fetch = originalFetch;
    Counter.updateOne = originalUpdate;
    Counter.findOneAndUpdate = originalFind;
    process.env = env;
  });
  process.env.RESEND_API_KEY = 'test';
  process.env.RESEND_FROM = 'info@aoacon2026.com';
  process.env.ZOHO_CPAAS_API_KEY = 'test';
  process.env.RESEND_DAILY_SWITCH_LIMIT = '90';
  const counts = new Map();
  let used = 89;
  let reset = '2026-10-13T00:00:00Z';
  let failure;
  const sent = [];
  Counter.updateOne = async ({ name }, update) => {
    if (!counts.has(name)) counts.set(name, update.$setOnInsert?.seq ?? 0);
    if (update.$max) counts.set(name, Math.max(counts.get(name), update.$max.seq));
    if (update.$inc) counts.set(name, counts.get(name) + update.$inc.seq);
  };
  Counter.findOneAndUpdate = async ({ name, seq }, update) => {
    if (counts.get(name) > seq.$lte) return null;
    counts.set(name, counts.get(name) + update.$inc.seq);
    return { name };
  };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/usage')) return new Response(JSON.stringify({ emails: {
      daily: { used, limit: 100, resets_at: reset }, monthly: { used: 100, limit: 3000 },
    } }));
    const provider = url.includes('resend.com') ? 'resend' : 'zoho';
    sent.push({ provider, body: JSON.parse(options.body) });
    if (provider === 'resend' && failure === 'network') throw new Error('Network failed');
    if (provider === 'resend' && failure === 'quota') return new Response('daily_quota_exceeded', { status: 429 });
    return new Response(JSON.stringify(provider === 'zoho' ? { data: [{ code: 'EM_104' }] } : { id: 'test' }));
  };
  const message = { to: 'test@example.com', subject: 'Test', text: 'Test' };
  await sendEmail(message);
  assert.equal(sent.at(-1).provider, 'resend');
  await sendEmail({ ...message, attachments: [{ filename: 'test.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }] });
  assert.equal(sent.at(-1).provider, 'zoho');
  assert.equal(sent.at(-1).body.attachments[0].content, Buffer.from('pdf').toString('base64'));
  used = 0;
  reset = '2026-10-14T00:00:00Z';
  await sendEmail(message);
  assert.equal(sent.at(-1).provider, 'resend');
  failure = 'quota';
  await sendEmail(message);
  assert.equal(sent.at(-1).provider, 'zoho');
  failure = 'network';
  const before = sent.length;
  await assert.rejects(sendEmail(message), /Network failed/);
  assert.equal(sent.length, before + 1);
  failure = undefined;
  used = 89;
  reset = '2026-10-15T00:00:00Z';
  const start = sent.length;
  await Promise.all([sendEmail(message), sendEmail(message), sendEmail(message)]);
  assert.equal(sent.slice(start).filter(({ provider }) => provider === 'resend').length, 1);
});
