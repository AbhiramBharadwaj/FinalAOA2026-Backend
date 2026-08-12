import { rateLimit } from 'express-rate-limit';

const buildLimiter = ({ windowMs, limit, message, skipSuccessfulRequests = false }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    message: { message },
  });

export const userLoginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
});

export const adminLoginLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  message: 'Too many admin login attempts. Please wait 15 minutes and try again.',
});

export const passwordResetLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  message: 'Too many password-reset requests. Please wait before trying again.',
});

export const accountRegistrationLimiter = buildLimiter({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  message: 'Too many account-registration attempts. Please wait before trying again.',
});
