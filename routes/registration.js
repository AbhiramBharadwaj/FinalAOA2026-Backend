import express from 'express';
import multer from 'multer';
import Registration from '../models/Registration.js';
import { authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import { getBookingPhase, calculateRegistrationTotals, getAddOnPricing } from '../utils/pricing.js';
import {
  AOA_COURSE_CAPACITY,
  COUPON_ENABLED,
  computeRegistrationTotals,
  isAoaCourseFullForUser,
  normalizeCouponCode,
  resolveCouponDiscount,
} from '../utils/registrationTotals.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';

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
      let registration = await Registration.findOne({ userId: req.user._id });
      const pricingRole = registration?.pricingRole ||
        (registration?.addLifeMembership ? 'NON_AOA' : normalizedRole);

      if (wantsAoaCourse && normalizedRole === 'PGS') {
        return res.status(400).json({
          message: 'AOA Certified Course is only available for AOA and Non-AOA members',
        });
      }

      if (wantsLifeMembership && pricingRole !== 'NON_AOA') {
        return res.status(400).json({
          message: 'AOA Life Membership is only available for Non-AOA members',
        });
      }

      if (pricingRole === 'AOA' && wantsWorkshop && wantsAoaCourse) {
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

      
      const hasPriorPayment = Number(registration?.totalPaid || 0) > 0;
      if (hasPriorPayment) {
        if (registration.addWorkshop && !wantsWorkshop) wantsWorkshop = true;
        if (registration.addAoaCourse && !wantsAoaCourse) wantsAoaCourse = true;
        if (
          registration.addLifeMembership &&
          registration.membershipStatus === 'ACTIVE' &&
          !wantsLifeMembership
        ) wantsLifeMembership = true;
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
        if (currentCount >= AOA_COURSE_CAPACITY) {
          return res.status(400).json({ message: 'AOA Certified Course seats are full' });
        }
      }

      const bookingPhase = hasPriorPayment ? registration.bookingPhase : getBookingPhase();
      const addOnPricing = getAddOnPricing(pricingRole, bookingPhase);

      if (wantsWorkshop && addOnPricing.workshop.priceWithoutGST <= 0 && !registration?.addWorkshop) {
        return res.status(400).json({ message: 'Workshops are not available in this phase' });
      }

      if (wantsAoaCourse && bookingPhase === 'SPOT' && !registration?.addAoaCourse) {
        return res.status(400).json({ message: 'AOA Certified Course is not available for spot registration' });
      }

      if (wantsLifeMembership && addOnPricing.lifeMembership.priceWithoutGST <= 0 && !registration?.addLifeMembership) {
        return res.status(400).json({ message: 'AOA Life Membership is not available in this phase' });
      }

      const pricingTotals = calculateRegistrationTotals(pricingRole, bookingPhase, {
        addWorkshop: wantsWorkshop,
        addAoaCourse: wantsAoaCourse,
        addLifeMembership: wantsLifeMembership,
      });

      if (!pricingTotals || pricingTotals.packageBase <= 0) {
        return res.status(400).json({
          message: 'Pricing not available for this package in current phase',
        });
      }

      const requestedAccompanyingCount = parseInt(accompanyingPersons, 10) || 0;
      const accompanyingCount = hasPriorPayment
        ? Math.max(registration?.accompanyingPersons || 0, requestedAccompanyingCount)
        : requestedAccompanyingCount;
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
        pricingRole,
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
        lifetimeMembershipId: registration?.lifetimeMembershipId || null,
        membershipStatus: wantsLifeMembership
          ? registration?.membershipStatus === 'ACTIVE' ||
            (registration?.lifetimeMembershipId && registration?.paymentStatus === 'PAID')
            ? 'ACTIVE'
            : 'PAYMENT_PENDING'
          : 'NOT_REQUESTED',
        membershipRequestedAt: wantsLifeMembership
          ? registration?.membershipRequestedAt || new Date()
          : null,
      };

      const totalPaid = registration?.totalPaid || 0;
      updateData.totalPaid = totalPaid;
      updateData.paymentStatus = totalPaid >= finalAmount ? 'PAID' : 'PENDING';
      if (updateData.paymentStatus === 'PENDING') {
        updateData.paymentEmailSentAt = null;
        updateData.paymentEmailSendingAt = null;
        updateData.paymentEmailFailedAt = null;
        updateData.paymentEmailError = null;
      }

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
      return sendErrorResponse(res, error, 'Registration could not be saved. Please try again.');
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
    const pricingRole = registration.pricingRole ||
      (registration.addLifeMembership ? 'NON_AOA' : normalizedRole);
    const bookingPhase = registration.bookingPhase || getBookingPhase();
    const pricingTotals = calculateRegistrationTotals(pricingRole, bookingPhase, {
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
    registration.pricingRole = pricingRole;
    registration.paymentStatus =
      (registration.totalPaid || 0) >= totalAmount ? 'PAID' : 'PENDING';

    await registration.save();

    res.json(registration);
  } catch (error) {
    logger.error('registration.apply_coupon.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Coupon could not be applied. Please try again.');
  }
});

router.post('/validate-coupon', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const registration = await Registration.findOne({ userId: req.user._id });
    if (!registration) {
      return res.status(404).json({ message: 'No registration found' });
    }

    const normalizedRole = normalizeRole(req.user.role);
    const pricingRole = registration.pricingRole ||
      (registration.addLifeMembership ? 'NON_AOA' : normalizedRole);
    const bookingPhase = registration.bookingPhase || getBookingPhase();

    const totals = computeRegistrationTotals({
      role: pricingRole,
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
    registration.pricingRole = pricingRole;

    const totalPaid = registration.totalPaid || 0;
    registration.paymentStatus = totalPaid >= totals.totalAmount ? 'PAID' : 'PENDING';

    await registration.save();

    res.json({ registration, couponValid });
  } catch (error) {
    logger.error('registration.validate_coupon.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Coupon could not be validated. Please try again.');
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
    return sendErrorResponse(res, error, 'Registration details could not be loaded. Please try again.');
  }
});


router.get('/pricing', authenticateUser, async (req, res) => {
  try {
    logger.debug('registration.pricing.start', { requestId: req.requestId, userId: req.user?._id });
    const normalizedRole = normalizeRole(req.user.role);
    const registration = await Registration.findOne({ userId: req.user._id }).lean();
    const pricingRole = registration?.pricingRole ||
      (registration?.addLifeMembership ? 'NON_AOA' : normalizedRole);
    const bookingPhase = Number(registration?.totalPaid || 0) > 0
      ? registration.bookingPhase
      : getBookingPhase();

    const basePricing = calculateRegistrationTotals(pricingRole, bookingPhase, {});
    const addOnPricing = getAddOnPricing(pricingRole, bookingPhase);

    const aoaCourseCount = await Registration.countDocuments({
      $or: [{ registrationType: 'AOA_CERTIFIED_COURSE' }, { addAoaCourse: true }],
    });

    const hasAoaCourseReservation = Boolean(
      registration?.registrationType === 'AOA_CERTIFIED_COURSE' || registration?.addAoaCourse
    );
    const aoaCourseFull = isAoaCourseFullForUser(
      aoaCourseCount,
      hasAoaCourseReservation
    );

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
        aoaCourse: pricingRole === 'AOA' || pricingRole === 'NON_AOA'
          ? {
              priceWithoutGST: addOnPricing.aoaCourse.priceWithoutGST,
              gst: Math.round(addOnPricing.aoaCourse.priceWithoutGST * 0.18),
              totalAmount:
                addOnPricing.aoaCourse.priceWithoutGST +
                Math.round(addOnPricing.aoaCourse.priceWithoutGST * 0.18),
            }
          : null,
        lifeMembership: pricingRole === 'NON_AOA'
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
        aoaCourseLimit: AOA_COURSE_CAPACITY,
        hasAoaCourseReservation,
        pricingRole,
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
    return sendErrorResponse(res, error, 'Registration pricing could not be loaded. Please try again.');
  }
});

export default router;
