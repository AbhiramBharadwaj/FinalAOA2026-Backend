import express from 'express';
import crypto from 'crypto';
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
import { calculateRegistrationTotals, getBookingPhase } from '../utils/pricing.js';
import { buildRegistrationInvoicePdf } from '../utils/invoice.js';
import logger from '../utils/logger.js';

const router = express.Router();

const REGISTRATION_PREFIX = 'AOA2026-';

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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/manual-registrations/quote', authenticateAdmin, async (req, res) => {
  try {
    const { role, bookingPhase, addWorkshop, addAoaCourse, addLifeMembership } = req.body;
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

    const phase = bookingPhase || getBookingPhase();
    const pricingTotals = calculateRegistrationTotals(normalizedRole, phase, {
      addWorkshop: wantsWorkshop,
      addAoaCourse: wantsAoaCourse,
      addLifeMembership: wantsLifeMembership,
    });

    if (!pricingTotals || pricingTotals.packageBase <= 0) {
      return res.status(400).json({ message: 'Pricing is not available for this selection.' });
    }

    const totalBase = pricingTotals.packageBase;
    const totalGST = Math.round(totalBase * 0.18);
    const subtotalWithGST = totalBase + totalGST;
    const processingFee = Math.round(subtotalWithGST * 0.0195);
    const finalAmount = subtotalWithGST + processingFee;

    res.json({
      bookingPhase: phase,
      basePrice: pricingTotals.basePrice,
      workshopAddOn: pricingTotals.workshopAddOn,
      aoaCourseAddOn: pricingTotals.aoaCourseAddOn,
      lifeMembershipAddOn: pricingTotals.lifeMembershipAddOn,
      totalBase,
      totalGST,
      processingFee,
      totalAmount: finalAmount,
    });
  } catch (error) {
    logger.error('admin.manual_registration_quote.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
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
      utr,
    } = req.body;

    if (!name || !email || !phone || !role) {
      return res.status(400).json({ message: 'Name, email, phone, and role are required.' });
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
    const pricingTotals = calculateRegistrationTotals(normalizedRole, phase, {
      addWorkshop: wantsWorkshop,
      addAoaCourse: wantsAoaCourse,
      addLifeMembership: wantsLifeMembership,
    });

    if (!pricingTotals || pricingTotals.packageBase <= 0) {
      return res.status(400).json({ message: 'Pricing is not available for this selection.' });
    }

    const accompanyingBase = 0;
    const totalBase = pricingTotals.packageBase + accompanyingBase;
    const totalGST = Math.round(totalBase * 0.18);
    const subtotalWithGST = totalBase + totalGST;
    const processingFee = Math.round(subtotalWithGST * 0.0195);
    const finalAmount = subtotalWithGST + processingFee;

    const userPayload = {
      name: String(name).trim(),
      email: String(email).toLowerCase().trim(),
      phone: String(phone).trim(),
      role: normalizedRole,
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
      membershipId: normalizedRole === 'AOA' ? membershipId : undefined,
      isActive: true,
      isVerified: true,
      isProfileComplete: true,
    };

    const registrationPayload = {
      registrationType: wantsWorkshop ? 'WORKSHOP_CONFERENCE' : 'CONFERENCE_ONLY',
      addWorkshop: wantsWorkshop,
      selectedWorkshop: wantsWorkshop ? selectedWorkshop : null,
      workshopAddOn: pricingTotals.workshopAddOn,
      accompanyingPersons: 0,
      accompanyingBase,
      accompanyingGST: 0,
      addAoaCourse: wantsAoaCourse,
      aoaCourseBase: pricingTotals.aoaCourseAddOn,
      aoaCourseGST: pricingTotals.aoaCourseAddOn > 0 ? Math.round(pricingTotals.aoaCourseAddOn * 0.18) : 0,
      addLifeMembership: wantsLifeMembership,
      lifeMembershipBase: pricingTotals.lifeMembershipAddOn,
      bookingPhase: phase,
      basePrice: pricingTotals.basePrice,
      packageBase: pricingTotals.packageBase,
      packageGST: pricingTotals.gst,
      totalBase,
      totalGST,
      subtotalWithGST,
      processingFee,
      totalAmount: finalAmount,
      totalPaid: finalAmount,
      paymentStatus: 'PAID',
      registrationNumber,
      razorpayPaymentId: utr || undefined,
      razorpayOrderId: `manual_${Date.now()}_${registrationNumber}`,
    };

    let user = existingUser;
    if (user) {
      Object.assign(user, userPayload);
      if (!user.password) {
        user.password = crypto.randomBytes(10).toString('hex');
      }
      user = await user.save();
    } else {
      const tempPassword = crypto.randomBytes(10).toString('hex');
      user = await User.create({ ...userPayload, password: tempPassword });
    }

    const registration = await Registration.create({
      userId: user._id,
      ...registrationPayload,
    });

    const counter = await Counter.findOne({ name: 'registrationNumber' });
    if (!counter) {
      await Counter.create({ name: 'registrationNumber', seq });
    } else if (seq > (counter.seq || 0)) {
      counter.seq = seq;
      await counter.save();
    }

    const attendance = await Attendance.create({
      registrationId: registration._id,
      qrCodeData: registration.registrationNumber,
    });

    await Payment.create({
      userId: user._id,
      registrationId: registration._id,
      amount: finalAmount,
      currency: 'INR',
      status: 'SUCCESS',
      paymentType: 'REGISTRATION',
      razorpayOrderId: registrationPayload.razorpayOrderId,
      razorpayPaymentId: utr || undefined,
    });

    const { rawToken, tokenHash, expiresAt } = createResetToken();
    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = expiresAt;
    await user.save();
    const resetLink = `${getFrontendUrl()}/reset-password?token=${rawToken}&email=${encodeURIComponent(
      user.email
    )}`;

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
    } catch (emailError) {
      user.resetEmailFailedAt = new Date();
      user.resetEmailError = emailError?.message || String(emailError);
      await user.save();
      logger.warn('manual_registration.reset_email_failed', {
        userId: user._id,
        message: emailError?.message || emailError,
      });
    }

    try {
      const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
        width: 512,
        margin: 1,
        color: { dark: '#005aa9', light: '#ffffff' },
      });
      const invoiceBuffer = buildRegistrationInvoicePdf(registration, user, {
        paymentId: registration.razorpayPaymentId || utr || 'Manual',
        paidAt: new Date(),
      });

      await sendPaymentSuccessEmail({
        user,
        subject: `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
        summaryLines: [
          `Registration No: ${registration.registrationNumber || 'N/A'}`,
          `Package: ${buildRegistrationLabel(registration)}`,
          `Amount Paid: INR ${Number(finalAmount || 0).toLocaleString('en-IN')}`,
          'Payment Status: PAID',
        ],
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
      user,
    });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(400).json({ message: 'Duplicate record detected. Please re-check inputs.' });
    }
    logger.error('admin.manual_registration.error', { requestId: req.requestId, message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});

// Export endpoints for attendance (add these)
router.get('/export-attended', authenticateAdmin, async (req, res) => {
  try {
    // This would use a library like exceljs to generate Excel file
    // Implementation depends on your excel generation setup
    res.json({ message: 'Attended list export endpoint' });
  } catch (error) {
    res.status(500).json({ message: 'Export failed' });
  }
});

router.get('/export-not-attended', authenticateAdmin, async (req, res) => {
  try {
    // Implementation for not attended export
    res.json({ message: 'Not attended list export endpoint' });
  } catch (error) {
    res.status(500).json({ message: 'Export failed' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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

    await sendPaymentSuccessEmail({
      user: registration.userId,
      subject: `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
      summaryLines: [
        `Registration No: ${registration.registrationNumber || 'N/A'}`,
        `Package: ${buildRegistrationLabel(registration)}`,
        `Amount Paid: INR ${Number(registration.totalPaid || registration.totalAmount || 0).toLocaleString(
          'en-IN'
        )}`,
        'Payment Status: PAID',
      ],
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
    res.status(500).json({ message: 'Unable to resend email.' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
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
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/accommodation-bookings', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { paymentStatus: status } : {};

    const bookings = await AccommodationBooking.find(filter)
      .populate('userId', 'name email phone')
      .populate('accommodationId', 'name location')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    logger.error('admin.accommodation_bookings.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
