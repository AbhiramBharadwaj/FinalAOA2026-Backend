import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateRegistrationTotals, getAddOnPricing, getBookingPhase } from '../utils/pricing.js';

test('early-bird pricing remains active through September 30, 2026', () => {
  assert.equal(
    getBookingPhase(new Date(2026, 8, 30, 23, 59, 59, 999)),
    'EARLY_BIRD',
  );
});

test('regular pricing starts on October 1, 2026', () => {
  assert.equal(getBookingPhase(new Date(2026, 9, 1)), 'REGULAR');
});

test('non-AOA combo offer remains available through September 30, 2026', () => {
  const totals = calculateRegistrationTotals('NON_AOA', 'EARLY_BIRD', {
    addLifeMembership: true,
  });

  assert.equal(totals.basePrice, 11000);
  assert.equal(totals.lifeMembershipAddOn, 3000);
  assert.equal(totals.packageBase, 14000);
});

test('non-AOA combo offer is closed from October 1, 2026', () => {
  const addOnPricing = getAddOnPricing('NON_AOA', 'REGULAR');
  const totals = calculateRegistrationTotals('NON_AOA', 'REGULAR', {
    addLifeMembership: true,
  });

  assert.equal(addOnPricing.lifeMembership.priceWithoutGST, 0);
  assert.equal(totals.basePrice, 13000);
  assert.equal(totals.lifeMembershipAddOn, 0);
  assert.equal(totals.packageBase, 13000);
});
