import crypto from 'node:crypto';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import Registration from '../models/Registration.js';
import logger from '../utils/logger.js';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Accommodation from '../models/Accommodation.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Abstract from '../models/Abstract.js';
import VideoSubmission from '../models/VideoSubmission.js';
import Attendance from '../models/Attendance.js';
import FacultyCv from '../models/FacultyCv.js';
import Feedback from '../models/Feedback.js';

const fields = ['registrationNumber', 'registrationType', 'TypeOfIdCard', 'paymentStatus', 'bookingPhase',
  'addWorkshop', 'selectedWorkshop', 'addAoaCourse', 'addLifeMembership',
  'accompanyingPersons', 'basePrice', 'totalBase', 'totalGST', 'processingFee', 'totalAmount', 'totalPaid', 'createdAt', 'updatedAt'];
const attendeeFields = ['name', 'email', 'phone', 'role', 'instituteHospital', 'designation', 'isProfileComplete'];
const pick = (record, keys) => Object.fromEntries(keys.map(key => [key, record[key]]));

// Explicit field lists prevent new model fields from being exposed automatically.
export const sharedResources = {
  registrations: { model: Registration, fields, attendee: true, paymentFilter: true },
  profiles: { model: User, fields: [...attendeeFields, 'gender', 'mealPreference', 'country', 'state', 'city', 'address', 'pincode', 'medicalCouncilName', 'medicalCouncilNumber', 'membershipId', 'collegeLetterStatus', 'createdAt', 'updatedAt'] },
  payments: { model: Payment, attendee: true, fields: ['registrationId', 'accommodationBookingId', 'amount', 'currency', 'status', 'paymentType', 'paymentMethod', 'paymentDate', 'isManual', 'providerVerified', 'providerAmount', 'providerCurrency', 'providerCapturedAt', 'finalizedAt', 'createdAt', 'updatedAt'] },
  accommodations: { model: Accommodation, fields: ['name', 'description', 'pricePerNight', 'totalRooms', 'availableRooms', 'managedByOrganizers', 'manualBookingRates', 'bookingWindow', 'amenities', 'inclusions', 'exclusions', 'faqs', 'rating', 'location', 'checkInTime', 'checkOutTime', 'isActive', 'createdAt', 'updatedAt'] },
  'accommodation-bookings': { model: AccommodationBooking, attendee: true, paymentFilter: true, fields: ['bookingNumber', 'accommodationId', 'checkInDate', 'checkOutDate', 'numberOfNights', 'numberOfGuests', 'roomsBooked', 'occupancyType', 'accommodationUseCase', 'sharingWith', 'roommateName', 'checkInTime', 'checkOutTime', 'baseRatePerNight', 'gstRate', 'baseAmount', 'gstAmount', 'amountCollected', 'paymentMethod', 'paymentDate', 'totalAmount', 'paymentStatus', 'bookingStatus', 'createdAt', 'updatedAt'] },
  abstracts: { model: Abstract, attendee: true, fields: ['title', 'authors', 'category', 'submissionNumber', 'status', 'reviewComments', 'reviewedAt', 'finalPosterOriginalName', 'finalPosterMimeType', 'finalPosterSize', 'finalPosterUploadedAt', 'finalPosterStatus', 'finalPosterReviewComments', 'finalPosterReviewedAt', 'createdAt', 'updatedAt'] },
  videos: { model: VideoSubmission, attendee: true, fields: ['title', 'presenterName', 'presenterDetails', 'description', 'status', 'reviewComments', 'reviewedAt', 'submissionNumber', 'createdAt', 'updatedAt'] },
  attendance: { model: Attendance, fields: ['registrationId', 'totalScans', 'isActive', 'createdAt', 'updatedAt', 'scanHistory.scannedAt', 'scanHistory.location', 'scanHistory.count'], nestedAttendance: true },
  faculty: { model: FacultyCv, fields: ['name', 'email', 'role', 'isActive', 'cvStatus', 'cvFileName', 'cvContentType', 'cvSize', 'cvUploadedAt', 'createdAt', 'updatedAt'] },
  feedback: { model: Feedback, attendee: true, fields: ['overallRating', 'venueRating', 'contentRating', 'organizationRating', 'networkingRating', 'comments', 'suggestions', 'wouldRecommend', 'futureTopics', 'createdAt', 'updatedAt'] },
};

export const createSharedRouter = ({ model = Registration, resources = sharedResources, getKey = () => process.env.SHARED_READ_API_KEY } = {}) => {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  router.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
  router.use((req, res, next) => {
    const expected = getKey();
    if (!expected || expected.length < 32) {
      return res.status(503).json({ message: 'Shared database access is not configured.' });
    }
    const authorization = req.get('Authorization') || '';
    const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
    const hash = value => crypto.createHash('sha256').update(value).digest();
    if (!crypto.timingSafeEqual(hash(supplied), hash(expected))) {
      return res.status(401).json({ message: 'Invalid API key.' });
    }
    next();
  });
  router.get('/', (req, res) => res.json({ resources: Object.keys(resources), readOnly: true }));
  router.get('/:resource', async (req, res) => {
    if (!Object.hasOwn(resources, req.params.resource)) {
      return res.status(404).json({ message: 'Unknown shared resource.' });
    }
    const resource = resources[req.params.resource];
    const resourceModel = req.params.resource === 'registrations' ? model : resource.model;
    const allowed = new Set(['page', 'limit', ...(resource.paymentFilter ? ['paymentStatus'] : [])]);
    if (Object.keys(req.query).some(key => !allowed.has(key))) {
      return res.status(400).json({ message: 'Unsupported query parameter.' });
    }
    const integer = (value, fallback) => value === undefined ? fallback :
      typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : NaN;
    const page = integer(req.query.page, 1);
    const limit = integer(req.query.limit, 50);
    if (!Number.isSafeInteger(page) || !Number.isSafeInteger(limit) || limit > 100 ||
        !Number.isSafeInteger((page - 1) * limit)) {
      return res.status(400).json({ message: 'Use a positive page and a limit between 1 and 100.' });
    }
    const filter = {};
    if (req.query.paymentStatus !== undefined) {
      if (!['PENDING', 'PAID', 'FAILED'].includes(req.query.paymentStatus)) {
        return res.status(400).json({ message: 'Invalid paymentStatus.' });
      }
      filter.paymentStatus = req.query.paymentStatus;
    }
    try {
      let query = resourceModel.find(filter).select(['_id', ...resource.fields, ...(resource.attendee ? ['userId'] : [])].join(' '));
      if (resource.attendee) query = query.populate('userId', attendeeFields.join(' '));
      const [records, total] = await Promise.all([
        query.sort({ _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
        resourceModel.countDocuments(filter),
      ]);
      return res.json({
        data: records.map(record => {
          const row = { id: record._id, ...pick(record, resource.fields.filter(field => !field.includes('.'))) };
          if (req.params.resource === 'registrations') row.TypeOfIdCard = record.TypeOfIdCard ?? '';
          if (resource.attendee) row.attendee = record.userId ? { id: record.userId._id, ...pick(record.userId, attendeeFields) } : null;
          if (resource.nestedAttendance) row.scanHistory = (record.scanHistory || []).map(scan => pick(scan, ['scannedAt', 'location', 'count']));
          return row;
        }),
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    } catch (error) {
      logger.error('Shared database read failed.', { message: error.message });
      return res.status(500).json({ message: 'Unable to read records right now.' });
    }
  });
  router.use((req, res) => res.status(405).json({ message: 'Only GET requests to shared resources are supported.' }));
  return router;
};

export default createSharedRouter();
