export const MANAGED_HOTEL = Object.freeze({
  name: 'Harsha The Fern, Shivamogga',
  location: 'Shivamogga, Karnataka',
  description: 'Organizer-managed accommodation allocation for registered AOACON 2026 delegates.',
  checkInTime: '14:00',
  checkOutTime: '12:00',
  earliestCheckIn: '2026-10-28',
  latestCheckOut: '2026-11-03',
  gstRate: 5,
  singleBaseRate: 5000,
  sharingBaseRate: 4000,
});

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

const parseDateOnly = (value) => {
  const normalized = String(value || '').trim();
  if (!DATE_PATTERN.test(normalized)) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return null;
  return date;
};

export const calculateAccommodationQuote = ({
  occupancyType,
  checkInDate,
  checkOutDate,
  singleBaseRate = MANAGED_HOTEL.singleBaseRate,
  sharingBaseRate = MANAGED_HOTEL.sharingBaseRate,
  gstRate = MANAGED_HOTEL.gstRate,
  earliestCheckIn = MANAGED_HOTEL.earliestCheckIn,
  latestCheckOut = MANAGED_HOTEL.latestCheckOut,
}) => {
  const normalizedOccupancy = String(occupancyType || '').trim().toUpperCase();
  if (!['SINGLE', 'SHARING'].includes(normalizedOccupancy)) {
    throw new Error('Select Single or Sharing occupancy.');
  }

  const checkIn = parseDateOnly(checkInDate);
  const checkOut = parseDateOnly(checkOutDate);
  const earliest = parseDateOnly(earliestCheckIn);
  const latest = parseDateOnly(latestCheckOut);
  if (!earliest || !latest || earliest >= latest) {
    throw new Error('Accommodation booking date window is invalid.');
  }
  if (!checkIn || !checkOut) throw new Error('Enter valid check-in and check-out dates.');
  if (checkIn < earliest || checkOut > latest) {
    throw new Error(`Accommodation dates must be between ${earliestCheckIn} and ${latestCheckOut}.`);
  }

  const numberOfNights = Math.round((checkOut - checkIn) / 86400000);
  if (numberOfNights < 1) throw new Error('Check-out must be after check-in.');

  const baseRatePerNight = normalizedOccupancy === 'SINGLE'
    ? Number(singleBaseRate)
    : Number(sharingBaseRate);
  const normalizedGstRate = Number(gstRate);
  if (!Number.isFinite(baseRatePerNight) || baseRatePerNight < 0) {
    throw new Error('Accommodation rate is invalid.');
  }
  if (!Number.isFinite(normalizedGstRate) || normalizedGstRate < 0) {
    throw new Error('Accommodation GST rate is invalid.');
  }

  const baseAmount = baseRatePerNight * numberOfNights;
  const gstAmount = Math.round(baseAmount * normalizedGstRate / 100);
  return {
    occupancyType: normalizedOccupancy,
    numberOfNights,
    baseRatePerNight,
    gstRate: normalizedGstRate,
    baseAmount,
    gstAmount,
    totalAmount: baseAmount + gstAmount,
  };
};

export const validateAccommodationDateWindow = (earliestCheckIn, latestCheckOut) => {
  const earliest = parseDateOnly(earliestCheckIn);
  const latest = parseDateOnly(latestCheckOut);
  if (!earliest || !latest || earliest >= latest) {
    throw new Error('Enter a valid hotel date window with checkout after check-in.');
  }
  return {
    earliestCheckIn: String(earliestCheckIn),
    latestCheckOut: String(latestCheckOut),
  };
};

export const validateAccommodationTime = (value, label) => {
  const normalized = String(value || '').trim();
  if (!TIME_PATTERN.test(normalized)) throw new Error(`Enter a valid ${label} time.`);
  return normalized;
};

export const toIndiaDateTime = (date, time) =>
  new Date(`${date}T${time}:00+05:30`);
