import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTabs, signRequest } from '../scripts/sync-registration-sheets.js';
const user = { name: 'Test', email: 'test@example.com', phone: '001234567890', role: 'AOA' };
const registration = (id, more = {}) => ({ _id: id, registrationNumber: `AOA2026-${id.padStart(4, '0')}`, paymentStatus: 'PAID', registrationType: 'CONFERENCE_ONLY', userId: user, totalPaid: 0, ...more });
test('six tabs include only paid registrations and correctly group legacy/current tracks', () => {
 const rows = [registration('2', { selectedWorkshop: 'critical-incidents-ob-anaesthesia', addWorkshop: true }), registration('1', { addAoaCourse: true }), registration('3', { registrationType: 'AOA_CERTIFIED_COURSE' }), registration('4', { paymentStatus: 'PENDING' })];
 const tabs = buildTabs(rows, []);
 assert.equal(tabs.length, 6);
 assert.equal(tabs[0].values.length, 4);
 assert.equal(tabs[2].values.length, 2);
 assert.equal(tabs[5].values.length, 3);
 assert.equal(tabs[0].values[1][0], 'AOA2026-0001');
 assert.equal(tabs[5].values[1][3], '001234567890');
 assert.equal(tabs[5].values[1][5], '');
 assert.equal(tabs[0].values[1][8], 0);
});
test('ambiguous workshop selections stop before writing', () => {
 assert.throws(() => buildTabs([registration('1', { addWorkshop: true })], []), /Unknown\/missing workshop/);
 assert.throws(() => buildTabs([registration('1', { userId: null })], []), /Missing user/);
});
test('signed requests bind the exact content to the local secret', async () => {
 const { createHmac } = await import('node:crypto');
 const envelope = signRequest('local-key', { action: 'snapshot' });
 assert.equal(envelope.signature, createHmac('sha256', 'local-key').update(envelope.payload).digest('base64'));
 assert.equal(JSON.parse(envelope.payload).action, 'snapshot');
 assert.ok(Math.abs(JSON.parse(envelope.payload).timestamp - Date.now()) < 1000);
 assert.notEqual(envelope.signature, createHmac('sha256', 'another-key').update(envelope.payload).digest('base64'));
});

test('Google helper rejects unsigned requests before accessing spreadsheet data', async () => {
 const vm = await import('node:vm');
 const fs = await import('node:fs/promises');
 const { createHmac } = await import('node:crypto');
 let reads = 0;
 const context = vm.createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-secret' }) },
  Utilities: { Charset: { UTF_8: 'utf8' }, computeHmacSha256Signature: (payload, secret) => createHmac('sha256', secret).update(payload).digest(), base64Encode: value => Buffer.from(value).toString('base64') },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) },
  SpreadsheetApp: { openById: () => { reads++; return { getSheetByName: () => null }; } },
 });
 vm.runInContext(await fs.readFile(new URL('../scripts/google-apps-script/RegistrationSync.gs', import.meta.url), 'utf8'), context);
 assert.equal(context.doPost({ postData: { contents: JSON.stringify({ payload: '{}', signature: 'bad' }) } }).ok, false);
 assert.equal(reads, 0);
 const result = context.doPost({ postData: { contents: JSON.stringify(signRequest('test-secret', { action: 'snapshot' })) } });
 assert.equal(result.ok, true);
 assert.equal(result.tabs.length, 6);
 assert.equal(reads, 1);
});

test('QR reconciliation retains unchanged images, moves rows, and replaces changed or duplicate images', async () => {
 const vm = await import('node:vm');
 const fs = await import('node:fs/promises');
 const context = vm.createContext({});
 vm.runInContext(await fs.readFile(new URL('../scripts/google-apps-script/RegistrationSync.gs', import.meta.url), 'utf8'), context);
 const events = [];
 const image = (id, hash, row) => ({
  getAltTextTitle: () => id, getAltTextDescription: () => hash,
  getAnchorCell: () => ({ getRow: () => row, getColumn: () => 2 }),
  remove: () => events.push(`remove:${id}`),
  setAnchorCell(cell) { events.push(`move:${id}:${cell.row}`); return this; },
  setAnchorCellXOffset() { return this; }, setAnchorCellYOffset() { return this; },
 });
 const sheet = { getImages: () => [image('same', 'a', 2), image('moved', 'b', 3), image('changed', 'old', 4), image('removed', 'd', 5), image('same', 'a', 2)], getRange: row => ({ row }) };
 const manifest = [{ registrationNumber: 'same', hash: 'a', row: 2 }, { registrationNumber: 'moved', hash: 'b', row: 4 }, { registrationNumber: 'changed', hash: 'new', row: 3 }, { registrationNumber: 'new', hash: 'e', row: 5 }];
 assert.deepEqual(Array.from(context.reconcileImages_(sheet, manifest)), ['changed', 'new']);
 assert.deepEqual(events, ['move:moved:4', 'remove:changed', 'remove:removed', 'remove:same']);
 events.length = 0;
 sheet.getImages = () => manifest.map(item => image(item.registrationNumber, item.hash, item.row));
 assert.deepEqual(Array.from(context.reconcileImages_(sheet, manifest)), []);
 assert.deepEqual(events, []);
});
