import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createSharedRouter, sharedResources } from '../routes/shared.js';

test('shared API protects data, validates queries, excludes secrets and disallows writes', async () => {
  const key = 'a'.repeat(64);
  let configured = key;
  let calls = 0;
  let observedFilter;
  const query = {
    select() { return this; }, populate() { return this; }, sort() { return this; },
    skip(value) { assert.equal(value, 2); return this; },
    limit(value) { assert.equal(value, 2); return this; },
    async lean() { return [{ registrationNumber: 'AOA2026-0001', paymentStatus: 'PAID',
      razorpayPaymentId: 'secret', manualRegistrationNotes: 'private',
      userId: { name: 'Test Attendee', email: 'test@example.com', password: 'secret', resetPasswordToken: 'secret' } }]; },
  };
  const model = {
    find(filter) { calls++; observedFilter = filter; return query; },
    async countDocuments() { return 3; },
  };
  const app = express();
  app.use('/api/shared', createSharedRouter({ model, getKey: () => configured }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/shared/registrations`;
  const headers = { Authorization: `Bearer ${key}` };
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal(calls, 0);
    configured = undefined;
    assert.equal((await fetch(url, { headers })).status, 503);
    configured = key;
    for (const queryString of ['limit=101', 'page=0', 'page[]=1', 'paymentStatus[$ne]=PAID', 'collection=users']) {
      assert.equal((await fetch(`${url}?${queryString}`, { headers })).status, 400);
    }
    assert.equal((await fetch(url, { method: 'POST', headers })).status, 405);
    assert.equal(calls, 0);
    const response = await fetch(`${url}?page=2&limit=2&paymentStatus=PAID`, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(observedFilter, { paymentStatus: 'PAID' });
    const body = await response.json();
    assert.deepEqual(body.pagination, { page: 2, limit: 2, total: 3, totalPages: 2 });
    assert.equal(body.data[0].attendee.email, 'test@example.com');
    assert.doesNotMatch(JSON.stringify(body), /secret|password|resetPasswordToken|manualRegistrationNotes|razorpay/);
    model.find = () => { throw new Error('private database details'); };
    const failure = await fetch(url, { headers });
    assert.equal(failure.status, 500);
    assert.doesNotMatch(await failure.text(), /private database details/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


test('all resource endpoints expose only their declared fields and safe nested data', async () => {
  const key = 'b'.repeat(64);
  const record = { _id: 'record-id', name: 'Test', password: 'PRIVATE', lastOtpHash: 'PRIVATE',
    uploadTokenHash: 'PRIVATE', qrCodeData: 'PRIVATE', razorpaySignature: 'PRIVATE',
    filePath: 'PRIVATE', cvR2Key: 'PRIVATE', adminNotes: 'PRIVATE',
    userId: { _id: 'user-id', name: 'Test', password: 'PRIVATE' },
    scanHistory: [{ scannedAt: '2026-10-27', location: 'Main Gate', count: 1, notes: 'PRIVATE', scannedBy: 'PRIVATE' }] };
  const query = { select() { return this; }, populate() { return this; }, sort() { return this; },
    skip() { return this; }, limit() { return this; }, async lean() { return [record]; } };
  const model = { find() { return query; }, async countDocuments() { return 1; } };
  const resources = Object.fromEntries(Object.entries(sharedResources).map(([name, config]) => [name, { ...config, model }]));
  const app = express();
  app.use('/api/shared', createSharedRouter({ model, resources, getKey: () => key }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/shared`;
  const headers = { Authorization: `Bearer ${key}` };
  try {
    const index = await (await fetch(base, { headers })).json();
    assert.deepEqual(index.resources, Object.keys(resources));
    for (const name of Object.keys(resources)) {
      const response = await fetch(`${base}/${name}`, { headers });
      assert.equal(response.status, 200, name);
      const body = await response.json();
      assert.equal(body.data[0].id, 'record-id');
      assert.doesNotMatch(JSON.stringify(body), /PRIVATE/);
      assert.equal((await fetch(`${base}/${name}`, { method: 'DELETE', headers })).status, 405);
    }
    assert.equal((await fetch(`${base}/admins`, { headers })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
