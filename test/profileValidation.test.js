import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlockedPlaceholderName,
  validateAttendeeName,
} from '../utils/profileValidation.js';

test('rejects exact placeholder attendee names regardless of case or spacing', () => {
  for (const name of ['Test', ' dummy ', 'SAMPLE']) {
    assert.equal(isBlockedPlaceholderName(name), true);
    assert.match(validateAttendeeName(name), /real full name/i);
  }
});

test('does not reject legitimate names containing similar text', () => {
  for (const name of ['Testa Rao', 'Sampley Kumar', 'Dr Dummyson']) {
    assert.equal(isBlockedPlaceholderName(name), false);
    assert.equal(validateAttendeeName(name), null);
  }
});
