import crypto from 'crypto';

export const generateLifetimeMembershipId = () => {
  const year = new Date().getFullYear();
  const randomString = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `AOA-LM-${year}-${randomString}`;
};