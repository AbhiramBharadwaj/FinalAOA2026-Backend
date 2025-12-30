import express from 'express';
import Registration from '../models/Registration.js';
import { authenticateUser } from '../middleware/auth.js';
import { getBookingPhase, calculatePrice } from '../utils/pricing.js';
import { generateLifetimeMembershipId } from '../utils/membershipGenerator.js';
import multer from 'multer';

const router = express.Router();

const storage = multer.memoryStorage();
const upload = multer({ storage });

router.post(
  '/',
  authenticateUser,
  upload.fields([
    { name: 'registrationType', maxCount: 1 },
    { name: 'collegeLetter', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        registrationType,
        selectedWorkshop,
        accompanyingPersons = '0',
      } = req.body;

      if (!registrationType) {
        return res
          .status(400)
          .json({ message: 'Registration type is required' });
      }

      
      if (
        registrationType === 'AOA_CERTIFIED_COURSE' &&
        req.user.role === 'PGS'
      ) {
        return res.status(400).json({
          message: 'AOA Certified Course is only available for AOA and Non-AOA members',
        });
      }

      if (
        (registrationType === 'WORKSHOP_CONFERENCE' ||
          registrationType === 'COMBO') &&
        !selectedWorkshop
      ) {
        return res
          .status(400)
          .json({ message: 'Workshop selection is required' });
      }

      const userId = req.user._id;

      const existingRegistration = await Registration.findOne({ userId });
      if (existingRegistration) {
        return res
          .status(400)
          .json({ message: 'User already has a registration' });
      }

      
      if (registrationType === 'AOA_CERTIFIED_COURSE') {
        const aoaCourseCount = await Registration.countDocuments({
          registrationType: 'AOA_CERTIFIED_COURSE',
        });
        if (aoaCourseCount >= 40) {
          return res
            .status(400)
            .json({ message: 'AOA Certified Course seats are full' });
        }
      }

      const bookingPhase = getBookingPhase();
      const pricing = calculatePrice(
        req.user.role,
        registrationType,
        bookingPhase
      );

      if (!pricing || pricing.totalAmount <= 0) {
        return res.status(400).json({
          message: 'Pricing not available for this package in current phase',
        });
      }

      const accompanyingCount =
         parseInt(accompanyingPersons, 10) || 0;
      const accompanyingTotal = accompanyingCount * 7000;
      const grandTotal = pricing.totalAmount + accompanyingTotal;

      const registrationData = {
        userId,
        registrationType,
        selectedWorkshop,
        accompanyingPersons: accompanyingCount,
        accompanyingTotal,
        bookingPhase,
        ...pricing,
        totalAmount: grandTotal,
        lifetimeMembershipId:
          registrationType === 'COMBO'
            ? generateLifetimeMembershipId()
            : undefined,
      };

      
      if (req.user.role === 'PGS' && req.files?.collegeLetter) {
        const file = req.files.collegeLetter[0];
        registrationData.collegeLetter = {
          data: file.buffer,
          contentType: file.mimetype,
        };
      }

      const registration = new Registration(registrationData);
      await registration.save();

      await registration.populate('userId', 'name email role');

      res.status(201).json({
        message: 'Registration created successfully',
        registration,
      });
    } catch (error) {
      console.error('Registration error:', error);
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          message: 'Validation failed',
          errors: Object.values(error.errors).map((e) => e.message),
        });
      }
      res.status(500).json({ message: 'Server error during registration' });
    }
  }
);

router.get('/my-registration', authenticateUser, async (req, res) => {
  try {
    const registration = await Registration.findOne({ userId: req.user._id }).populate(
      'userId',
      'name email role membershipId'
    );

    if (!registration) {
      return res.status(404).json({ message: 'No registration found' });
    }

    res.json(registration);
  } catch (error) {
    console.error('Get registration error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/pricing', authenticateUser, async (req, res) => {
  try {
    const bookingPhase = getBookingPhase();

    const conferenceOnly = calculatePrice(
      req.user.role,
      'CONFERENCE_ONLY',
      bookingPhase
    );
    const workshopConference = calculatePrice(
      req.user.role,
      'WORKSHOP_CONFERENCE',
      bookingPhase
    );
    const combo = calculatePrice(req.user.role, 'COMBO', bookingPhase);
    const aoaCourse = calculatePrice(
      req.user.role,
      'AOA_CERTIFIED_COURSE',
      bookingPhase
    );

    
    const aoaCourseCount = await Registration.countDocuments({
      registrationType: 'AOA_CERTIFIED_COURSE',
    });
    const aoaCourseFull = aoaCourseCount >= 40;

    res.json({
      bookingPhase,
      pricing: {
        CONFERENCE_ONLY: conferenceOnly,
        WORKSHOP_CONFERENCE: workshopConference,
        COMBO: combo,
        AOA_CERTIFIED_COURSE: aoaCourse,
      },
      meta: {
        aoaCourseCount,
        aoaCourseFull,
        aoaCourseLimit: 40,
      },
    });
  } catch (error) {
    console.error('Pricing error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;