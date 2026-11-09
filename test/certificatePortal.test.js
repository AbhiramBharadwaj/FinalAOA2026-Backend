import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createCertificateRouter } from '../routes/certificates.js';
import { searchFilter, publicCertificate, certificateCategories, certificateEmail, fileType, personKey } from '../utils/certificatePortal.js';

const id = 'approved-certificate-123';
const row = { publicId: id, personKey: 'private-key', name: 'Dr. Ananya Rao', email: 'registered@example.com', category: 'conference', role: 'Faculty', title: 'AOACON 2026', published: true, objectKey: 'private/file', contentType: 'image/png' };
const chain = value => ({ select() { return this; }, limit() { return this; }, sort() { return this; }, skip() { return this; }, lean: async () => value });
async function appFor(t, dependencies = {}) {
  const app = express(); app.use(express.json());
  app.use('/api/certificates', createCertificateRouter({ enabled: () => true, limiters: false,
    adminAuth: (req, res) => res.status(401).json({ message: 'Unauthorized' }), ...dependencies }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  return async (path, body, method = 'POST') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/certificates${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
}
test('public projection contains no email, storage keys or notes; Nursing excluded', () => {
  assert.deepEqual(Object.keys(publicCertificate(row)).sort(), ['category', 'id', 'name', 'registrationNumber', 'role', 'title']);
  assert.equal(certificateCategories.includes('nursing'), false);
  assert.notEqual(personKey('shared@example.com', 'Dr. Ananya Rao'), personKey('shared@example.com', 'Dr. Priya Rao'));
  assert.equal(personKey('shared@example.com', 'Dr. Ananya Rao'), personKey('shared@example.com', 'ANANYA RAO'));
  assert.throws(() => searchFilter({ $ne: null }), /Search/);
  const filter = searchFilter('A.* Rao');
  assert.equal(filter.published, true);
  assert.equal(filter.$or[1].registrationNumber.test('AXXX Rao'), false);
  assert.throws(() => fileType(Buffer.from('not a certificate')));
  assert.equal(certificateEmail({ ...row, name: '<script>' }).html.includes('<script>'), false);
});
test('search groups certificates and suppresses superseded conference delegate', async t => {
  const fetcher = await appFor(t, { certs: { find(filter) {
    return chain(filter.personKey ? [row, { ...row, publicId: 'old-delegate', role: 'Delegate' }] : [{ personKey: row.personKey }]);
  } } });
  const result = await fetcher('/search?q=Ananya');
  assert.equal(result.status, 200);
  assert.equal(result.body.people[0].certificates.length, 1);
  assert.equal(JSON.stringify(result.body).includes('registered@example.com'), false);
  assert.equal(JSON.stringify(result.body).includes('private-key'), false);
});
test('feature off blocks delivery; hidden certificates cannot be downloaded; admin requires authentication', async t => {
  let called = false;
  const fetcher = await appFor(t, { certs: { findOne(filter) { assert.equal(filter.published, true); return chain(null); } }, storage() { called = true; } });
  assert.equal((await fetcher(`/${id}/download`)).status, 404);
  assert.equal(called, false);
  assert.equal((await fetcher('/admin/certificates')).status, 401);
  const disabled = await appFor(t, { enabled: () => false });
  assert.equal((await disabled(`/${id}/email`, {})).status, 503);
});
test('alternative delivery address does not overwrite registered address; same request never sends twice', async t => {
  let sent = 0, attempt, update;
  const fetcher = await appFor(t, {
    certs: { findOne: () => chain(row), async findOneAndUpdate(filter, mutation) { update = mutation; return row; } },
    deliveries: { findOne: () => chain(attempt), async create(value) { attempt = { ...value, _id: 'attempt' }; return attempt; }, async updateOne(filter, mutation) { Object.assign(attempt, mutation.$set); } },
    storage: () => ({ read: async () => Buffer.from('approved bytes') }),
    mail: async payload => { sent++; assert.equal(payload.to, 'new@example.com'); assert.equal(payload.attachments[0].content.toString(), 'approved bytes'); return { provider: 'mock', messageId: 'mock-id' }; },
  });
  const request = { email: 'new@example.com', requestId: 'unique-request-1234' };
  assert.equal((await fetcher(`/${id}/email`, request)).status, 200);
  assert.equal((await fetcher(`/${id}/email`, request)).status, 200);
  assert.equal(sent, 1);
  assert.equal(row.email, 'registered@example.com');
  assert.deepEqual(Object.keys(update.$set), ['lastEmailRequestedAt']);
  assert.equal(attempt.status, 'accepted');
});
test('uncertain provider response is recorded and is never automatically retried', async t => {
  let attempt, sent = 0;
  const fetcher = await appFor(t, {
    certs: { findOne: () => chain(row), findOneAndUpdate: async () => row },
    deliveries: { findOne: () => chain(attempt), create: async value => (attempt = { ...value, _id: 'attempt' }), updateOne: async (filter, mutation) => Object.assign(attempt, mutation.$set) },
    storage: () => ({ read: async () => Buffer.from('bytes') }), mail: async () => { sent++; throw new Error('Timeout'); },
  });
  const body = { email: 'new@example.com', requestId: 'unique-request-5678' };
  assert.equal((await fetcher(`/${id}/email`, body)).status, 502);
  assert.equal(attempt.status, 'unknown');
  assert.equal((await fetcher(`/${id}/email`, body)).status, 409);
  assert.equal(sent, 1);
});
test('a person with no certificate can submit a query without triggering email', async t => {
  let saved;
  const fetcher = await appFor(t, { queries: { create: async value => (saved = value) }, mail: () => { throw new Error('Must not send'); } });
  const result = await fetcher('/queries', { name: 'Ananya Rao', email: 'contact@example.com', issue: 'missing', remarks: 'My faculty certificate is missing.' });
  assert.equal(result.status, 201);
  assert.match(result.body.reference, /^AOA-[A-F0-9]{10}$/);
  assert.equal(saved.certificateId, '');
});

test('organiser role correction requires an approved replacement certificate', async t => {
  let saved = false;
  const fetcher = await appFor(t, {
    adminAuth: (req, res, next) => { req.admin = { email: 'organiser@example.com' }; next(); },
    certs: { findOne: async () => ({ ...row, history: [], save: async () => { saved = true; } }) },
    storage: () => { throw new Error('Must not upload'); },
  });
  const result = await fetcher(`/admin/certificates/${id}`, { name: row.name, role: 'Delegate', email: row.email, note: 'Reviewed role correction' }, 'PUT');
  assert.equal(result.status, 400);
  assert.match(result.body.message, /Upload a corrected certificate/);
  assert.equal(saved, false);
});
test('manual certificate creation rejects Nursing and never uploads an invalid mapping', async t => {
  let uploaded = false;
  const fetcher = await appFor(t, {
    adminAuth: (req, res, next) => next(),
    storage: () => { uploaded = true; },
  });
  const result = await fetcher('/admin/certificates', { name: row.name, role: 'Delegate', title: 'Nursing Workshop', email: row.email, category: 'nursing' });
  assert.equal(result.status, 400);
  assert.match(result.body.message, /Invalid certificate category/);
  assert.equal(uploaded, false);
});
