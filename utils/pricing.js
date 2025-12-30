// booking phase unchanged
export const getBookingPhase = () => {
  const now = new Date();
  const year = 2026;

  const earlyBirdEnd = new Date(year, 7, 15); // 15 Aug
  const regularEnd = new Date(year, 9, 15);   // 15 Oct

  if (now <= earlyBirdEnd) return 'EARLY_BIRD';
  if (now <= regularEnd) return 'REGULAR';
  return 'SPOT';
};

export const calculatePrice = (userRole, registrationType, bookingPhase) => {
  let basePrice = 0;
  let workshopPrice = 0;
  let comboDiscount = 0;
  let totalWithoutGST = 0;
  let gst = 0;
  let totalAmount = 0;

  if (registrationType === 'CONFERENCE_ONLY') {
    basePrice = getConferencePrice(userRole, bookingPhase);
    totalWithoutGST = basePrice;
  }

  if (registrationType === 'WORKSHOP_CONFERENCE') {
    basePrice = getConferencePrice(userRole, bookingPhase);
    workshopPrice = getWorkshopPrice(userRole, bookingPhase);
    totalWithoutGST = basePrice + workshopPrice;
  }

  if (registrationType === 'COMBO') {
    totalWithoutGST = getComboPrice(userRole, bookingPhase);
  }

  // AOA Certified Course only: flat ₹5000 (AOA / NON_AOA); not for PGS
  if (registrationType === 'AOA_CERTIFIED_COURSE') {
    basePrice = getAOACoursePrice(userRole); // 0 for PGS
    totalWithoutGST = basePrice;
  }

  gst = Math.round(totalWithoutGST * 0.18);
  totalAmount = totalWithoutGST + gst;

  return {
    basePrice,
    workshopPrice,
    comboDiscount,
    totalWithoutGST,
    gst,
    totalAmount,
    bookingPhase,
  };
};

const getConferencePrice = (userRole, bookingPhase) => {
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

  return prices[userRole]?.[bookingPhase] || 0;
};

const getWorkshopPrice = (userRole, bookingPhase) => {
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

  return prices[userRole]?.[bookingPhase] || 0;
};

const getComboPrice = (userRole, bookingPhase) => {
  const prices = {
    AOA: {
      EARLY_BIRD: 0,
      REGULAR: 0,
      SPOT: 0,
    },
    NON_AOA: {
      EARLY_BIRD: 16000,
      REGULAR: 18000,
      SPOT: 0,
    },
    PGS: {
      EARLY_BIRD: 12000,
      REGULAR: 14000,
      SPOT: 0,
    },
  };

  return prices[userRole]?.[bookingPhase] || 0;
};

// new helper: flat 5000 for members, blocked for PGS
const getAOACoursePrice = (userRole) => {
  if (userRole === 'AOA' || userRole === 'NON_AOA') {
    return 5000;
  }
  return 0; // PGS not allowed; backend also blocks
};

export const roleMap = {
  AOA: 'AOA Member',
  NON_AOA: 'Non-AOA Member',
  PGS: 'PGS & Fellows',
};

export const registrationTypeDisplay = {
  CONFERENCE_ONLY: 'Conference Only',
  WORKSHOP_CONFERENCE: 'Workshop + Conference',
  COMBO: 'Combo (Conference + Workshop + Lifetime Membership)',
  AOA_CERTIFIED_COURSE: 'AOA Certified Course Only',
};
