import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSesEmail, canFallbackFromSes, createSesEmailSender } from '../services/sesEmail.js';

test('SES preserves Unicode text, HTML, binary PDF and inline QR without double encoding', t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.SES_FROM_EMAIL = 'AOACON 2026 <info@aoacon2026.com>';
  process.env.SES_CONFIGURATION_SET = 'conference';
  const pdf = Buffer.from('pdf bytes'); const qr = Buffer.from('qr bytes');
  const result = buildSesEmail({ to: 'test@example.com', subject: 'Welcome — AOACON', text: 'Hello', html: '<img src="cid:qr">',
    attachments: [{ filename: 'brochure.pdf', content: pdf.toString('base64'), contentType: 'application/pdf' },
      { filename: 'qr.png', content: qr, content_type: 'image/png', cid: 'qr' }] });
  assert.equal(result.FromEmailAddress, process.env.SES_FROM_EMAIL);
  assert.deepEqual(result.Destination.ToAddresses, ['test@example.com']);
  assert.equal(result.Content.Simple.Subject.Charset, 'UTF-8');
  assert.equal(result.Content.Simple.Body.Html.Data, '<img src="cid:qr">');
  assert.deepEqual(result.Content.Simple.Attachments[0].RawContent, pdf);
  assert.deepEqual(result.Content.Simple.Attachments[1].RawContent, qr);
  assert.equal(result.Content.Simple.Attachments[0].ContentDisposition, 'ATTACHMENT');
  assert.equal(result.Content.Simple.Attachments[1].ContentDisposition, 'INLINE');
  assert.equal(result.Content.Simple.Attachments[1].ContentId, 'qr');
  assert.equal(result.ConfigurationSetName, 'conference');
});

test('SES uses Stockholm, disables automatic retries and returns acceptance ID/quota', async t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.SES_FROM_EMAIL = 'info@aoacon2026.com'; delete process.env.SES_REGION;
  const configs = [];
  const sender = createSesEmailSender({ createClient: config => {
    configs.push(config); return { send: async command => command.constructor.name === 'GetAccountCommand'
      ? { ProductionAccessEnabled: true, SendingEnabled: true, SendQuota: { Max24HourSend: 50000, SentLast24Hours: 12 } }
      : { MessageId: 'accepted-id' } };
  } });
  assert.deepEqual(await sender.send({ to: ['a@example.com'], subject: 'Test', text: 'Hello' }), { provider: 'ses', messageId: 'accepted-id' });
  const status = await sender.status();
  assert.equal(status.quota.SentLast24Hours, 12);
  assert.equal(configs.length, 1);
  assert.equal(configs[0].region, 'eu-north-1'); assert.equal(configs[0].maxAttempts, 1);
});

test('SES timeouts, unknown failures and missing acceptance cannot trigger a duplicate send', async t => {
  const env = { ...process.env }; t.after(() => { process.env = env; });
  process.env.SES_FROM_EMAIL = 'info@aoacon2026.com';
  for (const name of ['TimeoutError', 'Error', 'InternalServiceError', 'MessageRejected', 'BadRequestException']) {
    assert.equal(canFallbackFromSes({ name }), false);
  }
  assert.equal(canFallbackFromSes({ name: 'TooManyRequestsException' }), true);
  const sender = createSesEmailSender({ createClient: () => ({ send: async () => ({}) }) });
  await assert.rejects(sender.send({ to: 'test@example.com', subject: 'Test', text: 'Hi' }), /acceptance/);
});
