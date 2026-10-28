import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { passwordResetLimiter } from '../middleware/rateLimits.js';

test('password reset isolates accounts and admin resets while retaining network limits', async () => {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());
  app.post(['/forgot-password', '/admin/forgot-password'], passwordResetLimiter, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (email, path = '/forgot-password', ip = '192.0.2.10') => fetch(url + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: JSON.stringify({ email }),
  });
  try {
    for (let i = 0; i < 5; i++) assert.equal((await request('one@example.com')).status, 200);
    const blocked = await request(' ONE@example.com ');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.match((await blocked.json()).message, /15 minutes/);
    assert.equal((await request('two@example.com')).status, 200);
    assert.equal((await request('one@example.com', '/admin/forgot-password')).status, 200);
    assert.equal((await request('one@example.com', '/forgot-password', '192.0.2.11')).status, 200);
    // Different emails cannot bypass the broader network ceiling.
    for (let i = 0; i < 50; i++) assert.equal((await request(`attendee${i}@example.com`, '/forgot-password', '192.0.2.12')).status, 200);
    assert.equal((await request('another@example.com', '/forgot-password', '192.0.2.12')).status, 429);
    // IPv6 address rotation within the same /56 must not bypass the account limit.
    for (let i = 1; i <= 5; i++) assert.equal((await request('ipv6@example.com', '/forgot-password', `2001:db8:1234:5600::${i}`)).status, 200);
    assert.equal((await request('ipv6@example.com', '/forgot-password', '2001:db8:1234:5600::6')).status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
