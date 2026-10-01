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

test('early-bird pricing remains unchanged after combo offer is closed', () => {
  const totals = calculateRegistrationTotals('NON_AOA', 'EARLY_BIRD', {
    addLifeMembership: true,
  });

  assert.equal(totals.basePrice, 11000);
  assert.equal(totals.lifeMembershipAddOn, 0);
  assert.equal(totals.packageBase, 11000);
});

test('combo offer is closed for every role and phase', () => {
  for (const role of ['AOA', 'NON_AOA', 'PGS']) {
    for (const phase of ['EARLY_BIRD', 'REGULAR', 'SPOT']) {
      const addOnPricing = getAddOnPricing(role, phase);
      const totals = calculateRegistrationTotals(role, phase, {
        addLifeMembership: true,
      });

      assert.equal(addOnPricing.lifeMembership.priceWithoutGST, 0);
      assert.equal(totals.lifeMembershipAddOn, 0);
      assert.equal(totals.packageBase, totals.basePrice);
    }
  }
});
