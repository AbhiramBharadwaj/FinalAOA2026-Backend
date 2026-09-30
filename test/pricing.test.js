import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateRegistrationTotals, getAddOnPricing, getBookingPhase } from '../utils/pricing.js';

test('early-bird pricing remains active through October 15, 2026', () => {
  assert.equal(
    getBookingPhase(new Date(2026, 9, 15, 23, 59, 59, 999)),
    'EARLY_BIRD',
  );
});

test('spot pricing starts on October 16, 2026', () => {
  assert.equal(getBookingPhase(new Date(2026, 9, 16)), 'SPOT');
});

test('non-AOA combo offer remains available through October 15, 2026', () => {
  const totals = calculateRegistrationTotals('NON_AOA', 'EARLY_BIRD', {
    addLifeMembership: true,
  });

  assert.equal(totals.basePrice, 11000);
  assert.equal(totals.lifeMembershipAddOn, 3000);
  assert.equal(totals.packageBase, 14000);
});

test('non-AOA combo offer is closed from October 16, 2026', () => {
  const addOnPricing = getAddOnPricing('NON_AOA', 'SPOT');
  const totals = calculateRegistrationTotals('NON_AOA', 'SPOT', {
    addLifeMembership: true,
  });

  assert.equal(addOnPricing.lifeMembership.priceWithoutGST, 0);
  assert.equal(totals.basePrice, 16000);
  assert.equal(totals.lifeMembershipAddOn, 0);
  assert.equal(totals.packageBase, 16000);
});
