import express from 'express';
import multer from 'multer';
import Registration from '../models/Registration.js';
import { authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import { getBookingPhase, calculateRegistrationTotals, getAddOnPricing } from '../utils/pricing.js';
import { generateLifetimeMembershipId } from '../utils/membershipGenerator.js';
import logger from '../utils/logger.js';

const router = express.Router();
const upload = multer();
const COUPON_ENABLED = true;
const COUPONS = {
  AOACON5123: { discount: 500 },
  // Example for future:
  DISCOUNT10002026: { discount: 1000 },
};

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

const normalizeCouponCode = (code) =>
  code ? String(code).trim().toUpperCase() : '';

const resolveCouponDiscount = (code, basePrice) => {
  const normalized = normalizeCouponCode(code);
  if (!normalized) {
    return { code: null, discount: 0 };
  }
  const config = COUPONS[normalized];
  if (!config) {
    return { code: null, discount: 0 };
  }
  const discount = Math.max(0, Math.min(config.discount, Number(basePrice || 0)));
  return { code: normalized, discount };
};

const computeTotalsForRegistration = ({
  role,
  bookingPhase,
  addWorkshop,
  addAoaCourse,
  addLifeMembership,
  accompanyingPersons = 0,
  couponCode,
}) => {
  const pricingTotals = calculateRegistrationTotals(role, bookingPhase, {
    addWorkshop,
    addAoaCourse,
    addLifeMembership,
  });

  if (!pricingTotals || pricingTotals.packageBase <= 0) {
    return null;
  }

  const accompanyingCount = parseInt(accompanyingPersons, 10) || 0;
  const accompanyingBase = accompanyingCount * 7000;
  const basePrice = pricingTotals.basePrice || 0;

  const resolved = couponCode ? resolveCouponDiscount(couponCode, basePrice) : { code: null, discount: 0 };
  const couponCodeFinal = resolved.code;
  const couponDiscount = resolved.discount;

  const discountedBasePrice = Math.max(0, basePrice - couponDiscount);
  const packageBase =
    discountedBasePrice +
    (pricingTotals.workshopAddOn || 0) +
    (pricingTotals.aoaCourseAddOn || 0) +
    (pricingTotals.lifeMembershipAddOn || 0);
  const totalBase = packageBase + accompanyingBase;
  const totalGST = Math.round(totalBase * 0.18);
  const subtotalWithGST = totalBase + totalGST;
  const processingFee = Math.round(subtotalWithGST * 0.0195);
  const finalAmount = subtotalWithGST + processingFee;

  return {
    basePrice,
    packageBase,
    packageGST: Math.round(packageBase * 0.18),
    totalBase,
    totalGST,
    subtotalWithGST,
    processingFee,
    totalAmount: finalAmount,
    workshopAddOn: pricingTotals.workshopAddOn,
    aoaCourseBase: pricingTotals.aoaCourseAddOn,
    aoaCourseGST: pricingTotals.aoaCourseAddOn > 0 ? Math.round(pricingTotals.aoaCourseAddOn * 0.18) : 0,
    lifeMembershipBase: pricingTotals.lifeMembershipAddOn,
    accompanyingBase,
    accompanyingGST: Math.round(accompanyingBase * 0.18),
    couponCode: couponCodeFinal,
    couponDiscount,
  };
};

router.post(
  '/',
  authenticateUser,
  requireProfileComplete,
  upload.none(),
  async (req, res) => {
    try {
      logger.info(`${req.actorName || 'User'} is checking registration options.`);
      const {
        selectedWorkshop: requestedWorkshop,
        accompanyingPersons = '0',
        addWorkshop = 'false',
        addAoaCourse = 'false',
        addLifeMembership = 'false',
        couponCode: requestedCoupon,
      } = req.body;
      let selectedWorkshop = requestedWorkshop;

      let wantsWorkshop = addWorkshop === 'true';
      let wantsAoaCourse = addAoaCourse === 'true';
      let wantsLifeMembership = addLifeMembership === 'true';

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

      const addOnSelections = [];
      if (wantsWorkshop) {
        addOnSelections.push(
          selectedWorkshop ? `Workshop (${selectedWorkshop})` : 'Workshop'
        );
      }
      if (wantsAoaCourse) addOnSelections.push('AOA Certified Course');
      if (wantsLifeMembership) addOnSelections.push('AOA Life Membership');
      const selectionText = addOnSelections.length ? addOnSelections.join(', ') : 'no add-ons';
      logger.info(`${req.actorName || 'User'} selected ${selectionText} and proceeded to checkout.`);

      
      let registration = await Registration.findOne({ userId: req.user._id });

      if (registration?.paymentStatus === 'PAID') {
        if (registration.addWorkshop && !wantsWorkshop) wantsWorkshop = true;
        if (registration.addAoaCourse && !wantsAoaCourse) wantsAoaCourse = true;
        if (registration.addLifeMembership && !wantsLifeMembership) wantsLifeMembership = true;
        if (registration.addWorkshop && registration.selectedWorkshop) {
          selectedWorkshop = registration.selectedWorkshop;
        }
      }

      if (wantsWorkshop && !selectedWorkshop) {
        return res.status(400).json({ message: 'Workshop selection is required' });
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
      const basePrice = pricingTotals.basePrice || 0;

      let couponCode = registration?.couponCode || null;
      let couponDiscount = registration?.couponDiscount || 0;
      const normalizedRequestedCoupon = normalizeCouponCode(requestedCoupon);

      if (normalizedRequestedCoupon) {
        if (!COUPON_ENABLED) {
          return res.status(400).json({ message: 'Coupons are currently disabled.' });
        }
        const resolved = resolveCouponDiscount(normalizedRequestedCoupon, basePrice);
        if (!resolved.code) {
          return res.status(400).json({ message: 'Invalid coupon code.' });
        }
        couponCode = resolved.code;
        couponDiscount = resolved.discount;
      } else {
        couponCode = null;
        couponDiscount = 0;
      }

      const discountedBasePrice = Math.max(0, basePrice - couponDiscount);
      const packageBase =
        discountedBasePrice +
        (pricingTotals.workshopAddOn || 0) +
        (pricingTotals.aoaCourseAddOn || 0) +
        (pricingTotals.lifeMembershipAddOn || 0);
      const totalBase = packageBase + accompanyingBase;
      const totalGST = Math.round(totalBase * 0.18);
      const subtotalWithGST = totalBase + totalGST;
      const processingFee = Math.round(subtotalWithGST * 0.0195);
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
        basePrice,
        packageBase,
        packageGST: Math.round(packageBase * 0.18),
        totalBase,
        totalGST,
        subtotalWithGST,
        processingFee,
        totalAmount: finalAmount,
        couponCode,
        couponDiscount,
        couponAppliedAt: couponCode ? new Date() : null,
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
        logger.info(
          `${req.actorName || 'User'} updated the registration. Total amount is INR ${registration.totalAmount}.`
        );
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
        logger.info(
          `${req.actorName || 'User'} created a registration. Total amount is INR ${registration.totalAmount}.`
        );
        res.status(201).json({
          message: 'Registration created successfully',
          registration,
        });
      }

      await registration.populate('userId', 'name email role membershipId');

    } catch (error) {
      logger.error('Registration update failed.', { message: error?.message || error });
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

router.post('/apply-coupon', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const { couponCode } = req.body || {};
    if (!COUPON_ENABLED) {
      return res.status(400).json({ message: 'Coupons are currently disabled.' });
    }
    const normalizedCoupon = normalizeCouponCode(couponCode);
    if (!normalizedCoupon) {
      return res.status(400).json({ message: 'Coupon code is required.' });
    }

    const registration = await Registration.findOne({ userId: req.user._id });
    if (!registration) {
      return res.status(404).json({ message: 'No registration found' });
    }

    const normalizedRole = normalizeRole(req.user.role);
    const bookingPhase = registration.bookingPhase || getBookingPhase();
    const pricingTotals = calculateRegistrationTotals(normalizedRole, bookingPhase, {
      addWorkshop: registration.addWorkshop,
      addAoaCourse: registration.addAoaCourse,
      addLifeMembership: registration.addLifeMembership,
    });

    const basePrice = pricingTotals.basePrice || 0;
    const resolved = resolveCouponDiscount(normalizedCoupon, basePrice);
    if (!resolved.code) {
      return res.status(400).json({ message: 'Invalid coupon code.' });
    }

    const discountedBasePrice = Math.max(0, basePrice - resolved.discount);
    const packageBase =
      discountedBasePrice +
      (pricingTotals.workshopAddOn || 0) +
      (pricingTotals.aoaCourseAddOn || 0) +
      (pricingTotals.lifeMembershipAddOn || 0);
    const accompanyingBase = registration.accompanyingBase || 0;
    const totalBase = packageBase + accompanyingBase;
    const totalGST = Math.round(totalBase * 0.18);
    const subtotalWithGST = totalBase + totalGST;
    const processingFee = Math.round(subtotalWithGST * 0.0195);
    const totalAmount = subtotalWithGST + processingFee;

    registration.basePrice = basePrice;
    registration.packageBase = packageBase;
    registration.packageGST = Math.round(packageBase * 0.18);
    registration.totalBase = totalBase;
    registration.totalGST = totalGST;
    registration.subtotalWithGST = subtotalWithGST;
    registration.processingFee = processingFee;
    registration.totalAmount = totalAmount;
    registration.couponCode = resolved.code;
    registration.couponDiscount = resolved.discount;
    registration.couponAppliedAt = new Date();
    registration.paymentStatus =
      (registration.totalPaid || 0) >= totalAmount ? 'PAID' : 'PENDING';

    await registration.save();

    res.json(registration);
  } catch (error) {
    logger.error('registration.apply_coupon.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/validate-coupon', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const registration = await Registration.findOne({ userId: req.user._id });
    if (!registration) {
      return res.status(404).json({ message: 'No registration found' });
    }

    const normalizedRole = normalizeRole(req.user.role);
    const bookingPhase = registration.bookingPhase || getBookingPhase();

    const totals = computeTotalsForRegistration({
      role: normalizedRole,
      bookingPhase,
      addWorkshop: registration.addWorkshop,
      addAoaCourse: registration.addAoaCourse,
      addLifeMembership: registration.addLifeMembership,
      accompanyingPersons: registration.accompanyingPersons,
      couponCode: registration.couponCode,
    });

    if (!totals) {
      return res.status(400).json({ message: 'Pricing not available for this registration' });
    }

    const couponValid = Boolean(totals.couponCode);
    registration.basePrice = totals.basePrice;
    registration.packageBase = totals.packageBase;
    registration.packageGST = totals.packageGST;
    registration.totalBase = totals.totalBase;
    registration.totalGST = totals.totalGST;
    registration.subtotalWithGST = totals.subtotalWithGST;
    registration.processingFee = totals.processingFee;
    registration.totalAmount = totals.totalAmount;
    registration.workshopAddOn = totals.workshopAddOn;
    registration.aoaCourseBase = totals.aoaCourseBase;
    registration.aoaCourseGST = totals.aoaCourseGST;
    registration.lifeMembershipBase = totals.lifeMembershipBase;
    registration.accompanyingBase = totals.accompanyingBase;
    registration.accompanyingGST = totals.accompanyingGST;
    registration.couponCode = totals.couponCode;
    registration.couponDiscount = totals.couponDiscount;
    registration.couponAppliedAt = totals.couponCode ? registration.couponAppliedAt || new Date() : null;

    const totalPaid = registration.totalPaid || 0;
    registration.paymentStatus = totalPaid >= totals.totalAmount ? 'PAID' : 'PENDING';

    await registration.save();

    res.json({ registration, couponValid });
  } catch (error) {
    logger.error('registration.validate_coupon.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/my-registration', authenticateUser, async (req, res) => {
  try {
    logger.debug('registration.fetch_self.start', { requestId: req.requestId, userId: req.user?._id });
    const registration = await Registration.findOne({ userId: req.user._id })
      .populate('userId', 'name email role membershipId');

    if (!registration) {
      return res.status(404).json({ message: 'No registration found' });
    }

    logger.debug('registration.fetch_self.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: registration._id,
    });
    res.json(registration);
  } catch (error) {
    logger.error('registration.fetch_self.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/pricing', authenticateUser, async (req, res) => {
  try {
    logger.debug('registration.pricing.start', { requestId: req.requestId, userId: req.user?._id });
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
    logger.debug('registration.pricing.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      bookingPhase,
    });
  } catch (error) {
    logger.error('registration.pricing.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
