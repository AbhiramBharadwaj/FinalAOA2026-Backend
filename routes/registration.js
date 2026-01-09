import express from 'express';
import multer from 'multer';
import Registration from '../models/Registration.js';
import { authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import { getBookingPhase, calculateRegistrationTotals, getAddOnPricing } from '../utils/pricing.js';
import { generateLifetimeMembershipId } from '../utils/membershipGenerator.js';

const router = express.Router();
const upload = multer();

const normalizeRole = (role) => {
  if (!role) return role;
  const trimmed = String(role).trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'aoa member') return 'AOA';
  if (lower === 'non-aoa member' || lower === 'non aoa member') return 'NON_AOA';
  if (lower === 'pgs & fellows' || lower === 'pgs and fellows') return 'PGS';
  if (lower === 'aoa') return 'AOA';
  if (lower === 'non_aoa' || lower === 'non-aoa') return 'NON_AOA';
  if (lower === 'pgs') return 'PGS';
  return trimmed;
};

router.post(
  '/',
  authenticateUser,
  requireProfileComplete,
  upload.none(),
  async (req, res) => {
    try {
      const {
        selectedWorkshop,
        accompanyingPersons = '0',
        addWorkshop = 'false',
        addAoaCourse = 'false',
        addLifeMembership = 'false',
      } = req.body;

      let wantsWorkshop = addWorkshop === 'true';
      let wantsAoaCourse = addAoaCourse === 'true';
      let wantsLifeMembership = addLifeMembership === 'true';

      if (wantsWorkshop && !selectedWorkshop) {
        return res.status(400).json({ message: 'Workshop selection is required' });
      }

      const normalizedRole = normalizeRole(req.user.role);

      if (wantsAoaCourse && normalizedRole === 'PGS') {
        return res.status(400).json({
          message: 'AOA Certified Course is only available for AOA and Non-AOA members',
        });
      }

      if (wantsLifeMembership && normalizedRole !== 'NON_AOA') {
        return res.status(400).json({
          message: 'AOA Life Membership is only available for Non-AOA members',
        });
      }

      if (normalizedRole === 'AOA' && wantsWorkshop && wantsAoaCourse) {
        return res.status(400).json({
          message: 'AOA members can choose either Workshop or AOA Certified Course',
        });
      }

      
      let registration = await Registration.findOne({ userId: req.user._id });

      if (registration?.paymentStatus === 'PAID') {
        if (registration.addWorkshop && !wantsWorkshop) wantsWorkshop = true;
        if (registration.addAoaCourse && !wantsAoaCourse) wantsAoaCourse = true;
        if (registration.addLifeMembership && !wantsLifeMembership) wantsLifeMembership = true;
      }

      
      const isAoaRequested = wantsAoaCourse;
      const wasAoaRequested =
        registration?.registrationType === 'AOA_CERTIFIED_COURSE' || registration?.addAoaCourse;

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

      const bookingPhase =
        registration?.paymentStatus === 'PAID' ? registration.bookingPhase : getBookingPhase();
      const addOnPricing = getAddOnPricing(normalizedRole, bookingPhase);

      if (wantsWorkshop && addOnPricing.workshop.priceWithoutGST <= 0 && !registration?.addWorkshop) {
        return res.status(400).json({ message: 'Workshops are not available in this phase' });
      }

      if (wantsAoaCourse && bookingPhase === 'SPOT' && !registration?.addAoaCourse) {
        return res.status(400).json({ message: 'AOA Certified Course is not available for spot registration' });
      }

      if (wantsLifeMembership && addOnPricing.lifeMembership.priceWithoutGST <= 0 && !registration?.addLifeMembership) {
        return res.status(400).json({ message: 'AOA Life Membership is not available in this phase' });
      }

      const pricingTotals = calculateRegistrationTotals(normalizedRole, bookingPhase, {
        addWorkshop: wantsWorkshop,
        addAoaCourse: wantsAoaCourse,
        addLifeMembership: wantsLifeMembership,
      });

      if (!pricingTotals || pricingTotals.packageBase <= 0) {
        return res.status(400).json({
          message: 'Pricing not available for this package in current phase',
        });
      }

      const accompanyingCount = parseInt(accompanyingPersons, 10) || 0;
      const accompanyingBase = accompanyingCount * 7000;
      const totalBase = pricingTotals.packageBase + accompanyingBase;
      const totalGST = Math.round(totalBase * 0.18);
      const subtotalWithGST = totalBase + totalGST;
      const processingFee = Math.round(subtotalWithGST * 0.0165);
      const finalAmount = subtotalWithGST + processingFee;

      const updateData = {
        registrationType: wantsWorkshop ? 'WORKSHOP_CONFERENCE' : 'CONFERENCE_ONLY',
        addWorkshop: wantsWorkshop,
        selectedWorkshop: wantsWorkshop ? selectedWorkshop : null,
        workshopAddOn: pricingTotals.workshopAddOn,
        accompanyingPersons: accompanyingCount,
        accompanyingBase,
        accompanyingGST: Math.round(accompanyingBase * 0.18),
        addAoaCourse: wantsAoaCourse,
        aoaCourseBase: pricingTotals.aoaCourseAddOn,
        aoaCourseGST: pricingTotals.aoaCourseAddOn > 0 ? Math.round(pricingTotals.aoaCourseAddOn * 0.18) : 0,
        addLifeMembership: wantsLifeMembership,
        lifeMembershipBase: pricingTotals.lifeMembershipAddOn,
        bookingPhase,
        basePrice: pricingTotals.basePrice,
        packageBase: pricingTotals.packageBase,
        packageGST: pricingTotals.gst,
        totalBase,
        totalGST,
        subtotalWithGST,
        processingFee,
        totalAmount: finalAmount,
        lifetimeMembershipId:
          wantsLifeMembership
            ? registration?.lifetimeMembershipId || generateLifetimeMembershipId()
            : null,
      };

      const totalPaid = registration?.totalPaid || 0;
      updateData.totalPaid = totalPaid;
      updateData.paymentStatus = totalPaid >= finalAmount ? 'PAID' : 'PENDING';

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
    const normalizedRole = normalizeRole(req.user.role);

    const basePricing = calculateRegistrationTotals(normalizedRole, bookingPhase, {});
    const addOnPricing = getAddOnPricing(normalizedRole, bookingPhase);

    const aoaCourseCount = await Registration.countDocuments({
      $or: [{ registrationType: 'AOA_CERTIFIED_COURSE' }, { addAoaCourse: true }],
    });

    const aoaCourseFull = aoaCourseCount >= 40;

    res.json({
      bookingPhase,
      base: {
        conference: {
          priceWithoutGST: basePricing.basePrice,
          gst: Math.round(basePricing.basePrice * 0.18),
          totalAmount: basePricing.basePrice + Math.round(basePricing.basePrice * 0.18),
        },
      },
      addOns: {
        workshop: {
          priceWithoutGST: addOnPricing.workshop.priceWithoutGST,
          gst: Math.round(addOnPricing.workshop.priceWithoutGST * 0.18),
          totalAmount:
            addOnPricing.workshop.priceWithoutGST +
            Math.round(addOnPricing.workshop.priceWithoutGST * 0.18),
        },
        aoaCourse: normalizedRole === 'AOA' || normalizedRole === 'NON_AOA'
          ? {
              priceWithoutGST: addOnPricing.aoaCourse.priceWithoutGST,
              gst: Math.round(addOnPricing.aoaCourse.priceWithoutGST * 0.18),
              totalAmount:
                addOnPricing.aoaCourse.priceWithoutGST +
                Math.round(addOnPricing.aoaCourse.priceWithoutGST * 0.18),
            }
          : null,
        lifeMembership: normalizedRole === 'NON_AOA'
          ? {
              priceWithoutGST: addOnPricing.lifeMembership.priceWithoutGST,
              gst: Math.round(addOnPricing.lifeMembership.priceWithoutGST * 0.18),
              totalAmount:
                addOnPricing.lifeMembership.priceWithoutGST +
                Math.round(addOnPricing.lifeMembership.priceWithoutGST * 0.18),
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
