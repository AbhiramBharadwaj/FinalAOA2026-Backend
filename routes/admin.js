import express from 'express';
import crypto from 'crypto';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import Registration from '../models/Registration.js';
import Payment from '../models/Payment.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Accommodation from '../models/Accommodation.js';
import Abstract from '../models/Abstract.js';
import Feedback from '../models/Feedback.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js';
import Counter from '../models/Counter.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { sendCollegeLetterReviewEmail, sendPasswordResetEmail, sendPaymentSuccessEmail } from '../utils/email.js';
import { getBookingPhase } from '../utils/pricing.js';
import { buildRegistrationInvoicePdf } from '../utils/invoice.js';
import { generateLifetimeMembershipId } from '../utils/membershipGenerator.js';
import {
  AOA_COURSE_CAPACITY,
  computeRegistrationTotals,
  normalizeCouponCode,
} from '../utils/registrationTotals.js';
import { razorpay } from '../services/razorpayClient.js';
import { validateAttendeeName } from '../utils/profileValidation.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';
import { deliverAccommodationConfirmation } from '../services/paymentFinalization.js';
import {
  MANAGED_HOTEL,
  calculateAccommodationQuote,
  toIndiaDateTime,
  validateAccommodationDateWindow,
  validateAccommodationTime,
} from '../utils/accommodationPricing.js';

const router = express.Router();

const REGISTRATION_PREFIX = 'AOA2026-';
const AOA_COURSE_SELECTION_FILTER = {
  $or: [
    { registrationType: 'AOA_CERTIFIED_COURSE' },
    { addAoaCourse: true },
  ],
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getManagedAccommodation = async ({ create = false } = {}) => {
  let accommodation = await Accommodation.findOne({ name: /Harsha The Fern/i });
  if (accommodation && create && !accommodation.managedByOrganizers) {
    accommodation.managedByOrganizers = true;
    await accommodation.save();
  }
  if (accommodation || !create) return accommodation;
  return Accommodation.create({
    name: MANAGED_HOTEL.name,
    description: MANAGED_HOTEL.description,
    images: [],
    pricePerNight: MANAGED_HOTEL.singleBaseRate,
    totalRooms: 0,
    availableRooms: 0,
    amenities: [],
    inclusions: [],
    exclusions: [],
    faqs: [],
    location: MANAGED_HOTEL.location,
    checkInTime: MANAGED_HOTEL.checkInTime,
    checkOutTime: MANAGED_HOTEL.checkOutTime,
    managedByOrganizers: true,
    manualBookingRates: {
      singleBasePerNight: MANAGED_HOTEL.singleBaseRate,
      sharingBasePerPersonPerNight: MANAGED_HOTEL.sharingBaseRate,
      gstRate: MANAGED_HOTEL.gstRate,
    },
    bookingWindow: {
      earliestCheckIn: MANAGED_HOTEL.earliestCheckIn,
      latestCheckOut: MANAGED_HOTEL.latestCheckOut,
    },
    isActive: true,
  });
};

const getAccommodationDateWindow = (accommodation) => ({
  earliestCheckIn: accommodation?.bookingWindow?.earliestCheckIn || MANAGED_HOTEL.earliestCheckIn,
  latestCheckOut: accommodation?.bookingWindow?.latestCheckOut || MANAGED_HOTEL.latestCheckOut,
});

const findManagedAccommodation = async (accommodationId, { activeOnly = true } = {}) => {
  if (!mongoose.isValidObjectId(accommodationId)) return null;
  return Accommodation.findOne({
    _id: accommodationId,
    managedByOrganizers: true,
    ...(activeOnly ? { isActive: true } : {}),
  });
};

const readManagedAccommodationInput = (body) => {
  const name = String(body.name || '').trim();
  const location = String(body.location || '').trim();
  const singleBasePerNight = Number(body.singleBasePerNight);
  const sharingBasePerPersonPerNight = Number(body.sharingBasePerPersonPerNight);
  const gstRate = Number(body.gstRate);
  const checkInTime = validateAccommodationTime(body.checkInTime, 'check-in');
  const checkOutTime = validateAccommodationTime(body.checkOutTime, 'check-out');
  const bookingWindow = validateAccommodationDateWindow(body.earliestCheckIn, body.latestCheckOut);
  if (!name) throw new Error('Enter the hotel name.');
  if (!location) throw new Error('Enter the hotel location.');
  if (
    !Number.isFinite(singleBasePerNight) || singleBasePerNight < 0 ||
    !Number.isFinite(sharingBasePerPersonPerNight) || sharingBasePerPersonPerNight < 0 ||
    !Number.isFinite(gstRate) || gstRate < 0
  ) throw new Error('Enter valid accommodation rates and GST.');
  return {
    name,
    location,
    description: String(body.description || '').trim() || 'Organizer-managed accommodation allocation for registered AOACON 2026 delegates.',
    pricePerNight: singleBasePerNight,
    checkInTime,
    checkOutTime,
    manualBookingRates: { singleBasePerNight, sharingBasePerPersonPerNight, gstRate },
    bookingWindow,
    isActive: body.isActive !== false && body.isActive !== 'false',
  };
};

const buildRegistrationNumber = (seq) =>
  `${REGISTRATION_PREFIX}${String(seq).padStart(4, '0')}`;

const parseRegistrationSeq = (registrationNumber) => {
  if (!registrationNumber?.startsWith(REGISTRATION_PREFIX)) return null;
  const raw = registrationNumber.slice(REGISTRATION_PREFIX.length);
  const seq = Number.parseInt(raw, 10);
  return Number.isNaN(seq) ? null : seq;
};

const buildRegistrationLabel = (registration) => {
  const labels = [];
  if (registration?.addWorkshop || registration?.selectedWorkshop) labels.push('Workshop');
  if (registration?.addAoaCourse) labels.push('AOA Certified Course');
  if (registration?.addLifeMembership) labels.push('AOA Life Membership');
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
};

const createResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
};

const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const getMaxRegistrationSeq = async () => {
  const maxResult = await Registration.aggregate([
    { $match: { registrationNumber: { $regex: /^AOA2026-\d+$/ } } },
    {
      $project: {
        seq: {
          $toInt: { $substrBytes: ['$registrationNumber', REGISTRATION_PREFIX.length, 10] },
        },
      },
    },
    { $group: { _id: null, maxSeq: { $max: '$seq' } } },
  ]);
  return maxResult[0]?.maxSeq || 0;
};

const findNextAvailableRegistration = async (startSeq) => {
  let seq = Math.max(1, Number(startSeq) || 1);
  while (seq < 100000) {
    const registrationNumber = buildRegistrationNumber(seq);
    const exists = await Registration.exists({ registrationNumber });
    if (!exists) {
      return { seq, registrationNumber };
    }
    seq += 1;
  }
  throw new Error('Unable to find available registration number');
};

const computeAvailabilityInRange = async (start, end) => {
  const registrations = await Registration.find(
    { registrationNumber: { $regex: /^AOA2026-\d+$/ } },
    'registrationNumber'
  ).lean();

  const used = new Set();
  for (const reg of registrations) {
    const seq = parseRegistrationSeq(reg.registrationNumber);
    if (seq !== null && seq >= start && seq <= end) {
      used.add(seq);
    }
  }

  const available = [];
  const usedList = [];
  for (let seq = start; seq <= end; seq += 1) {
    if (used.has(seq)) usedList.push(seq);
    else available.push(seq);
  }

  return { available, used: usedList };
};

// Enhanced Dashboard with more comprehensive data
router.get('/dashboard', authenticateAdmin, async (req, res) => {
  try {
    logger.info(`${req.actorName || 'Admin'} opened the admin dashboard.`);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const last7Days = new Date(today);
    last7Days.setDate(last7Days.getDate() - 7);

    // === REGISTRATIONS ===
    const totalRegistrations = await Registration.countDocuments();
    const paidRegistrations = await Registration.countDocuments({ paymentStatus: 'PAID' });
    const pendingRegistrations = await Registration.countDocuments({ paymentStatus: 'PENDING' });
    const todayRegistrations = await Registration.countDocuments({
      createdAt: { $gte: new Date(today.setHours(0, 0, 0, 0)) }
    });

    // Registrations by role with paid status
    const registrationsByRole = await Registration.aggregate([
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      { $unwind: '$user' },
      {
        $group: {
          _id: '$user.role',
          count: { $sum: 1 },
          paidCount: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, 1, 0] }
          },
          revenue: {
            $sum: { $cond: [{ $eq: ['$paymentStatus', 'PAID'] }, '$totalAmount', 0] }
          }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // === PAYMENTS & REVENUE ===
    const totalRevenue = await Registration.aggregate([
      { $match: { paymentStatus: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const accommodationRevenue = await AccommodationBooking.aggregate([
      { $match: { paymentStatus: 'PAID' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const revenueByPhase = await Registration.aggregate([
      { $match: { paymentStatus: 'PAID' } },
      {
        $group: {
          _id: '$bookingPhase',
          count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Today's revenue
    const todayRevenue = await Registration.aggregate([
      {
        $match: {
          paymentStatus: 'PAID',
          createdAt: { $gte: new Date(today.setHours(0, 0, 0, 0)) }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    // Recent payments (last 10)
    const recentPayments = await Payment.find({ status: 'SUCCESS' })
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // === ACCOMMODATION ===
    const totalAccommodationBookings = await AccommodationBooking.countDocuments();
    const paidAccommodationBookings = await AccommodationBooking.countDocuments({ 
      paymentStatus: 'PAID' 
    });

    // === ATTENDANCE ===
    const totalAttendanceRecords = await Attendance.countDocuments();
    const attendedCount = await Attendance.countDocuments({ totalScans: { $gt: 0 } });
    const attendanceRate = totalAttendanceRecords > 0 
      ? Math.round((attendedCount / totalAttendanceRecords) * 100) 
      : 0;

    // === ABSTRACTS ===
    const abstractStats = await Abstract.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    // === FEEDBACK ===
    const totalFeedback = await Feedback.countDocuments();
    const recentFeedback = await Feedback.find()
      .populate('userId', 'name email')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    // === USERS ===
    const totalUsers = await User.countDocuments();
    const adminUsers = await User.countDocuments({ role: 'ADMIN' });

    // === TRENDING DATA (Last 7 days) ===
    const registrationsLast7Days = await Registration.countDocuments({
      createdAt: { $gte: last7Days }
    });

    const paymentsLast7Days = await Payment.countDocuments({
      status: 'SUCCESS',
      createdAt: { $gte: last7Days }
    });

    res.json({
      // Core Stats
      registrations: {
        total: totalRegistrations,
        paid: paidRegistrations,
        pending: pendingRegistrations,
        today: todayRegistrations,
        byRole: registrationsByRole,
        byPhase: revenueByPhase
      },
      
      // Revenue
      revenue: {
        registration: totalRevenue[0]?.total || 0,
        accommodation: accommodationRevenue[0]?.total || 0,
        total: (totalRevenue[0]?.total || 0) + (accommodationRevenue[0]?.total || 0),
        today: todayRevenue[0]?.total || 0
      },

      // Accommodation
      accommodation: {
        totalBookings: totalAccommodationBookings,
        paidBookings: paidAccommodationBookings
      },

      // Attendance
      attendance: {
        totalRecords: totalAttendanceRecords,
        attended: attendedCount,
        rate: attendanceRate,
        pending: totalAttendanceRecords - attendedCount
      },

      // Abstracts & Feedback
      abstracts: abstractStats,
      feedback: {
        total: totalFeedback,
        recent: recentFeedback
      },

      // Users
      users: {
        total: totalUsers,
        admins: adminUsers
      },

      // Trending (Last 7 days)
      trending: {
        registrations: registrationsLast7Days,
        payments: paymentsLast7Days
      },

      // Recent Activity
      recentPayments,
      
      // Timestamps
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    logger.error('admin.dashboard.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Dashboard data could not be loaded. Please try again.');
  }
});

router.get('/manual-registrations/availability', authenticateAdmin, async (req, res) => {
  try {
    const rangeStart = Number(req.query.start || 1);
    const rangeEnd = Number(req.query.end || 14);
    const safeStart = Number.isNaN(rangeStart) ? 1 : Math.max(1, rangeStart);
    const safeEnd = Number.isNaN(rangeEnd) ? safeStart : Math.max(safeStart, rangeEnd);

    const counter = await Counter.findOne({ name: 'registrationNumber' }).lean();
    const { available, used } = await computeAvailabilityInRange(safeStart, safeEnd);
    const counterSeq = counter?.seq || 0;
    const startSeq = available.length ? available[0] : Math.max(safeEnd + 1, counterSeq + 1);
    const nextAvailable = await findNextAvailableRegistration(startSeq);
    const nextInRange = available.length ? buildRegistrationNumber(available[0]) : null;
    const afterRangeStart = Math.max(safeEnd + 1, counterSeq + 1);
    const nextAfterRange = await findNextAvailableRegistration(afterRangeStart);

    res.json({
      range: { start: safeStart, end: safeEnd },
      availableNumbers: available,
      usedNumbers: used,
      currentCounter: counterSeq,
      nextAvailable,
      nextAvailableInRange: nextInRange,
      nextAvailableAfterRange: nextAfterRange?.registrationNumber || null,
    });
  } catch (error) {
    logger.error('admin.manual_registration_availability.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Registration availability could not be checked. Please try again.');
  }
});

router.get('/counters/registration-number', authenticateAdmin, async (req, res) => {
  try {
    const counter = await Counter.findOne({ name: 'registrationNumber' }).lean();
    const maxSeq = await getMaxRegistrationSeq();
    const counterSeq = counter?.seq || 0;
    const suggestedNext = Math.max(counterSeq + 1, maxSeq + 1);
    res.json({
      counter: counterSeq,
      maxUsed: maxSeq,
      suggestedNext,
    });
  } catch (error) {
    logger.error('admin.counter_fetch.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Registration counter could not be loaded. Please try again.');
  }
});

router.put('/counters/registration-number', authenticateAdmin, async (req, res) => {
  try {
    const requested = Number(req.body.seq);
    if (!Number.isFinite(requested) || requested < 0) {
      return res.status(400).json({ message: 'Valid seq is required.' });
    }
    const maxSeq = await getMaxRegistrationSeq();
    if (requested < maxSeq) {
      return res.status(400).json({
        message: `Counter cannot be set below max used (${maxSeq}).`,
      });
    }
    const counter = await Counter.findOneAndUpdate(
      { name: 'registrationNumber' },
      { seq: requested },
      { new: true, upsert: true }
    );
    res.json({
      message: 'Counter updated',
      counter: counter?.seq || requested,
      maxUsed: maxSeq,
    });
  } catch (error) {
    logger.error('admin.counter_update.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Registration counter could not be updated. Please check the value and try again.');
  }
});

router.post('/manual-registrations/quote', authenticateAdmin, async (req, res) => {
  try {
    const { role, bookingPhase, addWorkshop, addAoaCourse, addLifeMembership, couponCode } = req.body;
    if (!role) {
      return res.status(400).json({ message: 'Role is required.' });
    }
    const normalizedRole = String(role).trim().toUpperCase();
    if (!['AOA', 'NON_AOA', 'PGS'].includes(normalizedRole)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }

    const wantsWorkshop = addWorkshop === true || addWorkshop === 'true';
    const wantsAoaCourse = addAoaCourse === true || addAoaCourse === 'true';
    const wantsLifeMembership = addLifeMembership === true || addLifeMembership === 'true';

    if (wantsAoaCourse && normalizedRole === 'PGS') {
      return res.status(400).json({
        message: 'AOA Certified Course is only available for AOA and Non-AOA members.',
      });
    }
    if (wantsLifeMembership && normalizedRole !== 'NON_AOA') {
      return res.status(400).json({
        message: 'AOA Life Membership is only available for Non-AOA members.',
      });
    }
    if (normalizedRole === 'AOA' && wantsWorkshop && wantsAoaCourse) {
      return res.status(400).json({
        message: 'AOA members can choose either Workshop or AOA Certified Course.',
      });
    }

    if (wantsAoaCourse) {
      const aoaCourseSeatsUsed = await Registration.countDocuments(
        AOA_COURSE_SELECTION_FILTER
      );
      if (aoaCourseSeatsUsed >= AOA_COURSE_CAPACITY) {
        return res.status(409).json({
          message: `AOA Certified Course is full (${AOA_COURSE_CAPACITY}/${AOA_COURSE_CAPACITY}). Increase capacity before registering another attendee.`,
          code: 'AOA_COURSE_FULL',
        });
      }
    }

    const phase = bookingPhase || getBookingPhase();
    const totals = computeRegistrationTotals({
      role: normalizedRole,
      bookingPhase: phase,
      addWorkshop: wantsWorkshop,
      addAoaCourse: wantsAoaCourse,
      addLifeMembership: wantsLifeMembership,
      couponCode,
    });

    if (!totals) {
      return res.status(400).json({ message: 'Pricing is not available for this selection.' });
    }

    if (normalizeCouponCode(couponCode) && !totals.couponCode) {
      return res.status(400).json({ message: 'Invalid coupon code.' });
    }

    const aoaCourseSeatsUsed = wantsAoaCourse
      ? await Registration.countDocuments(AOA_COURSE_SELECTION_FILTER)
      : 0;

    res.json({
      ...totals,
      aoaCourseAddOn: totals.aoaCourseBase,
      lifeMembershipAddOn: totals.lifeMembershipBase,
      aoaCourseAvailability: wantsAoaCourse
        ? {
            capacity: AOA_COURSE_CAPACITY,
            used: aoaCourseSeatsUsed,
            remaining: Math.max(0, AOA_COURSE_CAPACITY - aoaCourseSeatsUsed),
            available: aoaCourseSeatsUsed < AOA_COURSE_CAPACITY,
          }
        : null,
    });
  } catch (error) {
    logger.error('admin.manual_registration_quote.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Registration quote could not be calculated. Please check the entered details.');
  }
});

router.post('/manual-registrations', authenticateAdmin, async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      role,
      gender,
      mealPreference,
      country,
      state,
      city,
      address,
      pincode,
      instituteHospital,
      designation,
      medicalCouncilName,
      medicalCouncilNumber,
      membershipId,
      addWorkshop,
      selectedWorkshop,
      addAoaCourse,
      addLifeMembership,
      bookingPhase,
      preferredRegistrationNumber,
      rangeStart,
      rangeEnd,
      couponCode,
      paymentMethod,
      razorpayPaymentId,
      razorpayOrderId,
      paymentReference,
      paymentDate,
      amountReceived,
      paymentNotes,
      manualRegistrationNotes,
      confirmPaymentReceived,
    } = req.body;

    if (!name || !email || !phone || !role) {
      return res.status(400).json({ message: 'Name, email, phone, and role are required.' });
    }

    const nameValidationError = validateAttendeeName(name);
    if (nameValidationError) {
      return res.status(400).json({ message: nameValidationError });
    }

    if (confirmPaymentReceived !== true && confirmPaymentReceived !== 'true') {
      return res.status(400).json({
        message: 'Confirm that payment has been received before creating a paid registration.',
      });
    }

    const normalizedPaymentMethod = String(paymentMethod || '').trim().toUpperCase();
    const validPaymentMethods = ['RAZORPAY', 'UPI', 'BANK_TRANSFER', 'CASH', 'OTHER'];
    if (!validPaymentMethods.includes(normalizedPaymentMethod)) {
      return res.status(400).json({ message: 'Select a valid payment method.' });
    }
    if (normalizedPaymentMethod === 'RAZORPAY' && !razorpayPaymentId) {
      return res.status(400).json({ message: 'Razorpay Payment ID is required.' });
    }
    if (!['RAZORPAY', 'CASH'].includes(normalizedPaymentMethod) && !paymentReference) {
      return res.status(400).json({ message: 'Payment reference number is required.' });
    }
    if (normalizedPaymentMethod === 'CASH' && !paymentNotes) {
      return res.status(400).json({ message: 'Payment notes are required for cash payments.' });
    }

    const paidAt = new Date(paymentDate);
    if (!paymentDate || Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ message: 'A valid payment date is required.' });
    }
    if (paidAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return res.status(400).json({ message: 'Payment date cannot be in the future.' });
    }

    const normalizedRole = String(role).trim().toUpperCase();
    if (!['AOA', 'NON_AOA', 'PGS'].includes(normalizedRole)) {
      return res.status(400).json({ message: 'Invalid role.' });
    }

    const wantsWorkshop = addWorkshop === true || addWorkshop === 'true';
    const wantsAoaCourse = addAoaCourse === true || addAoaCourse === 'true';
    const wantsLifeMembership = addLifeMembership === true || addLifeMembership === 'true';

    if (wantsWorkshop && !selectedWorkshop) {
      return res.status(400).json({ message: 'Workshop selection is required.' });
    }
    if (wantsAoaCourse && normalizedRole === 'PGS') {
      return res.status(400).json({
        message: 'AOA Certified Course is only available for AOA and Non-AOA members.',
      });
    }
    if (wantsLifeMembership && normalizedRole !== 'NON_AOA') {
      return res.status(400).json({
        message: 'AOA Life Membership is only available for Non-AOA members.',
      });
    }
    if (normalizedRole === 'AOA' && wantsWorkshop && wantsAoaCourse) {
      return res.status(400).json({
        message: 'AOA members can choose either Workshop or AOA Certified Course.',
      });
    }

    if (wantsAoaCourse) {
      const aoaCourseSeatsUsed = await Registration.countDocuments(
        AOA_COURSE_SELECTION_FILTER
      );
      if (aoaCourseSeatsUsed >= AOA_COURSE_CAPACITY) {
        return res.status(409).json({
          message: `AOA Certified Course is full (${AOA_COURSE_CAPACITY}/${AOA_COURSE_CAPACITY}). Increase capacity before registering another attendee.`,
          code: 'AOA_COURSE_FULL',
        });
      }
    }

    const requiredFields = [
      { key: gender, label: 'gender' },
      { key: mealPreference, label: 'meal preference' },
      { key: country, label: 'country' },
      { key: state, label: 'state' },
      { key: city, label: 'city' },
      { key: address, label: 'address' },
      { key: pincode, label: 'pincode' },
      { key: instituteHospital, label: 'institute/hospital' },
      { key: designation, label: 'designation' },
      { key: medicalCouncilName, label: 'medical council name' },
      { key: medicalCouncilNumber, label: 'medical council number' },
    ];

    const missing = requiredFields.find((field) => !field.key || String(field.key).trim() === '');
    if (missing) {
      return res.status(400).json({ message: `Missing required field: ${missing.label}` });
    }
    if (normalizedRole === 'AOA' && (!membershipId || String(membershipId).trim() === '')) {
      return res.status(400).json({ message: 'AOA membership ID is required for AOA members.' });
    }

    const existingUser = await User.findOne({
      $or: [{ email: String(email).toLowerCase().trim() }, { phone }],
    });
    if (existingUser) {
      const existingRegistration = await Registration.findOne({ userId: existingUser._id });
      if (existingRegistration) {
        return res.status(400).json({ message: 'User already has a registration.' });
      }
    }

    let preferredSeq = null;
    if (preferredRegistrationNumber) {
      if (String(preferredRegistrationNumber).startsWith(REGISTRATION_PREFIX)) {
        preferredSeq = parseRegistrationSeq(preferredRegistrationNumber);
      } else {
        preferredSeq = Number(preferredRegistrationNumber);
      }
    }

    const safeRangeStart = Number(rangeStart) || 1;
    const safeRangeEnd = Number(rangeEnd) || 14;
    const startSeq = preferredSeq || safeRangeStart;

    const { registrationNumber, seq } = await findNextAvailableRegistration(startSeq);

    const phase = bookingPhase || getBookingPhase();
    const totals = computeRegistrationTotals({
      role: normalizedRole,
      bookingPhase: phase,
      addWorkshop: wantsWorkshop,
      addAoaCourse: wantsAoaCourse,
      addLifeMembership: wantsLifeMembership,
      couponCode,
    });

    if (!totals) {
      return res.status(400).json({ message: 'Pricing is not available for this selection.' });
    }
    if (normalizeCouponCode(couponCode) && !totals.couponCode) {
      return res.status(400).json({ message: 'Invalid coupon code.' });
    }

    const receivedAmount = Number(amountReceived);
    if (!Number.isFinite(receivedAmount) || receivedAmount !== totals.totalAmount) {
      return res.status(400).json({
        message: `Amount received must exactly match the calculated total of INR ${totals.totalAmount}.`,
        expectedAmount: totals.totalAmount,
      });
    }

    let verifiedProviderPayment = null;
    if (razorpayPaymentId) {
      try {
        verifiedProviderPayment = await razorpay.payments.fetch(String(razorpayPaymentId).trim());
      } catch (verificationError) {
        logger.warn('manual_registration.razorpay_lookup_failed', {
          paymentId: razorpayPaymentId,
          message: verificationError?.message || verificationError,
        });
        return res.status(400).json({ message: 'Razorpay could not verify this Payment ID.' });
      }
      if (verifiedProviderPayment.status !== 'captured') {
        return res.status(400).json({ message: 'The Razorpay payment has not been captured.' });
      }
      if (verifiedProviderPayment.currency !== 'INR' || verifiedProviderPayment.amount !== totals.totalAmount * 100) {
        return res.status(400).json({ message: 'Razorpay amount or currency does not match this registration.' });
      }
      if (razorpayOrderId && verifiedProviderPayment.order_id !== String(razorpayOrderId).trim()) {
        return res.status(400).json({ message: 'Razorpay Order ID does not match the payment.' });
      }
    }

    const effectivePaymentId = verifiedProviderPayment?.id || undefined;
    const effectiveOrderId =
      verifiedProviderPayment?.order_id ||
      (razorpayOrderId ? String(razorpayOrderId).trim() : null) ||
      `manual_${Date.now()}_${registrationNumber}`;

    const duplicatePayment = await Payment.findOne({
      $or: [
        ...(effectivePaymentId ? [{ razorpayPaymentId: effectivePaymentId }] : []),
        { razorpayOrderId: effectiveOrderId },
        ...(paymentReference
          ? [{ paymentMethod: normalizedPaymentMethod, paymentReference: String(paymentReference).trim() }]
          : []),
      ],
    }).lean();
    if (duplicatePayment) {
      return res.status(409).json({ message: 'This payment has already been used for a registration.' });
    }

    const userPayload = {
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
      role: wantsLifeMembership ? 'AOA' : normalizedRole,
      gender,
      mealPreference,
      country,
      state,
      city,
      address,
      pincode,
      instituteHospital,
      designation,
      medicalCouncilName,
      medicalCouncilNumber,
      membershipId: normalizedRole === 'AOA'
        ? membershipId
        : wantsLifeMembership
          ? generateLifetimeMembershipId()
          : undefined,
      isActive: true,
      isVerified: true,
      isProfileComplete: true,
    };

    const registrationPayload = {
      registrationType: wantsWorkshop ? 'WORKSHOP_CONFERENCE' : 'CONFERENCE_ONLY',
      addWorkshop: wantsWorkshop,
      selectedWorkshop: wantsWorkshop ? selectedWorkshop : null,
      workshopAddOn: totals.workshopAddOn,
      accompanyingPersons: 0,
      accompanyingBase: 0,
      accompanyingGST: 0,
      addAoaCourse: wantsAoaCourse,
      aoaCourseBase: totals.aoaCourseBase,
      aoaCourseGST: totals.aoaCourseGST,
      addLifeMembership: wantsLifeMembership,
      lifeMembershipBase: totals.lifeMembershipBase,
      lifetimeMembershipId: wantsLifeMembership ? userPayload.membershipId : undefined,
      membershipStatus: wantsLifeMembership ? 'ACTIVE' : 'NOT_REQUESTED',
      membershipRequestedAt: wantsLifeMembership ? new Date() : undefined,
      membershipActivatedAt: wantsLifeMembership ? new Date() : undefined,
      pricingRole: normalizedRole,
      bookingPhase: phase,
      basePrice: totals.basePrice,
      packageBase: totals.packageBase,
      packageGST: totals.packageGST,
      totalBase: totals.totalBase,
      totalGST: totals.totalGST,
      subtotalWithGST: totals.subtotalWithGST,
      processingFee: totals.processingFee,
      totalAmount: totals.totalAmount,
      totalPaid: totals.totalAmount,
      couponCode: totals.couponCode,
      couponDiscount: totals.couponDiscount,
      couponAppliedAt: totals.couponCode ? new Date() : undefined,
      paymentStatus: 'PAID',
      registrationNumber,
      razorpayPaymentId: effectivePaymentId,
      razorpayOrderId: effectiveOrderId,
      isManualRegistration: true,
      createdByAdmin: req.admin._id,
      manualRegistrationNotes: manualRegistrationNotes || undefined,
    };

    const session = await mongoose.startSession();
    let user;
    let registration;
    let attendance;
    let payment;
    try {
      await session.withTransaction(async () => {
        if (wantsAoaCourse) {
          const seatsUsed = await Registration.countDocuments(
            AOA_COURSE_SELECTION_FILTER
          ).session(session);
          if (seatsUsed >= AOA_COURSE_CAPACITY) {
            const capacityError = new Error('AOA Certified Course became full before the registration was saved.');
            capacityError.statusCode = 409;
            throw capacityError;
          }
        }

        user = existingUser;
        if (user) {
          Object.assign(user, userPayload);
          if (!user.password) user.password = crypto.randomBytes(10).toString('hex');
          await user.save({ session });
        } else {
          [user] = await User.create(
            [{ ...userPayload, password: crypto.randomBytes(10).toString('hex') }],
            { session }
          );
        }

        [registration] = await Registration.create(
          [{ userId: user._id, ...registrationPayload }],
          { session }
        );

        await Counter.findOneAndUpdate(
          { name: 'registrationNumber' },
          { $max: { seq } },
          { upsert: true, session }
        );

        [attendance] = await Attendance.create(
          [{ registrationId: registration._id, qrCodeData: registration.registrationNumber }],
          { session }
        );

        [payment] = await Payment.create(
          [{
            userId: user._id,
            registrationId: registration._id,
            amount: totals.totalAmount,
            currency: 'INR',
            status: 'SUCCESS',
            paymentType: 'REGISTRATION',
            razorpayOrderId: registrationPayload.razorpayOrderId,
            razorpayPaymentId: effectivePaymentId,
            paymentMethod: normalizedPaymentMethod,
            paymentReference: paymentReference ? String(paymentReference).trim() : undefined,
            paymentDate: paidAt,
            isManual: true,
            providerVerified: Boolean(verifiedProviderPayment),
            recordedBy: req.admin._id,
            recordingNotes: paymentNotes || undefined,
            providerAmount: verifiedProviderPayment?.amount,
            providerCurrency: verifiedProviderPayment?.currency,
            providerCapturedAt: verifiedProviderPayment?.created_at
              ? new Date(verifiedProviderPayment.created_at * 1000)
              : undefined,
            finalizedAt: new Date(),
            finalizationSource: 'ADMIN',
          }],
          { session }
        );
      });
    } finally {
      await session.endSession();
    }

    const { rawToken, tokenHash, expiresAt } = createResetToken();
    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = expiresAt;
    await user.save();
    const resetLink = `${getFrontendUrl()}/reset-password?token=${rawToken}&email=${encodeURIComponent(
      user.email
    )}`;

    let resetEmailSent = false;
    try {
      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetLink,
        isAdmin: false,
      });
      user.resetEmailSentAt = new Date();
      user.resetEmailFailedAt = undefined;
      user.resetEmailError = undefined;
      await user.save();
      resetEmailSent = true;
    } catch (emailError) {
      user.resetEmailFailedAt = new Date();
      user.resetEmailError = emailError?.message || String(emailError);
      await user.save();
      logger.warn('manual_registration.reset_email_failed', {
        userId: user._id,
        message: emailError?.message || emailError,
      });
    }

    let paymentEmailSent = false;
    try {
      const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
        width: 512,
        margin: 1,
        color: { dark: '#005aa9', light: '#ffffff' },
      });
      const invoiceBuffer = buildRegistrationInvoicePdf(registration, user, {
        paymentId: registration.razorpayPaymentId || payment.paymentReference || 'Manual',
        paidAt,
      });

      const summaryLines = [
        `Registration No: ${registration.registrationNumber || 'N/A'}`,
        `Package: ${buildRegistrationLabel(registration)}`,
        `Amount Paid: INR ${Number(totals.totalAmount || 0).toLocaleString('en-IN')}`,
        'Payment Status: PAID',
      ];
      if (registration.couponCode && registration.couponDiscount) {
        summaryLines.splice(2, 0, `Coupon: ${registration.couponCode} (-INR ${Number(registration.couponDiscount).toLocaleString('en-IN')})`);
      }
      if (registration.membershipStatus === 'ACTIVE' && registration.lifetimeMembershipId) {
        summaryLines.splice(3, 0, `AOA Membership ID: ${registration.lifetimeMembershipId}`);
        summaryLines.splice(4, 0, 'Membership Status: ACTIVE');
      }

      await sendPaymentSuccessEmail({
        user,
        subject: registration.membershipStatus === 'ACTIVE'
          ? `AOA Life Membership Activated - ${registration.lifetimeMembershipId}`
          : `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
        summaryLines,
        qrCid: 'qr-ticket',
        attachments: [
          {
            filename: `AOA_Ticket_${registration.registrationNumber}.png`,
            content: qrBuffer,
            contentType: 'image/png',
            cid: 'qr-ticket',
          },
          {
            filename: `AOA_Invoice_${registration.registrationNumber}.pdf`,
            content: invoiceBuffer,
            contentType: 'application/pdf',
          },
        ],
      });
      await Registration.findByIdAndUpdate(registration._id, {
        paymentEmailSentAt: new Date(),
        paymentEmailFailedAt: null,
        paymentEmailError: null,
      });
      paymentEmailSent = true;
    } catch (emailError) {
      await Registration.findByIdAndUpdate(registration._id, {
        paymentEmailFailedAt: new Date(),
        paymentEmailError: emailError?.message || String(emailError),
      });
      logger.warn('manual_registration.payment_email_failed', {
        userId: user._id,
        message: emailError?.message || emailError,
      });
    }

    return res.status(201).json({
      message: 'Manual registration created successfully.',
      registration,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      payment: {
        method: payment.paymentMethod,
        reference: payment.paymentReference,
        paymentId: payment.razorpayPaymentId,
        amount: payment.amount,
        paymentDate: payment.paymentDate,
        providerVerified: payment.providerVerified,
      },
      emailDelivery: { resetEmailSent, paymentEmailSent },
    });
  } catch (error) {
    if (error?.statusCode) {
      return res.status(error.statusCode).json({ message: error.message });
    }
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'Duplicate record detected. Please re-check inputs.' });
    }
    logger.error('admin.manual_registration.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Manual registration could not be created. Please check the entered details.');
  }
});

// Export endpoints for attendance (add these)
router.get('/export-attended', authenticateAdmin, async (req, res) => {
  try {
    // This would use a library like exceljs to generate Excel file
    // Implementation depends on your excel generation setup
    res.json({ message: 'Attended list export endpoint' });
  } catch (error) {
    return sendErrorResponse(res, error, 'Attended registrations could not be exported. Please try again.');
  }
});

router.get('/export-not-attended', authenticateAdmin, async (req, res) => {
  try {
    // Implementation for not attended export
    res.json({ message: 'Not attended list export endpoint' });
  } catch (error) {
    return sendErrorResponse(res, error, 'Not-attended registrations could not be exported. Please try again.');
  }
});

// Rest of your existing routes remain the same...
router.get('/registrations', authenticateAdmin, async (req, res) => {
  try {
    const { status, role, phase } = req.query;
    let filter = {};

    if (status) filter.paymentStatus = status;
    if (phase) filter.bookingPhase = phase;

    const registrations = await Registration.find(filter)
      .populate(
        'userId',
        'name email phone role membershipId gender country state city address pincode instituteHospital designation medicalCouncilName medicalCouncilNumber'
      )
      .sort({ createdAt: -1 });

    let filteredRegistrations = registrations;
    if (role) {
      filteredRegistrations = registrations.filter(reg => reg.userId.role === role);
    }

    res.json(filteredRegistrations);
  } catch (error) {
    logger.error('admin.registrations.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Registrations could not be loaded. Please try again.');
  }
});

router.post('/registrations/:id/life-membership', authenticateAdmin, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id).populate('userId');
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found.' });
    }
    if (!registration.userId) {
      return res.status(404).json({ message: 'Registration user not found.' });
    }
    if (registration.addLifeMembership) {
      return res.status(409).json({
        message: registration.membershipStatus === 'ACTIVE'
          ? 'AOA Life Membership is already active.'
          : 'AOA Life Membership payment is already pending.',
      });
    }
    if (registration.paymentStatus !== 'PAID') {
      return res.status(400).json({
        message: 'The conference registration must be fully paid before adding life membership.',
      });
    }

    const pricingRole = registration.pricingRole || registration.userId.role;
    if (pricingRole !== 'NON_AOA' || registration.userId.role !== 'NON_AOA') {
      return res.status(400).json({
        message: 'AOA Life Membership can only be added to a Non-AOA registration.',
      });
    }

    const totals = computeRegistrationTotals({
      role: pricingRole,
      bookingPhase: registration.bookingPhase,
      addWorkshop: registration.addWorkshop,
      addAoaCourse: registration.addAoaCourse,
      addLifeMembership: true,
      accompanyingPersons: registration.accompanyingPersons,
      couponCode: registration.couponCode,
    });
    if (!totals || totals.lifeMembershipBase <= 0) {
      return res.status(400).json({
        message: 'AOA Life Membership pricing is not available for this registration phase.',
      });
    }

    Object.assign(registration, {
      addLifeMembership: true,
      membershipStatus: 'PAYMENT_PENDING',
      membershipRequestedAt: new Date(),
      membershipRequestedByAdmin: req.admin._id,
      pricingRole,
      basePrice: totals.basePrice,
      packageBase: totals.packageBase,
      packageGST: totals.packageGST,
      totalBase: totals.totalBase,
      totalGST: totals.totalGST,
      subtotalWithGST: totals.subtotalWithGST,
      processingFee: totals.processingFee,
      totalAmount: totals.totalAmount,
      workshopAddOn: totals.workshopAddOn,
      aoaCourseBase: totals.aoaCourseBase,
      aoaCourseGST: totals.aoaCourseGST,
      lifeMembershipBase: totals.lifeMembershipBase,
      accompanyingBase: totals.accompanyingBase,
      accompanyingGST: totals.accompanyingGST,
      paymentStatus: (registration.totalPaid || 0) >= totals.totalAmount ? 'PAID' : 'PENDING',
      paymentEmailSentAt: null,
      paymentEmailSendingAt: null,
      paymentEmailFailedAt: null,
      paymentEmailError: null,
    });
    await registration.save();
    await registration.populate(
      'userId',
      'name email phone role membershipId gender country state city address pincode instituteHospital designation medicalCouncilName medicalCouncilNumber'
    );

    return res.json({
      message: 'AOA Life Membership added. The attendee can now pay the additional balance.',
      registration,
      balanceDue: Math.max(0, registration.totalAmount - (registration.totalPaid || 0)),
    });
  } catch (error) {
    logger.error('admin.registration_life_membership.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'AOA Life Membership could not be added to this registration.');
  }
});

router.delete('/registrations/:id', authenticateAdmin, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    const [paymentResult, attendanceResult] = await Promise.all([
      Payment.deleteMany({ registrationId: registration._id }),
      Attendance.deleteMany({ registrationId: registration._id }),
    ]);

    await Registration.deleteOne({ _id: registration._id });

    res.json({
      message: 'Registration deleted successfully',
      deleted: {
        registrationId: registration._id,
        payments: paymentResult.deletedCount,
        attendance: attendanceResult.deletedCount,
      },
    });
  } catch (error) {
    logger.error('admin.registration_delete.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Registration could not be deleted. Please try again.');
  }
});

router.post('/registrations/:id/resend-email', authenticateAdmin, async (req, res) => {
  try {
    const registration = await Registration.findById(req.params.id)
      .populate('userId', 'name email phone role')
      .lean();

    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    if (registration.paymentStatus !== 'PAID') {
      return res.status(400).json({ message: 'Payment not completed for this registration.' });
    }
    if (!registration.userId?.email) {
      return res.status(400).json({ message: 'User email not available.' });
    }

    let attendance = await Attendance.findOne({ registrationId: registration._id });
    if (!attendance) {
      attendance = await Attendance.create({
        registrationId: registration._id,
        qrCodeData: registration.registrationNumber,
      });
    }

    const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
      width: 512,
      margin: 1,
      color: { dark: '#005aa9', light: '#ffffff' },
    });
    const invoiceBuffer = buildRegistrationInvoicePdf(registration, registration.userId, {
      paymentId: registration.razorpayPaymentId || 'Manual',
      paidAt: registration.updatedAt || new Date(),
    });

      const summaryLines = [
        `Registration No: ${registration.registrationNumber || 'N/A'}`,
        `Package: ${buildRegistrationLabel(registration)}`,
        `Amount Paid: INR ${Number(registration.totalPaid || registration.totalAmount || 0).toLocaleString(
          'en-IN'
        )}`,
        'Payment Status: PAID',
      ];
      if (registration.couponCode && registration.couponDiscount) {
        summaryLines.splice(2, 0, `Coupon: ${registration.couponCode} (-INR ${Number(registration.couponDiscount).toLocaleString('en-IN')})`);
      }
      if (registration.membershipStatus === 'ACTIVE' && registration.lifetimeMembershipId) {
        summaryLines.splice(3, 0, `AOA Membership ID: ${registration.lifetimeMembershipId}`);
        summaryLines.splice(4, 0, 'Membership Status: ACTIVE');
      }

      await sendPaymentSuccessEmail({
        user: registration.userId,
        subject: registration.membershipStatus === 'ACTIVE'
          ? `AOA Life Membership Activated - ${registration.lifetimeMembershipId}`
          : `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
        summaryLines,
        qrCid: 'qr-ticket',
        attachments: [
        {
          filename: `AOA_Ticket_${registration.registrationNumber}.png`,
          content: qrBuffer,
          contentType: 'image/png',
          cid: 'qr-ticket',
        },
        {
          filename: `AOA_Invoice_${registration.registrationNumber}.pdf`,
          content: invoiceBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    await Registration.findByIdAndUpdate(registration._id, {
      paymentEmailSentAt: new Date(),
      paymentEmailFailedAt: null,
      paymentEmailError: null,
    });

    res.json({ message: 'Payment email resent successfully.' });
  } catch (error) {
    await Registration.findByIdAndUpdate(req.params.id, {
      paymentEmailFailedAt: new Date(),
      paymentEmailError: error?.message || String(error),
    });
    logger.error('admin.registration_resend_email.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Registration email could not be resent. Please check the recipient email and try again.');
  }
});

router.get('/payments', authenticateAdmin, async (req, res) => {
  try {
    const { status, type } = req.query;
    let filter = {};

    if (status) filter.status = status;
    if (type) filter.paymentType = type;

    const payments = await Payment.find(filter)
      .populate('userId', 'name email')
      .populate('registrationId')
      .populate('accommodationBookingId')
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (error) {
    logger.error('admin.payments.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Payments could not be loaded. Please try again.');
  }
});


router.get('/registrations', authenticateAdmin, async (req, res) => {
  try {
    const { status, role, phase } = req.query;
    let filter = {};

    if (status) filter.paymentStatus = status;
    if (phase) filter.bookingPhase = phase;

    const registrations = await Registration.find(filter)
      .populate(
        'userId',
        'name email phone role membershipId gender country state city address pincode instituteHospital designation medicalCouncilName medicalCouncilNumber'
      )
      .sort({ createdAt: -1 });

    
    let filteredRegistrations = registrations;
    if (role) {
      filteredRegistrations = registrations.filter(reg => reg.userId.role === role);
    }

    res.json(filteredRegistrations);
  } catch (error) {
    logger.error('admin.registrations_by_role.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Registrations could not be filtered. Please try again.');
  }
});


router.get('/payments', authenticateAdmin, async (req, res) => {
  try {
    const { status, type } = req.query;
    let filter = {};

    if (status) filter.status = status;
    if (type) filter.paymentType = type;

    const payments = await Payment.find(filter)
      .populate('userId', 'name email')
      .populate('registrationId')
      .populate('accommodationBookingId')
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (error) {
    logger.error('admin.payments_by_date.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Payments could not be filtered. Please try again.');
  }
});

router.get('/users', authenticateAdmin, async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    logger.error('admin.users.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Users could not be loaded. Please try again.');
  }
});

router.post('/college-letters/:userId/review', authenticateAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    if (!['APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid review status' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.role !== 'PGS') {
      return res.status(400).json({ message: 'Recommendation letter review is only for PGS & Fellows' });
    }
    if (!user.collegeLetter) {
      return res.status(400).json({ message: 'No recommendation letter uploaded' });
    }

    user.collegeLetterStatus = status;
    user.collegeLetterReviewedAt = new Date();
    user.collegeLetterReviewedBy = req.admin?.name || req.actorName || 'Admin';
    await user.save();

    try {
      await sendCollegeLetterReviewEmail({ user, status });
    } catch (emailError) {
      logger.warn('college_letter.review.email_failed', {
        userId: user._id,
        message: emailError?.message || emailError,
      });
    }

    res.json({ message: 'Recommendation letter reviewed', user });
  } catch (error) {
    logger.error('admin.college_letter_review.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Recommendation letter review could not be saved. Please try again.');
  }
});

router.delete('/users/:id', authenticateAdmin, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const registrations = await Registration.find({ userId: user._id }, '_id');
    const registrationIds = registrations.map((r) => r._id);
    const accommodationBookings = await AccommodationBooking.find(
      { userId: user._id },
      '_id'
    );
    const accommodationBookingIds = accommodationBookings.map((b) => b._id);

    const [paymentResult, attendanceResult, registrationResult, accommodationResult] =
      await Promise.all([
        Payment.deleteMany({
          $or: [
            { registrationId: { $in: registrationIds } },
            { accommodationBookingId: { $in: accommodationBookingIds } },
            { userId: user._id },
          ],
        }),
        Attendance.deleteMany({ registrationId: { $in: registrationIds } }),
        Registration.deleteMany({ userId: user._id }),
        AccommodationBooking.deleteMany({ userId: user._id }),
      ]);

    await User.deleteOne({ _id: user._id });

    res.json({
      message: 'User deleted successfully',
      deleted: {
        userId: user._id,
        registrations: registrationResult.deletedCount || 0,
        payments: paymentResult.deletedCount || 0,
        attendance: attendanceResult.deletedCount || 0,
        accommodationBookings: accommodationResult.deletedCount || 0,
      },
    });
  } catch (error) {
    logger.error('admin.user_delete.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'User could not be deleted. Please try again.');
  }
});

router.post('/users/bulk-delete', authenticateAdmin, async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'User IDs required' });
    }

    const users = await User.find({ _id: { $in: ids } }, '_id');
    const userIds = users.map((u) => u._id);

    const registrations = await Registration.find({ userId: { $in: userIds } }, '_id');
    const registrationIds = registrations.map((r) => r._id);
    const accommodationBookings = await AccommodationBooking.find(
      { userId: { $in: userIds } },
      '_id'
    );
    const accommodationBookingIds = accommodationBookings.map((b) => b._id);

    const [
      paymentResult,
      attendanceResult,
      registrationResult,
      accommodationResult,
      userResult,
    ] = await Promise.all([
      Payment.deleteMany({
        $or: [
          { registrationId: { $in: registrationIds } },
          { accommodationBookingId: { $in: accommodationBookingIds } },
          { userId: { $in: userIds } },
        ],
      }),
      Attendance.deleteMany({ registrationId: { $in: registrationIds } }),
      Registration.deleteMany({ userId: { $in: userIds } }),
      AccommodationBooking.deleteMany({ userId: { $in: userIds } }),
      User.deleteMany({ _id: { $in: userIds } }),
    ]);

    res.json({
      message: 'Users deleted successfully',
      deleted: {
        users: userResult.deletedCount || 0,
        registrations: registrationResult.deletedCount || 0,
        payments: paymentResult.deletedCount || 0,
        attendance: attendanceResult.deletedCount || 0,
        accommodationBookings: accommodationResult.deletedCount || 0,
      },
    });
  } catch (error) {
    logger.error('admin.user_bulk_delete.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Selected users could not be deleted. Please try again.');
  }
});


router.get('/managed-accommodations', authenticateAdmin, async (req, res) => {
  try {
    await getManagedAccommodation({ create: true });
    const accommodations = await Accommodation.find({ managedByOrganizers: true }).sort({ isActive: -1, name: 1 });
    return res.json(accommodations);
  } catch (error) {
    logger.error('admin.managed_accommodations_get.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Hotels could not be loaded.');
  }
});

router.post('/managed-accommodations', authenticateAdmin, async (req, res) => {
  try {
    const values = readManagedAccommodationInput(req.body);
    const duplicate = await Accommodation.exists({ name: new RegExp(`^${escapeRegex(values.name)}$`, 'i') });
    if (duplicate) return res.status(409).json({ message: 'A hotel with this name already exists.' });
    const accommodation = await Accommodation.create({
      ...values,
      managedByOrganizers: true,
      totalRooms: 0,
      availableRooms: 0,
      images: [], amenities: [], inclusions: [], exclusions: [], faqs: [],
    });
    return res.status(201).json({ message: 'Hotel added successfully.', accommodation });
  } catch (error) {
    if (error?.message?.startsWith('Enter ')) return res.status(400).json({ message: error.message });
    logger.error('admin.managed_accommodation_create.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Hotel could not be added. Please check the entered details.');
  }
});

router.put('/managed-accommodations/:id', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = await findManagedAccommodation(req.params.id, { activeOnly: false });
    if (!accommodation) return res.status(404).json({ message: 'Managed hotel not found.' });
    const values = readManagedAccommodationInput(req.body);
    const duplicate = await Accommodation.exists({
      _id: { $ne: accommodation._id },
      name: new RegExp(`^${escapeRegex(values.name)}$`, 'i'),
    });
    if (duplicate) return res.status(409).json({ message: 'A hotel with this name already exists.' });
    accommodation.set(values);
    await accommodation.save();
    return res.json({ message: 'Hotel settings updated.', accommodation });
  } catch (error) {
    if (error?.message?.startsWith('Enter ')) return res.status(400).json({ message: error.message });
    logger.error('admin.managed_accommodation_update.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Hotel settings could not be updated.');
  }
});

router.get('/accommodation-settings/harsha-fern', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = await getManagedAccommodation();
    return res.json({
      accommodation,
      defaults: MANAGED_HOTEL,
    });
  } catch (error) {
    logger.error('admin.accommodation_settings_get.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation settings could not be loaded.');
  }
});

router.put('/accommodation-settings/harsha-fern', authenticateAdmin, async (req, res) => {
  try {
    const singleBasePerNight = Number(req.body.singleBasePerNight);
    const sharingBasePerPersonPerNight = Number(req.body.sharingBasePerPersonPerNight);
    const gstRate = Number(req.body.gstRate);
    const checkInTime = validateAccommodationTime(req.body.checkInTime, 'check-in');
    const checkOutTime = validateAccommodationTime(req.body.checkOutTime, 'check-out');
    if (
      !Number.isFinite(singleBasePerNight) || singleBasePerNight < 0 ||
      !Number.isFinite(sharingBasePerPersonPerNight) || sharingBasePerPersonPerNight < 0 ||
      !Number.isFinite(gstRate) || gstRate < 0
    ) {
      return res.status(400).json({ message: 'Enter valid accommodation rates and GST.' });
    }

    const accommodation = await getManagedAccommodation({ create: true });
    accommodation.name = MANAGED_HOTEL.name;
    accommodation.location = MANAGED_HOTEL.location;
    accommodation.managedByOrganizers = true;
    accommodation.pricePerNight = singleBasePerNight;
    accommodation.checkInTime = checkInTime;
    accommodation.checkOutTime = checkOutTime;
    accommodation.manualBookingRates = {
      singleBasePerNight,
      sharingBasePerPersonPerNight,
      gstRate,
    };
    accommodation.bookingWindow = {
      earliestCheckIn: accommodation.bookingWindow?.earliestCheckIn || MANAGED_HOTEL.earliestCheckIn,
      latestCheckOut: accommodation.bookingWindow?.latestCheckOut || MANAGED_HOTEL.latestCheckOut,
    };
    await accommodation.save();
    return res.json({ message: 'Accommodation settings updated.', accommodation });
  } catch (error) {
    if (error?.message?.startsWith('Enter a valid')) {
      return res.status(400).json({ message: error.message });
    }
    logger.error('admin.accommodation_settings_update.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation settings could not be updated.');
  }
});

router.get('/accommodation-eligible-users', authenticateAdmin, async (req, res) => {
  try {
    const search = String(req.query.search || '').trim();
    if (search.length < 2) return res.json([]);
    const regex = new RegExp(escapeRegex(search), 'i');
    const digits = search.replace(/\D/g, '');
    const userConditions = [{ name: regex }, { email: regex }];
    if (digits) userConditions.push({ phone: new RegExp(escapeRegex(digits)) });
    const users = await User.find({ $or: userConditions }).select('_id').limit(30).lean();
    const registrationConditions = [{ registrationNumber: regex }];
    if (users.length) registrationConditions.push({ userId: { $in: users.map((user) => user._id) } });
    const registrations = await Registration.find({
      paymentStatus: 'PAID',
      $or: registrationConditions,
    })
      .populate('userId', 'name email phone role membershipId')
      .sort({ createdAt: -1 })
      .limit(15)
      .lean();

    return res.json(registrations.filter((registration) => registration.userId).map((registration) => ({
      userId: registration.userId._id,
      name: registration.userId.name,
      email: registration.userId.email,
      phone: registration.userId.phone,
      role: registration.userId.role,
      membershipId: registration.userId.membershipId,
      registrationId: registration._id,
      registrationNumber: registration.registrationNumber,
      registrationPaymentStatus: registration.paymentStatus,
    })));
  } catch (error) {
    logger.error('admin.accommodation_user_search.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Registered delegates could not be searched.');
  }
});

router.post('/accommodation-bookings/quote', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = req.body.accommodationId
      ? await findManagedAccommodation(req.body.accommodationId)
      : await getManagedAccommodation({ create: true });
    if (!accommodation || !accommodation.isActive) {
      return res.status(404).json({ message: 'Select an active hotel.' });
    }
    const rates = accommodation?.manualBookingRates || {};
    const dateWindow = getAccommodationDateWindow(accommodation);
    const quote = calculateAccommodationQuote({
      occupancyType: req.body.occupancyType,
      checkInDate: req.body.checkInDate,
      checkOutDate: req.body.checkOutDate,
      singleBaseRate: rates.singleBasePerNight ?? MANAGED_HOTEL.singleBaseRate,
      sharingBaseRate: rates.sharingBasePerPersonPerNight ?? MANAGED_HOTEL.sharingBaseRate,
      gstRate: rates.gstRate ?? MANAGED_HOTEL.gstRate,
      ...dateWindow,
    });
    return res.json({ quote, accommodation, dateWindow });
  } catch (error) {
    return res.status(400).json({ message: error?.message || 'Accommodation quote could not be calculated.' });
  }
});

router.post('/accommodation-bookings/manual', authenticateAdmin, async (req, res) => {
  try {
    const {
      userId,
      accommodationId,
      occupancyType,
      roommateName,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      amountCollected,
      amountAdjustmentNote,
      paymentMethod,
      paymentReference,
      paymentDate,
      adminNotes,
      sendEmail,
      confirmPaymentReceived,
    } = req.body;

    if (!mongoose.isValidObjectId(userId)) return res.status(400).json({ message: 'Select a registered delegate.' });
    if (confirmPaymentReceived !== true && confirmPaymentReceived !== 'true') {
      return res.status(400).json({ message: 'Confirm that the accommodation payment was received.' });
    }
    const normalizedPaymentMethod = String(paymentMethod || '').trim().toUpperCase();
    if (!['UPI', 'BANK_TRANSFER', 'CASH', 'OTHER'].includes(normalizedPaymentMethod)) {
      return res.status(400).json({ message: 'Select a valid payment method.' });
    }
    const paidAt = new Date(paymentDate);
    if (!paymentDate || Number.isNaN(paidAt.getTime()) || paidAt > new Date()) {
      return res.status(400).json({ message: 'Enter a valid payment date that is not in the future.' });
    }

    const registration = await Registration.findOne({ userId, paymentStatus: 'PAID' }).lean();
    if (!registration) {
      return res.status(400).json({ message: 'Accommodation can only be assigned after conference registration is paid.' });
    }
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: 'Delegate profile not found.' });

    const accommodation = accommodationId
      ? await findManagedAccommodation(accommodationId)
      : await getManagedAccommodation({ create: true });
    if (!accommodation || !accommodation.isActive) {
      return res.status(404).json({ message: 'Select an active hotel.' });
    }
    const normalizedCheckInTime = validateAccommodationTime(checkInTime || accommodation.checkInTime || MANAGED_HOTEL.checkInTime, 'check-in');
    const normalizedCheckOutTime = validateAccommodationTime(checkOutTime || accommodation.checkOutTime || MANAGED_HOTEL.checkOutTime, 'check-out');
    const rates = accommodation.manualBookingRates || {};
    const dateWindow = getAccommodationDateWindow(accommodation);
    const quote = calculateAccommodationQuote({
      occupancyType,
      checkInDate,
      checkOutDate,
      singleBaseRate: rates.singleBasePerNight ?? MANAGED_HOTEL.singleBaseRate,
      sharingBaseRate: rates.sharingBasePerPersonPerNight ?? MANAGED_HOTEL.sharingBaseRate,
      gstRate: rates.gstRate ?? MANAGED_HOTEL.gstRate,
      ...dateWindow,
    });
    const collected = Number(amountCollected);
    if (!Number.isFinite(collected) || collected < 0) {
      return res.status(400).json({ message: 'Enter a valid amount collected.' });
    }
    if (collected !== quote.totalAmount && !String(amountAdjustmentNote || '').trim()) {
      return res.status(400).json({ message: 'Explain why the amount collected differs from the calculated total.' });
    }

    const checkIn = toIndiaDateTime(checkInDate, normalizedCheckInTime);
    const checkOut = toIndiaDateTime(checkOutDate, normalizedCheckOutTime);
    const overlapping = await AccommodationBooking.findOne({
      userId,
      bookingStatus: { $ne: 'CANCELLED' },
      checkInDate: { $lt: checkOut },
      checkOutDate: { $gt: checkIn },
    }).lean();
    if (overlapping) {
      return res.status(409).json({ message: `This delegate already has an overlapping booking (${overlapping.bookingNumber}).` });
    }

    const reference = String(paymentReference || '').trim() || `manual_${normalizedPaymentMethod.toLowerCase()}_no_reference_${Date.now()}`;
    const duplicateReference = await Payment.exists({ paymentReference: reference });
    if (duplicateReference) return res.status(409).json({ message: 'This payment reference has already been used.' });

    const session = await mongoose.startSession();
    let booking;
    let payment;
    try {
      await session.withTransaction(async () => {
        [booking] = await AccommodationBooking.create([{
          userId,
          accommodationId: accommodation._id,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          checkInTime: normalizedCheckInTime,
          checkOutTime: normalizedCheckOutTime,
          numberOfNights: quote.numberOfNights,
          numberOfGuests: 1,
          roomsBooked: 1,
          occupancyType: quote.occupancyType,
          roommateName: quote.occupancyType === 'SHARING' ? String(roommateName || '').trim() : undefined,
          baseRatePerNight: quote.baseRatePerNight,
          gstRate: quote.gstRate,
          baseAmount: quote.baseAmount,
          gstAmount: quote.gstAmount,
          totalAmount: quote.totalAmount,
          amountCollected: collected,
          paymentStatus: 'PAID',
          bookingStatus: 'CONFIRMED',
          paymentMethod: normalizedPaymentMethod,
          paymentReference: reference,
          paymentDate: paidAt,
          amountAdjustmentNote: String(amountAdjustmentNote || '').trim() || undefined,
          adminNotes: String(adminNotes || '').trim() || undefined,
          createdByAdmin: req.admin._id,
          updatedByAdmin: req.admin._id,
        }], { session });

        const manualOrderId = `manual_accommodation_${booking.bookingNumber}_${Date.now()}`;
        booking.razorpayOrderId = manualOrderId;
        await booking.save({ session });
        [payment] = await Payment.create([{
          userId,
          accommodationBookingId: booking._id,
          amount: collected,
          currency: 'INR',
          status: 'SUCCESS',
          paymentType: 'ACCOMMODATION',
          razorpayOrderId: manualOrderId,
          paymentMethod: normalizedPaymentMethod,
          paymentReference: reference,
          paymentDate: paidAt,
          isManual: true,
          providerVerified: false,
          recordedBy: req.admin._id,
          recordingNotes: String(adminNotes || '').trim() || 'Manual accommodation allocation',
          finalizedAt: new Date(),
          finalizationSource: 'ADMIN',
        }], { session });
      });
    } finally {
      await session.endSession();
    }

    let emailStatus = 'NOT_REQUESTED';
    if (sendEmail === true || sendEmail === 'true') {
      emailStatus = await deliverAccommodationConfirmation({ bookingId: booking._id });
    }
    const populated = await AccommodationBooking.findById(booking._id)
      .populate('userId', 'name email phone role')
      .populate('accommodationId', 'name location checkInTime checkOutTime')
      .lean();
    return res.status(201).json({
      message: 'Accommodation booking recorded successfully.',
      booking: populated,
      payment: { id: payment._id, amount: payment.amount, reference: payment.paymentReference },
      emailStatus,
    });
  } catch (error) {
    if (error?.message?.startsWith('Enter a valid') || error?.message?.startsWith('Select ') || error?.message?.startsWith('Accommodation dates') || error?.message?.startsWith('Check-out')) {
      return res.status(400).json({ message: error.message });
    }
    logger.error('admin.accommodation_manual_create.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation booking could not be recorded. Please check the entered details.');
  }
});

router.post('/accommodation-bookings/:id/send-email', authenticateAdmin, async (req, res) => {
  try {
    const booking = await AccommodationBooking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ message: 'Accommodation booking not found.' });
    if (booking.paymentStatus !== 'PAID') return res.status(400).json({ message: 'Only paid bookings can receive confirmation emails.' });
    await AccommodationBooking.findByIdAndUpdate(booking._id, {
      $unset: { paymentEmailSentAt: 1, paymentEmailSendingAt: 1 },
    });
    const emailStatus = await deliverAccommodationConfirmation({ bookingId: booking._id });
    return res.json({ message: emailStatus === 'SENT' ? 'Accommodation email sent.' : 'Accommodation email could not be sent.', emailStatus });
  } catch (error) {
    logger.error('admin.accommodation_email.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation email could not be sent.');
  }
});

router.post('/accommodations', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = new Accommodation(req.body);
    await accommodation.save();

    res.status(201).json({
      message: 'Accommodation created successfully',
      accommodation
    });
  } catch (error) {
    logger.error('admin.accommodation_create.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation could not be created. Please check the entered details.');
  }
});


router.put('/accommodations/:id', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = await Accommodation.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    if (!accommodation) {
      return res.status(404).json({ message: 'Accommodation not found' });
    }

    res.json({
      message: 'Accommodation updated successfully',
      accommodation
    });
  } catch (error) {
    logger.error('admin.accommodation_update.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation could not be updated. Please check the entered details.');
  }
});


router.delete('/accommodations/:id', authenticateAdmin, async (req, res) => {
  try {
    const accommodation = await Accommodation.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!accommodation) {
      return res.status(404).json({ message: 'Accommodation not found' });
    }

    res.json({ message: 'Accommodation deleted successfully' });
  } catch (error) {
    logger.error('admin.accommodation_delete.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation could not be deleted. Please try again.');
  }
});


router.get('/accommodation-bookings', authenticateAdmin, async (req, res) => {
  try {
    const { status, occupancyType, accommodationId, search } = req.query;
    const filter = status ? { paymentStatus: status } : {};
    if (occupancyType) filter.occupancyType = String(occupancyType).toUpperCase();
    if (mongoose.isValidObjectId(accommodationId)) filter.accommodationId = accommodationId;

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      const users = await User.find({
        $or: [{ name: regex }, { email: regex }, { phone: regex }],
      }).select('_id').lean();
      filter.$or = [
        { bookingNumber: regex },
        { paymentReference: regex },
        { userId: { $in: users.map((user) => user._id) } },
      ];
    }

    const bookings = await AccommodationBooking.find(filter)
      .populate('userId', 'name email phone role')
      .populate('accommodationId', 'name location checkInTime checkOutTime')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    logger.error('admin.accommodation_bookings.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Accommodation bookings could not be loaded. Please try again.');
  }
});

export default router;
