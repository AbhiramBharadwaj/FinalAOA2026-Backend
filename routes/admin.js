import express from 'express';
import Registration from '../models/Registration.js';
import Payment from '../models/Payment.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Accommodation from '../models/Accommodation.js';
import Abstract from '../models/Abstract.js';
import Feedback from '../models/Feedback.js';
import User from '../models/User.js';
import Attendance from '../models/Attendance.js'; // Add this import
import { authenticateAdmin } from '../middleware/auth.js';
import { sendCollegeLetterReviewEmail } from '../utils/email.js';
import logger from '../utils/logger.js';

const router = express.Router();

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
