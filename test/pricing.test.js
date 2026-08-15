import test from 'node:test';
import assert from 'node:assert/strict';

import { getBookingPhase } from '../utils/pricing.js';

test('early-bird pricing remains active through August 31, 2026', () => {
  assert.equal(
    getBookingPhase(new Date(2026, 7, 31, 23, 59, 59, 999)),
    'EARLY_BIRD',
  );
});

test('regular pricing starts on September 1, 2026', () => {
  assert.equal(getBookingPhase(new Date(2026, 8, 1)), 'REGULAR');
});
