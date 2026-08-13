import Registration from '../models/Registration.js';
import User from '../models/User.js';
import { generateLifetimeMembershipId } from '../utils/membershipGenerator.js';

export const getEffectiveMembershipStatus = (registration) => {
  if (!registration?.addLifeMembership) return 'NOT_REQUESTED';
  if (registration.membershipStatus === 'ACTIVE') return 'ACTIVE';
  if (registration.lifetimeMembershipId && registration.paymentStatus === 'PAID') return 'ACTIVE';
  return registration.membershipStatus || 'PAYMENT_PENDING';
};

export const activatePaidLifeMembership = async (registrationId) => {
  let registration = await Registration.findById(registrationId);
  if (!registration?.addLifeMembership || registration.paymentStatus !== 'PAID') {
    return { activated: false, status: getEffectiveMembershipStatus(registration) };
  }

  const existingStatus = getEffectiveMembershipStatus(registration);
  let membershipId = registration.lifetimeMembershipId;

  if (existingStatus !== 'ACTIVE' && registration.membershipStatus !== 'ACTIVATING') {
    membershipId = membershipId || generateLifetimeMembershipId();
    const claimed = await Registration.findOneAndUpdate(
      {
        _id: registration._id,
        membershipStatus: { $nin: ['ACTIVE', 'ACTIVATING'] },
      },
      {
        $set: {
          membershipStatus: 'ACTIVATING',
          lifetimeMembershipId: membershipId,
        },
      },
      { new: true }
    );
    registration = claimed || await Registration.findById(registration._id);
    membershipId = registration.lifetimeMembershipId;
  }

  if (!membershipId) {
    membershipId = generateLifetimeMembershipId();
    registration.lifetimeMembershipId = membershipId;
    registration.membershipStatus = 'ACTIVATING';
    await registration.save();
  }

  const user = await User.findOneAndUpdate(
    {
      _id: registration.userId,
      $or: [
        { membershipId: membershipId },
        { membershipId: null },
        { membershipId: { $exists: false } },
      ],
    },
    {
      $set: {
        role: 'AOA',
        membershipId,
      },
    },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw new Error('User already has a different AOA Membership ID. Membership activation requires review.');
  }

  registration = await Registration.findByIdAndUpdate(
    registration._id,
    {
      $set: {
        membershipStatus: 'ACTIVE',
        lifetimeMembershipId: membershipId,
        membershipActivatedAt: registration.membershipActivatedAt || new Date(),
      },
    },
    { new: true }
  );

  return {
    activated: existingStatus !== 'ACTIVE',
    status: 'ACTIVE',
    membershipId,
    user,
    registration,
  };
};
