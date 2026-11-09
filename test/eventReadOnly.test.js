import test from 'node:test';
import assert from 'node:assert/strict';
import { eventReadOnly } from '../middleware/eventReadOnly.js';

function run(method, path) {
  const result = { allowed: false };
  const res = {
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; },
  };
  eventReadOnly({ method, path }, res, () => { result.allowed = true; });
  return result;
}

test('event mutations are closed, including admin and future endpoints', () => {
  for (const path of ['/auth/register', '/registration', '/payment/create-order/registration', '/payment/verify', '/abstract/submit', '/video/upload-url', '/feedback/submit', '/faculty-cv/upload', '/admin/manual-registrations', '/attendance/scan/mark', '/future-endpoint']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const result = run(method, path);
      assert.equal(result.status, 403);
      assert.equal(result.body.code, 'EVENT_CLOSED');
      assert.equal(result.allowed, false);
    }
  }
});

test('viewing, login, password recovery and existing gateway callbacks remain available', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) assert.equal(run(method, '/registration/my-registration').allowed, true);
  for (const path of ['/auth/login', '/auth/admin/login', '/auth/forgot-password', '/auth/reset-password', '/auth/admin/forgot-password', '/auth/admin/reset-password', '/payment/webhook']) {
    assert.equal(run('POST', path).allowed, true);
    assert.equal(run('POST', `${path}/`).allowed, true);
    assert.equal(run('DELETE', path).status, 403);
  }
});

test('only explicit certificate support mutations are reopened', () => {
  for (const [method, path] of [
    ['POST', '/certificates/approved-id-123/email'], ['POST', '/certificates/queries'],
    ['POST', '/certificates/admin/certificates'], ['PUT', '/certificates/admin/certificates/approved-id-123'],
    ['PUT', '/certificates/admin/queries/AOA-1234567890'], ['POST', '/certificates/admin/queries/AOA-1234567890/notify'],
  ]) assert.equal(run(method, path).allowed, true);
  for (const path of ['/certificates/future', '/certificates/admin/delete-all', '/certificates/admin/queries/bad/notify']) {
    assert.equal(run('POST', path).status, 403);
  }
  assert.equal(run('DELETE', '/certificates/admin/certificates/approved-id-123').status, 403);
});
