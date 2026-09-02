import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAccommodationQuote, validateAccommodationDateWindow } from '../utils/accommodationPricing.js';

test('calculates the Harsha single-occupancy tariff with five percent GST', () => {
  const quote = calculateAccommodationQuote({
    occupancyType: 'SINGLE',
    checkInDate: '2026-10-29',
    checkOutDate: '2026-11-01',
  });

  assert.deepEqual(quote, {
    occupancyType: 'SINGLE',
    numberOfNights: 3,
    baseRatePerNight: 5000,
    gstRate: 5,
    baseAmount: 15000,
    gstAmount: 750,
    totalAmount: 15750,
  });
});

test('calculates sharing as a per-person nightly tariff', () => {
  const quote = calculateAccommodationQuote({
    occupancyType: 'SHARING',
    checkInDate: '2026-10-30',
    checkOutDate: '2026-11-02',
  });

  assert.equal(quote.numberOfNights, 3);
  assert.equal(quote.baseAmount, 12000);
  assert.equal(quote.gstAmount, 600);
  assert.equal(quote.totalAmount, 12600);
});

test('accepts the full approved accommodation date window', () => {
  const quote = calculateAccommodationQuote({
    occupancyType: 'SINGLE',
    checkInDate: '2026-10-28',
    checkOutDate: '2026-11-03',
  });
  assert.equal(quote.numberOfNights, 6);
});

test('rejects dates outside the approved accommodation window', () => {
  assert.throws(
    () => calculateAccommodationQuote({
      occupancyType: 'SINGLE',
      checkInDate: '2026-10-27',
      checkOutDate: '2026-10-30',
    }),
    /between 2026-10-28 and 2026-11-03/,
  );
});

test('rejects a non-positive stay', () => {
  assert.throws(
    () => calculateAccommodationQuote({
      occupancyType: 'SHARING',
      checkInDate: '2026-10-30',
      checkOutDate: '2026-10-30',
    }),
    /Check-out must be after check-in/,
  );
});

test('uses another hotel tariff, GST, and date window independently', () => {
  const quote = calculateAccommodationQuote({
    occupancyType: 'SHARING',
    checkInDate: '2026-10-29',
    checkOutDate: '2026-10-31',
    singleBaseRate: 7200,
    sharingBaseRate: 3600,
    gstRate: 12,
    earliestCheckIn: '2026-10-29',
    latestCheckOut: '2026-11-01',
  });
  assert.equal(quote.baseAmount, 7200);
  assert.equal(quote.gstAmount, 864);
  assert.equal(quote.totalAmount, 8064);
});

test('rejects a stay outside the selected hotel date window', () => {
  assert.throws(
    () => calculateAccommodationQuote({
      occupancyType: 'SINGLE',
      checkInDate: '2026-10-28',
      checkOutDate: '2026-10-30',
      earliestCheckIn: '2026-10-29',
      latestCheckOut: '2026-11-01',
    }),
    /between 2026-10-29 and 2026-11-01/,
  );
});

test('validates hotel date-window configuration', () => {
  assert.deepEqual(validateAccommodationDateWindow('2026-10-28', '2026-11-03'), {
    earliestCheckIn: '2026-10-28', latestCheckOut: '2026-11-03',
  });
  assert.throws(() => validateAccommodationDateWindow('2026-11-03', '2026-10-28'), /valid hotel date window/);
});
