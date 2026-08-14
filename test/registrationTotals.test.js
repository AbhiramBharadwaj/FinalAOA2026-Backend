import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AOA_COURSE_CAPACITY,
  computeRegistrationTotals,
  normalizeCouponCode,
} from '../utils/registrationTotals.js';

test('normalizes and applies AOACON50011 to the conference base price', () => {
  const withoutCoupon = computeRegistrationTotals({
    role: 'NON_AOA',
    bookingPhase: 'EARLY_BIRD',
    addAoaCourse: true,
    addLifeMembership: true,
  });
  const withCoupon = computeRegistrationTotals({
    role: 'NON_AOA',
    bookingPhase: 'EARLY_BIRD',
    addAoaCourse: true,
    addLifeMembership: true,
    couponCode: ' AOACON50011 ',
  });

  assert.equal(normalizeCouponCode(' AOACON50011 '), 'AOACON50011');
  assert.equal(withCoupon.couponCode, 'AOACON50011');
  assert.equal(withCoupon.couponDiscount, 500);
  assert.ok(withCoupon.totalAmount < withoutCoupon.totalAmount);
});

test('does not silently apply an unknown coupon', () => {
  const totals = computeRegistrationTotals({
    role: 'AOA',
    bookingPhase: 'EARLY_BIRD',
    couponCode: 'NOT-A-COUPON',
  });

  assert.equal(totals.couponCode, null);
  assert.equal(totals.couponDiscount, 0);
});

test('uses the configured AOA course capacity', () => {
  assert.equal(AOA_COURSE_CAPACITY, 52);
});
