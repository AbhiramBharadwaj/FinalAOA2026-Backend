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
  upload.single('collegeLetter'),
  async (req, res) => {
    try {
      const {
        registrationType,
        selectedWorkshop,
        accompanyingPersons = '0',
        addAoaCourse = 'false',
      } = req.body;

      if (!registrationType) {
        return res.status(400).json({ message: 'Registration type is required' });
      }

      const isWorkshopType =
        registrationType === 'WORKSHOP_CONFERENCE' || registrationType === 'COMBO';

      if (isWorkshopType && !selectedWorkshop) {
        return res.status(400).json({ message: 'Workshop selection is required' });
      }

      if (registrationType === 'AOA_CERTIFIED_COURSE' && req.user.role === 'PGS') {
        return res.status(400).json({
          message: 'AOA Certified Course is only available for AOA and Non-AOA members',
        });
      }

      if (addAoaCourse === 'true' && req.user.role === 'PGS') {
        return res.status(400).json({
          message: 'PGS members cannot add AOA Certified Course',
        });
      }

      
      let registration = await Registration.findOne({ userId: req.user._id });

      
      const isAoaRequested = registrationType === 'AOA_CERTIFIED_COURSE' || addAoaCourse === 'true';
      const wasAoaRequested = registration?.registrationType === 'AOA_CERTIFIED_COURSE' || registration?.addAoaCourse;

      if (isAoaRequested && !wasAoaRequested) {
        
        const currentCount = await Registration.countDocuments({
          $or: [
            { registrationType: 'AOA_CERTIFIED_COURSE' },
            { addAoaCourse: true },
          ],
        });
        if (currentCount >= 40) {
          return res.status(400).json({ message: 'AOA Certified Course seats are full' });
        }
      }

      const bookingPhase = getBookingPhase();
      const basePricing = calculatePrice(req.user.role, registrationType, bookingPhase);

      if (!basePricing || basePricing.totalWithoutGST <= 0) {
        return res.status(400).json({
          message: 'Pricing not available for this package in current phase',
        });
      }

      const accompanyingCount = parseInt(accompanyingPersons, 10) || 0;
      const accompanyingBase = accompanyingCount * 7000;
      const aoaBase = addAoaCourse === 'true' ? 5000 : 0;

      const totalBase = basePricing.totalWithoutGST + accompanyingBase + aoaBase;
      const totalGST = Math.round(totalBase * 0.18);
      const subtotalWithGST = totalBase + totalGST;
      const processingFee = Math.round(subtotalWithGST * 0.0165);
      const finalAmount = subtotalWithGST + processingFee;

      const updateData = {
        registrationType,
        selectedWorkshop: isWorkshopType ? selectedWorkshop : null,
        accompanyingPersons: accompanyingCount,
        accompanyingBase,
        accompanyingGST: Math.round(accompanyingBase * 0.18),
        addAoaCourse: addAoaCourse === 'true',
        aoaCourseBase: aoaBase,
        aoaCourseGST: aoaBase > 0 ? 900 : 0,
        bookingPhase,
        packageBase: basePricing.totalWithoutGST,
        packageGST: basePricing.gst,
        totalBase,
        totalGST,
        subtotalWithGST,
        processingFee,
        totalAmount: finalAmount,
        lifetimeMembershipId:
          registrationType === 'COMBO' && !registration?.lifetimeMembershipId
            ? generateLifetimeMembershipId()
            : registration?.lifetimeMembershipId,
      };

      
      if (req.user.role === 'PGS') {
        if (!req.file && !registration?.collegeLetter) {
          return res.status(400).json({ message: 'College letter is required for PGS & Fellows' });
        }
        if (req.file) {
          updateData.collegeLetter = {
            data: req.file.buffer,
            contentType: req.file.mimetype,
          };
        }
      }

      if (registration) {
        
        Object.assign(registration, updateData);
        await registration.save();
        res.json({
          message: 'Registration updated successfully',
          registration,
        });
      } else {
        
        registration = new Registration({
          userId: req.user._id,
          ...updateData,
        });
        await registration.save();
        res.status(201).json({
          message: 'Registration created successfully',
          registration,
        });
      }

      await registration.populate('userId', 'name email role membershipId');

    } catch (error) {
      console.error('Registration error:', error);
      if (error.name === 'ValidationError') {
        return res.status(400).json({
          message: 'Validation failed',
          errors: Object.values(error.errors).map((e) => e.message),
        });
      }
      res.status(500).json({ message: 'Server error' });
    }
  }
);


router.get('/my-registration', authenticateUser, async (req, res) => {
  try {
    const registration = await Registration.findOne({ userId: req.user._id })
      .populate('userId', 'name email role membershipId');

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

    const conferenceOnly = calculatePrice(req.user.role, 'CONFERENCE_ONLY', bookingPhase);
    const workshopConference = calculatePrice(req.user.role, 'WORKSHOP_CONFERENCE', bookingPhase);
    const combo = calculatePrice(req.user.role, 'COMBO', bookingPhase);

    const aoaCourseStandalone =
      req.user.role === 'AOA' || req.user.role === 'NON_AOA'
        ? calculatePrice(req.user.role, 'AOA_CERTIFIED_COURSE', bookingPhase)
        : null;

    const aoaCourseCount = await Registration.countDocuments({
      $or: [
        { registrationType: 'AOA_CERTIFIED_COURSE' },
        { addAoaCourse: true },
      ],
    });

    const aoaCourseFull = aoaCourseCount >= 40;

    res.json({
      bookingPhase,
      pricing: {
        CONFERENCE_ONLY: conferenceOnly,
        WORKSHOP_CONFERENCE: workshopConference,
        COMBO: combo,
        AOA_CERTIFIED_COURSE: aoaCourseStandalone,
      },
      addOns: {
        aoaCourseAddOn:
          req.user.role === 'AOA' || req.user.role === 'NON_AOA'
            ? {
                priceWithoutGST: 5000,
                gst: 900,
                totalAmount: 5900,
              }
            : null,
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