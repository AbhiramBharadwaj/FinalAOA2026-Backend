import test from 'node:test';
import assert from 'node:assert/strict';
import { getEffectiveMembershipStatus } from '../services/membershipActivation.js';

test('does not activate a membership before payment', () => {
  assert.equal(
    getEffectiveMembershipStatus({
      addLifeMembership: true,
      membershipStatus: 'PAYMENT_PENDING',
      paymentStatus: 'PENDING',
    }),
    'PAYMENT_PENDING'
  );
});

test('recognizes an activated membership', () => {
  assert.equal(
    getEffectiveMembershipStatus({
      addLifeMembership: true,
      membershipStatus: 'ACTIVE',
      paymentStatus: 'PAID',
      lifetimeMembershipId: 'AOA-LM-2026-ABC123',
    }),
    'ACTIVE'
  );
});

test('supports legacy paid memberships that already have an ID', () => {
  assert.equal(
    getEffectiveMembershipStatus({
      addLifeMembership: true,
      paymentStatus: 'PAID',
      lifetimeMembershipId: 'AOA-LM-2026-LEGACY',
    }),
    'ACTIVE'
  );
});
