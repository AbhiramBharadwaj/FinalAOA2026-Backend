import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PaymentFinalizationError,
  validateCapturedPayment,
} from '../services/paymentFinalization.js';

const localPayment = {
  amount: 19248,
  currency: 'INR',
};

const capturedPayment = {
  id: 'pay_test_123',
  order_id: 'order_test_123',
  status: 'captured',
  captured: true,
  amount: 1924800,
  currency: 'INR',
};

const expectFinalizationError = (callback, code) => {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof PaymentFinalizationError);
    assert.equal(error.code, code);
    return true;
  });
};

test('accepts an exact captured Razorpay payment', () => {
  const result = validateCapturedPayment({
    providerPayment: capturedPayment,
    localPayment,
    razorpayOrderId: capturedPayment.order_id,
  });

  assert.equal(result.id, capturedPayment.id);
});

test('rejects a payment that is not captured', () => {
  expectFinalizationError(
    () => validateCapturedPayment({
      providerPayment: { ...capturedPayment, status: 'failed', captured: false },
      localPayment,
      razorpayOrderId: capturedPayment.order_id,
    }),
    'PAYMENT_NOT_CAPTURED'
  );
});

test('rejects a captured payment for another order', () => {
  expectFinalizationError(
    () => validateCapturedPayment({
      providerPayment: capturedPayment,
      localPayment,
      razorpayOrderId: 'order_different',
    }),
    'PAYMENT_ORDER_MISMATCH'
  );
});

test('rejects a captured payment with the wrong amount', () => {
  expectFinalizationError(
    () => validateCapturedPayment({
      providerPayment: { ...capturedPayment, amount: capturedPayment.amount - 100 },
      localPayment,
      razorpayOrderId: capturedPayment.order_id,
    }),
    'PAYMENT_AMOUNT_MISMATCH'
  );
});

test('rejects a captured payment with the wrong currency', () => {
  expectFinalizationError(
    () => validateCapturedPayment({
      providerPayment: { ...capturedPayment, currency: 'USD' },
      localPayment,
      razorpayOrderId: capturedPayment.order_id,
    }),
    'PAYMENT_CURRENCY_MISMATCH'
  );
});
