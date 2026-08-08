import test from 'node:test';
import assert from 'node:assert/strict';
import { getSafeErrorResponse } from '../utils/httpError.js';

test('returns an actionable field message for validation errors', () => {
  const response = getSafeErrorResponse({
    name: 'ValidationError',
    errors: {
      pincode: { message: 'Enter a valid pincode containing 4-10 digits' },
    },
  });

  assert.deepEqual(response, {
    status: 400,
    message: 'Pincode: Enter a valid pincode containing 4-10 digits',
  });
});

test('returns a useful duplicate membership ID message', () => {
  const response = getSafeErrorResponse({
    code: 11000,
    keyPattern: { membershipId: 1 },
  });

  assert.deepEqual(response, {
    status: 400,
    message: 'This AOA Membership ID is already registered. Please check the ID or sign in.',
  });
});

test('does not expose unexpected internal error details', () => {
  const response = getSafeErrorResponse(
    new Error('mongodb://username:password@example.invalid'),
    'Profile could not be saved. Please try again.'
  );

  assert.deepEqual(response, {
    status: 500,
    message: 'Profile could not be saved. Please try again.',
  });
});
