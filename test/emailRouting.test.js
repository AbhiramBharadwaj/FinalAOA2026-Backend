import test from 'node:test';
import assert from 'node:assert/strict';
import Counter from '../models/Counter.js';
import { sendEmail, getZohoQuotaCounterName } from '../utils/email.js';
import { sesEmailSender } from '../services/sesEmail.js';

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
  process.env.EMAIL_PROVIDER = 'auto';
  process.env.RESEND_FROM = 'info@aoacon2026.com';
  process.env.ZOHO_CPAAS_API_KEY = 'test';
  process.env.RESEND_DAILY_SWITCH_LIMIT = '75';
  const counts = new Map();
  let used = 74;
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
  used = 74;
  reset = '2026-10-15T00:00:00Z';
  const start = sent.length;
  await Promise.all([sendEmail(message), sendEmail(message), sendEmail(message)]);
  assert.equal(sent.slice(start).filter(({ provider }) => provider === 'resend').length, 1);
});

test('explicit SES tests bypass other providers and do not retry uncertain sends', async t => {
  const env = { ...process.env }; const send = sesEmailSender.send; const fetch = globalThis.fetch;
  t.after(() => { process.env = env; sesEmailSender.send = send; globalThis.fetch = fetch; });
  process.env.EMAIL_PROVIDER = 'ses';
  let calls = 0; globalThis.fetch = async () => { calls++; throw Error('Unexpected backup send'); };
  const message = { to: 'test@example.com', subject: 'Test', text: 'Test' };
  sesEmailSender.send = async () => ({ provider: 'ses', messageId: 'ses-test' });
  assert.equal((await sendEmail(message)).provider, 'ses');
  sesEmailSender.send = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };
  await assert.rejects(sendEmail(message), /timeout/); assert.equal(calls, 0);
});

test('Zoho has no application cap and SES is used only for an explicit rejection', async t => {
  const env = { ...process.env }; const send = sesEmailSender.send; const fetch = globalThis.fetch;
  const update = Counter.updateOne; const find = Counter.findOneAndUpdate;
  t.after(() => { process.env = env; sesEmailSender.send = send; globalThis.fetch = fetch; Counter.updateOne = update; Counter.findOneAndUpdate = find; });
  process.env.EMAIL_PROVIDER = 'auto'; process.env.RESEND_API_KEY = 'test'; process.env.ZOHO_CPAAS_API_KEY = 'test';
  let used = 100; let zohoCalls = 0; let sesCalls = 0; let failure;
  Counter.updateOne = async (_filter, op) => { if(op.$inc) used += op.$inc.seq; };
  Counter.findOneAndUpdate = async () => { throw Error('Zoho should not reserve quota'); };
  globalThis.fetch = async url => {
    if(url.endsWith('/usage')) return new Response('{}', {status:403});
    zohoCalls++;
    if(failure === 'network') throw Error('Unknown Zoho network failure');
    if(failure === 'quota') return new Response(JSON.stringify({message:'Rate limit'}), {status:429});
    return new Response(JSON.stringify({data:[{code:'EM_104'}]}));
  };
  sesEmailSender.send = async () => { sesCalls++; return {provider:'ses',messageId:'ses-test'}; };
  const message = {to:'test@example.com',subject:'Test',text:'Test'};
  const results = await Promise.all([sendEmail(message),sendEmail(message),sendEmail(message)]);
  assert.equal(zohoCalls,3);assert.equal(sesCalls,0);assert.equal(used,103);
  assert.ok(results.every(r=>r.provider==='zoho'));
  failure='quota';assert.equal((await sendEmail(message)).provider,'ses');assert.equal(sesCalls,1);
  failure='network';await assert.rejects(sendEmail(message),/Unknown Zoho/);assert.equal(sesCalls,1);
});

test('Zoho daily counter changes at the configured midnight', t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.ZOHO_QUOTA_TIMEZONE = 'Asia/Kolkata';
  assert.equal(getZohoQuotaCounterName(new Date('2026-10-12T18:29:59Z')), 'email:zoho:2026-10-12');
  assert.equal(getZohoQuotaCounterName(new Date('2026-10-12T18:30:00Z')), 'email:zoho:2026-10-13');
});

test('Zoho retries definite failures twice, preserves attachments, and stops on uncertain acceptance', async t => {
  const env = { ...process.env }; const send = sesEmailSender.send; const fetch = globalThis.fetch;
  const update = Counter.updateOne;
  t.after(() => { process.env = env; sesEmailSender.send = send; globalThis.fetch = fetch; Counter.updateOne = update; });
  process.env.EMAIL_PROVIDER = 'auto'; process.env.ZOHO_CPAAS_API_KEY = 'test';
  const message = { to: 'test@example.com', subject: 'Test', text: 'Hi',
    attachments: [{ filename: 'brochure.pdf', content: Buffer.from('pdf'), contentType: 'application/pdf' }] };
  let replies = []; let calls = []; let sesCalls = 0; let trackingFails = false;
  Counter.updateOne = async () => { if (trackingFails) throw Error('Tracking unavailable'); };
  sesEmailSender.send = async received => {
    sesCalls++;
    assert.equal(received.attachments, message.attachments);
    return { provider: 'ses', messageId: 'accepted' };
  };
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/usage')) return new Response('{}', { status: 403 });
    calls.push(JSON.parse(options.body));
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const rejected = () => new Response(JSON.stringify({ error: { message: 'Authentication failed' } }), { status: 401 });
  const accepted = () => new Response(JSON.stringify({ data: [{ code: 'EM_104' }] }));

  replies = [rejected(), accepted()];
  assert.equal((await sendEmail(message)).provider, 'zoho');
  assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(sesCalls, 0);

  calls = []; replies = [rejected(), rejected()];
  assert.equal((await sendEmail(message)).provider, 'ses');
  assert.equal(calls.length, 2); assert.equal(sesCalls, 1);

  calls = []; replies = [rejected(), new Error('Response lost')];
  await assert.rejects(sendEmail(message), /Response lost/);
  assert.equal(calls.length, 2); assert.equal(sesCalls, 1);

  calls = []; replies = [new Response('upstream failed', { status: 503 })];
  await assert.rejects(sendEmail(message), /unconfirmed/);
  assert.equal(calls.length, 1); assert.equal(sesCalls, 1);

  calls = []; replies = [new Response('{}')];
  await assert.rejects(sendEmail(message), /Zoho email rejected/);
  assert.equal(calls.length, 1); assert.equal(sesCalls, 1);

  trackingFails = true; calls = []; replies = [accepted()];
  assert.equal((await sendEmail(message)).provider, 'zoho');
  assert.equal(calls.length, 1); assert.equal(sesCalls, 1);
});
