import { calculateRegistrationTotals } from './pricing.js';

export const AOA_COURSE_CAPACITY = 53;
export const COUPON_ENABLED = true;
export const COUPONS = {
  AOACON50011: { discount: 500 },
};

export const normalizeCouponCode = (code) =>
  code ? String(code).trim().toUpperCase() : '';

export const resolveCouponDiscount = (code, basePrice) => {
  const normalized = normalizeCouponCode(code);
  if (!normalized || !COUPON_ENABLED) return { code: null, discount: 0 };
  const config = COUPONS[normalized];
  if (!config) return { code: null, discount: 0 };
  return {
    code: normalized,
    discount: Math.max(0, Math.min(config.discount, Number(basePrice || 0))),
  };
};

export const computeRegistrationTotals = ({
  role,
  bookingPhase,
  addWorkshop = false,
  addAoaCourse = false,
  addLifeMembership = false,
  accompanyingPersons = 0,
  couponCode,
}) => {
  const pricingTotals = calculateRegistrationTotals(role, bookingPhase, {
    addWorkshop,
    addAoaCourse,
    addLifeMembership,
  });
  if (!pricingTotals || pricingTotals.packageBase <= 0) return null;

  const accompanyingCount = Math.max(0, Number.parseInt(accompanyingPersons, 10) || 0);
  const accompanyingBase = accompanyingCount * 7000;
  const basePrice = pricingTotals.basePrice || 0;
  const resolvedCoupon = couponCode
    ? resolveCouponDiscount(couponCode, basePrice)
    : { code: null, discount: 0 };
  const discountedBasePrice = Math.max(0, basePrice - resolvedCoupon.discount);
  const packageBase =
    discountedBasePrice +
    (pricingTotals.workshopAddOn || 0) +
    (pricingTotals.aoaCourseAddOn || 0) +
    (pricingTotals.lifeMembershipAddOn || 0);
  const totalBase = packageBase + accompanyingBase;
  const totalGST = Math.round(totalBase * 0.18);
  const subtotalWithGST = totalBase + totalGST;
  const processingFee = Math.round(subtotalWithGST * 0.0195);

  return {
    bookingPhase,
    basePrice,
    workshopAddOn: pricingTotals.workshopAddOn || 0,
    aoaCourseBase: pricingTotals.aoaCourseAddOn || 0,
    aoaCourseGST:
      pricingTotals.aoaCourseAddOn > 0
        ? Math.round(pricingTotals.aoaCourseAddOn * 0.18)
        : 0,
    lifeMembershipBase: pricingTotals.lifeMembershipAddOn || 0,
    accompanyingPersons: accompanyingCount,
    accompanyingBase,
    accompanyingGST: Math.round(accompanyingBase * 0.18),
    packageBase,
    packageGST: Math.round(packageBase * 0.18),
    totalBase,
    totalGST,
    subtotalWithGST,
    processingFee,
    totalAmount: subtotalWithGST + processingFee,
    couponCode: resolvedCoupon.code,
    couponDiscount: resolvedCoupon.discount,
  };
};
