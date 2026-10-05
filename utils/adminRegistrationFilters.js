export const REGISTRATION_CHOICE_ALIASES = Object.freeze({
  CONFERENCE_ONLY: 'conference_only',
  conference_only: 'conference_only',
  conference: 'conference_only',
  WORKSHOP_CONFERENCE: 'workshop',
  workshop: 'workshop',
  workshop_conference: 'workshop',
  AOA_CERTIFIED_COURSE: 'aoa_course',
  aoa_certified_course: 'aoa_course',
  aoa_course: 'aoa_course',
  course: 'aoa_course',
  COMBO: 'life_membership',
  combo: 'life_membership',
  life_membership: 'life_membership',
  membership: 'life_membership',
});

export const normalizeFilterValue = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const normalizeChoice = (value) => {
  const normalized = normalizeFilterValue(value);
  if (!normalized) return null;
  return REGISTRATION_CHOICE_ALIASES[normalized] ||
    REGISTRATION_CHOICE_ALIASES[normalized.toLowerCase()] ||
    normalized.toLowerCase();
};

export const getRegistrationChoiceFilter = (choice) => {
  switch (normalizeChoice(choice)) {
    case 'conference_only':
      return {
        addWorkshop: { $ne: true },
        addAoaCourse: { $ne: true },
        addLifeMembership: { $ne: true },
      };
    case 'workshop':
      return {
        $or: [
          { addWorkshop: true },
          { selectedWorkshop: { $nin: [null, ''] } },
          { registrationType: 'WORKSHOP_CONFERENCE' },
        ],
      };
    case 'aoa_course':
      return {
        $or: [
          { addAoaCourse: true },
          { registrationType: 'AOA_CERTIFIED_COURSE' },
        ],
      };
    case 'life_membership':
      return { addLifeMembership: true };
    default:
      return null;
  }
};

export const buildAdminRegistrationFilter = (query = {}) => {
  const filter = {};
  const status = normalizeFilterValue(query.status || query.paymentStatus);
  const phase = normalizeFilterValue(query.phase || query.bookingPhase);
  const workshop = normalizeFilterValue(query.workshop || query.selectedWorkshop);
  const choice = query.registrationChoice || query.registrationType || query.package || query.addOn;

  if (status) filter.paymentStatus = status;
  if (phase) filter.bookingPhase = phase;
  if (workshop) {
    filter.addWorkshop = true;
    filter.selectedWorkshop = workshop;
  }

  const choiceFilter = getRegistrationChoiceFilter(choice);
  if (!choiceFilter) return filter;

  return { $and: [filter, choiceFilter] };
};

export const normalizeAttendeeRoleFilter = (query = {}) =>
  normalizeFilterValue(query.role || query.attendeeType || query.userRole);
