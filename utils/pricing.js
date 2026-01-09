/**
 * Determine current booking phase based on date
 * Current date: December 31, 2025 → Returns 'SPOT'
 */
export const getBookingPhase = () => {
  const now = new Date();
  const year = 2026;

  
  const earlyBirdEnd = new Date(year, 7, 15); 

  
  const regularEnd = new Date(year, 9, 15); 

  if (now <= earlyBirdEnd) return 'EARLY_BIRD';
  if (now <= regularEnd) return 'REGULAR';
  return 'SPOT';
};

/**
 * Calculate registration totals using base conference + add-ons.
 */
export const calculateRegistrationTotals = (userRole, bookingPhase, options = {}) => {
  const normalizedRole = normalizeRole(userRole);
  const { addWorkshop = false, addAoaCourse = false, addLifeMembership = false } = options;

  const basePrice = getConferencePrice(normalizedRole, bookingPhase);
  const workshopAddOn = addWorkshop ? getWorkshopAddOnPrice(normalizedRole, bookingPhase) : 0;
  const aoaCourseAddOn = addAoaCourse ? getAOACourseAddOnPrice(normalizedRole) : 0;
  const lifeMembershipAddOn = addLifeMembership ? getLifeMembershipAddOnPrice(normalizedRole, bookingPhase) : 0;

  const packageBase = basePrice + workshopAddOn + aoaCourseAddOn + lifeMembershipAddOn;
  const gst = Math.round(packageBase * 0.18);
  const totalAmount = packageBase + gst;

  return {
    basePrice,
    workshopAddOn,
    aoaCourseAddOn,
    lifeMembershipAddOn,
    packageBase,
    gst,
    totalAmount,
    bookingPhase,
  };
};


const getConferencePrice = (userRole, bookingPhase) => {
  const role = normalizeRole(userRole);
  const prices = {
    AOA: {
      EARLY_BIRD: 8000,
      REGULAR: 10000,
      SPOT: 13000,
    },
    NON_AOA: {
      EARLY_BIRD: 11000,
      REGULAR: 13000,
      SPOT: 16000,
    },
    PGS: {
      EARLY_BIRD: 7000,
      REGULAR: 9000,
      SPOT: 12000,
    },
  };

  return prices[role]?.[bookingPhase] || 0;
};


const getWorkshopTotalPrice = (userRole, bookingPhase) => {
  const role = normalizeRole(userRole);
  const prices = {
    AOA: {
      EARLY_BIRD: 10000,
      REGULAR: 12000,
      SPOT: 0, 
    },
    NON_AOA: {
      EARLY_BIRD: 13000,
      REGULAR: 15000,
      SPOT: 0,
    },
    PGS: {
      EARLY_BIRD: 9000,
      REGULAR: 11000,
      SPOT: 0,
    },
  };

  return prices[role]?.[bookingPhase] || 0;
};


const getComboPrice = (userRole, bookingPhase) => {
  const role = normalizeRole(userRole);
  const prices = {
    AOA: {
      EARLY_BIRD: 0,
      REGULAR: 0,
      SPOT: 0,
    },
    NON_AOA: {
      EARLY_BIRD: 14000,
      REGULAR: 16000,
      SPOT: 0,
    },
    PGS: {
      EARLY_BIRD: 0,
      REGULAR: 0,
      SPOT: 0,
    },
  };

  return prices[role]?.[bookingPhase] || 0;
};


const getWorkshopAddOnPrice = (userRole, bookingPhase) => {
  const workshopTotal = getWorkshopTotalPrice(userRole, bookingPhase);
  const baseTotal = getConferencePrice(userRole, bookingPhase);
  return workshopTotal > 0 ? Math.max(0, workshopTotal - baseTotal) : 0;
};

const getLifeMembershipAddOnPrice = (userRole, bookingPhase) => {
  const comboTotal = getComboPrice(userRole, bookingPhase);
  const baseTotal = getConferencePrice(userRole, bookingPhase);
  return comboTotal > 0 ? Math.max(0, comboTotal - baseTotal) : 0;
};

const getAOACourseAddOnPrice = (userRole) => {
  const role = normalizeRole(userRole);
  if (role === 'AOA') return 5000;
  if (role === 'NON_AOA') return 5000;
  return 0;
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

export const getAddOnPricing = (userRole, bookingPhase) => ({
  workshop: {
    priceWithoutGST: getWorkshopAddOnPrice(userRole, bookingPhase),
  },
  aoaCourse: {
    priceWithoutGST: bookingPhase === 'SPOT' ? 0 : getAOACourseAddOnPrice(userRole),
  },
  lifeMembership: {
    priceWithoutGST: getLifeMembershipAddOnPrice(userRole, bookingPhase),
  },
});


export const roleMap = {
  AOA: 'AOA Member',
  NON_AOA: 'Non-AOA Member',
  PGS: 'PGS & Fellows',
};

export const registrationTypeDisplay = {
  CONFERENCE_ONLY: 'Conference Only',
  WORKSHOP_CONFERENCE: 'Workshop + Conference',
  COMBO: 'Conference + Life Membership',
  AOA_CERTIFIED_COURSE: 'AOA Certified Course',
};
