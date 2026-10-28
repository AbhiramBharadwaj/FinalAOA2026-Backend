import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateRegistrationTotals, getAddOnPricing, getBookingPhase } from '../utils/pricing.js';

test('early-bird pricing remains active through October 25, 2026 in India', () => {
  assert.equal(
    getBookingPhase(new Date('2026-10-25T23:59:59.999+05:30')),
    'EARLY_BIRD',
  );
});

test('spot pricing starts on October 26, 2026 at midnight in India', () => {
  assert.equal(getBookingPhase(new Date('2026-10-26T00:00:00+05:30')), 'SPOT');
});

test('spot workshop booking charges the approved 2000 add-on for every role', () => {
  for (const [role, expectedBase] of [['AOA', 13000], ['NON_AOA', 16000], ['PGS', 12000]]) {
    const quote = getAddOnPricing(role, 'SPOT');
    const totals = calculateRegistrationTotals(role, 'SPOT', { addWorkshop: true });
    assert.equal(quote.workshop.priceWithoutGST, 2000);
    assert.equal(totals.basePrice, expectedBase);
    assert.equal(totals.workshopAddOn, quote.workshop.priceWithoutGST);
    assert.equal(totals.packageBase, expectedBase + 2000);
    assert.equal(totals.gst, Math.round((expectedBase + 2000) * 0.18));
    assert.equal(totals.totalAmount, totals.packageBase + totals.gst);
  }
});

test('October 16 new registrations continue to receive early-bird prices', () => {
  const phase = getBookingPhase(new Date('2026-10-16T12:00:00+05:30'));
  assert.equal(phase, 'EARLY_BIRD');
  for (const [role, expectedPrice] of [['AOA', 8000], ['NON_AOA', 11000], ['PGS', 7000]]) {
    assert.equal(calculateRegistrationTotals(role, phase).basePrice, expectedPrice);
  }
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
