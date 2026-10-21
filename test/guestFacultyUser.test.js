import test from 'node:test';
import assert from 'node:assert/strict';
import User from '../models/User.js';
const fields = { name: 'Test Faculty', email: 'test@example.com', password: 'example-password', role: 'AOA' };
test('only guest faculty can omit a phone; invalid supplied phones are rejected', () => {
 assert.equal(new User({ ...fields, isGuestFaculty: true }).validateSync(), undefined);
 assert.ok(new User(fields).validateSync().errors.phone);
 assert.ok(new User({ ...fields, isGuestFaculty: true, phone: 'invalid' }).validateSync().errors.phone);
 const index = User.schema.indexes().find(([keys]) => keys.phone);
 assert.equal(index[1].unique, true);
 assert.deepEqual(index[1].partialFilterExpression, { phone: { $type: 'string' } });
});
