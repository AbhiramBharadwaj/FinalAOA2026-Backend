import { createHash } from 'node:crypto';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';

const positiveIntegerFromEnv = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

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

// Shared Wi-Fi must not make one attendee exhaust everyone else's reset allowance.
const passwordResetIpLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  message: 'Too many password-reset requests from this network. Please wait 15 minutes and try again.',
});

const passwordResetAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const account = createHash('sha256').update(email).digest('hex');
    return `${ipKeyGenerator(req.ip)}:${req.path}:${account}`;
  },
  message: { message: 'Too many password-reset requests for this email. Please wait 15 minutes and try again.' },
});

export const passwordResetLimiter = [passwordResetIpLimiter, passwordResetAccountLimiter];

export const facultyCvOtpLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true,
  message: 'Too many OTP requests. Please wait before trying again.',
});

export const facultyCvRecoveryLimiter = buildLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  message: 'Too many lookup attempts. Please wait before trying again.',
});

export const accountRegistrationLimiter = buildLimiter({
  windowMs: positiveIntegerFromEnv('ACCOUNT_REGISTRATION_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  limit: positiveIntegerFromEnv('ACCOUNT_REGISTRATION_RATE_LIMIT', 500),
  message: 'Too many account-registration attempts. Please wait before trying again.',
});
