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
 * Calculate base price (excluding GST) for a registration type
 */
export const calculatePrice = (userRole, registrationType, bookingPhase) => {
  let basePrice = 0;
  let workshopPrice = 0;
  let aoaCoursePrice = 0;
  let totalWithoutGST = 0;
  let gst = 0;
  let totalAmount = 0;

  if (registrationType === 'CONFERENCE_ONLY') {
    basePrice = getConferencePrice(userRole, bookingPhase);
    totalWithoutGST = basePrice;
  }

  if (registrationType === 'WORKSHOP_CONFERENCE') {
    workshopPrice = getWorkshopPrice(userRole, bookingPhase);
    totalWithoutGST = workshopPrice;
  }

  if (registrationType === 'COMBO') {
    totalWithoutGST = getComboPrice(userRole, bookingPhase);
  }

  if (registrationType === 'AOA_CERTIFIED_COURSE') {
    aoaCoursePrice = getAOACoursePrice(userRole);
    totalWithoutGST = aoaCoursePrice;
  }

  
  gst = Math.round(totalWithoutGST * 0.18);
  totalAmount = totalWithoutGST + gst;

  return {
    basePrice,
    workshopPrice,
    aoaCoursePrice,
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


const getAOACoursePrice = (userRole) => {
  return (userRole === 'AOA' || userRole === 'NON_AOA') ? 5000 : 0;
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