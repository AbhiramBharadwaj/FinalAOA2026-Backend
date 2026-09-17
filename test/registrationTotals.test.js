import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AOA_COURSE_CAPACITY,
  WORKSHOP_CAPACITIES,
  buildWorkshopAvailability,
  computeRegistrationTotals,
  isAoaCourseFullForUser,
  isWorkshopFullForUser,
  normalizeCouponCode,
} from '../utils/registrationTotals.js';

test('normalizes and applies AOACON500 to the conference base price', () => {
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
    couponCode: ' AOACON500 ',
  });

  assert.equal(normalizeCouponCode(' AOACON500 '), 'AOACON500');
  assert.equal(withCoupon.couponCode, 'AOACON500');
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
  assert.equal(AOA_COURSE_CAPACITY, 58);
});

test('keeps a full AOA course available to users who already reserved a seat', () => {
  assert.equal(isAoaCourseFullForUser(AOA_COURSE_CAPACITY, true), false);
  assert.equal(isAoaCourseFullForUser(AOA_COURSE_CAPACITY, false), true);
});

test('uses the configured workshop capacities', () => {
  assert.deepEqual(WORKSHOP_CAPACITIES, {
    'labour-analgesia': 50,
    'critical-incidents': 40,
    pocus: 40,
    'maternal-collapse': 40,
  });
});

test('marks workshops full based on their individual capacity', () => {
  assert.equal(isWorkshopFullForUser(49, 'labour-analgesia'), false);
  assert.equal(isWorkshopFullForUser(50, 'labour-analgesia'), true);
  assert.equal(isWorkshopFullForUser(40, 'pocus'), true);
  assert.equal(isWorkshopFullForUser(40, 'pocus', true), false);
});

test('builds workshop availability details', () => {
  assert.deepEqual(buildWorkshopAvailability('critical-incidents', 35), {
    capacity: 40,
    used: 35,
    remaining: 5,
    full: false,
  });
});
