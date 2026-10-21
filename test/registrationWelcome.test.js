import test from 'node:test';
import assert from 'node:assert/strict';
import { parseId, parseOptions, packageLabel, buildMessage } from '../scripts/send-registration-welcome.js';

test('welcome CLI validates inclusive ranges and requires an explicit send flag', () => {
  assert.equal(parseId('AOA2026-0567'), 567);
  assert.equal(parseId('567'), 567);
  assert.equal(parseOptions(['--from', '1', '--to', '900']).send, false);
  assert.equal(parseOptions(['--from', '1', '--to', '900', '--send']).send, true);
  for (const args of [[], ['--from','0','--to','10'], ['--from','10','--to','1'], ['--from','1','--to','2','--sen'], ['--from','1','--to']]) assert.throws(() => parseOptions(args));
});

test('welcome includes personalised details and approved programme wording without billing', () => {
  const message = buildMessage({ name: 'Dr Test <Name>', email: 'test@example.com' }, { registrationNumber: 'AOA2026-0567', registrationType: 'CONFERENCE_ONLY' });
  assert.match(message.text, /Dear Dr Test <Name>,/);
  assert.doesNotMatch(message.text, /Dr Dr/);
  assert.match(message.html, /Dr Test &lt;Name&gt;/);
  assert.match(message.text, /The scientific programme is attached for your reference, with details of the sessions and schedule\./);
  assert.match(message.html, /cid:welcome-qr/);
  assert.match(message.text, /Registration ID: AOA2026-0567/);
  assert.doesNotMatch(message.text + message.html, /final|invoice|payment|international faculty/i);
});

test('package labels cover current and legacy registration selections', () => {
  assert.equal(packageLabel({ registrationType: 'CONFERENCE_ONLY' }), 'Conference Only');
  assert.equal(packageLabel({ addWorkshop: true }), 'Conference + Workshop');
  assert.equal(packageLabel({ registrationType: 'WORKSHOP_CONFERENCE' }), 'Conference + Workshop');
  assert.equal(packageLabel({ registrationType: 'AOA_CERTIFIED_COURSE' }), 'Conference + AOA Certified Course');
  assert.equal(packageLabel({ addAoaCourse: true, addLifeMembership: true }), 'Conference + AOA Certified Course + AOA Life Membership');
});
