import test from 'node:test';
import assert from 'node:assert/strict';

import { getBookingPhase } from '../utils/pricing.js';

test('early-bird pricing remains active through September 15, 2026', () => {
  assert.equal(
    getBookingPhase(new Date(2026, 8, 15, 23, 59, 59, 999)),
    'EARLY_BIRD',
  );
});

test('regular pricing starts on September 16, 2026', () => {
  assert.equal(getBookingPhase(new Date(2026, 8, 16)), 'REGULAR');
});
