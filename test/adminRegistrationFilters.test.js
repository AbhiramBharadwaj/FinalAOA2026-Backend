import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAdminRegistrationFilter,
  getRegistrationChoiceFilter,
  normalizeAttendeeRoleFilter,
} from '../utils/adminRegistrationFilters.js';

test('AOA course filter includes both current and legacy representations', () => {
  assert.deepEqual(getRegistrationChoiceFilter('AOA_CERTIFIED_COURSE'), {
    $or: [
      { addAoaCourse: true },
      { registrationType: 'AOA_CERTIFIED_COURSE' },
    ],
  });
});

test('life membership filter uses the add-on flag', () => {
  assert.deepEqual(getRegistrationChoiceFilter('life_membership'), {
    addLifeMembership: true,
  });
});

test('conference-only filter excludes every add-on flag', () => {
  assert.deepEqual(getRegistrationChoiceFilter('CONFERENCE_ONLY'), {
    addWorkshop: { $ne: true },
    addAoaCourse: { $ne: true },
    addLifeMembership: { $ne: true },
  });
});

test('admin filter combines payment status, workshop, and registration choice as AND', () => {
  assert.deepEqual(
    buildAdminRegistrationFilter({
      paymentStatus: 'PAID',
      workshop: 'pocus',
      registrationChoice: 'WORKSHOP_CONFERENCE',
    }),
    {
      $and: [
        {
          paymentStatus: 'PAID',
          addWorkshop: true,
          selectedWorkshop: 'pocus',
        },
        {
          $or: [
            { addWorkshop: true },
            { selectedWorkshop: { $nin: [null, ''] } },
            { registrationType: 'WORKSHOP_CONFERENCE' },
          ],
        },
      ],
    }
  );
});

test('attendee role accepts current and alternate query parameter names', () => {
  assert.equal(normalizeAttendeeRoleFilter({ attendeeType: 'NON_AOA' }), 'NON_AOA');
  assert.equal(normalizeAttendeeRoleFilter({ role: 'PGS' }), 'PGS');
});
