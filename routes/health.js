import express from 'express';
import mongoose from 'mongoose';
import { sendTestEmail } from '../utils/email.js';
import logger from '../utils/logger.js';

const router = express.Router();

const requiredEnvironmentKeys = [
  'RAZORPAY_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM',
  'BUNNY_STORAGE_ZONE',
  'BUNNY_STORAGE_PASSWORD',
  'BUNNY_STORAGE_HOSTNAME',
  'BUNNY_PUBLIC_BASE_URL',
];

router.get('/live', (req, res) =>
  res.json({
    status: 'ok',
    service: 'aoacon-backend',
    timestamp: new Date().toISOString(),
  })
);

router.get('/ready', async (req, res) => {
  const missingEnvironment = requiredEnvironmentKeys.filter((key) => !process.env[key]);
  const databaseConnected = mongoose.connection.readyState === 1;
  let databasePing = false;

  if (databaseConnected) {
    try {
      await mongoose.connection.db.admin().ping();
      databasePing = true;
    } catch (error) {
      logger.error('health.database_ping.error', { message: error?.message || error });
    }
  }

  const ready = databaseConnected && databasePing && missingEnvironment.length === 0;
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    checks: {
      database: databasePing ? 'ok' : 'unavailable',
      configuration: missingEnvironment.length === 0 ? 'ok' : 'incomplete',
    },
    missingEnvironment,
    timestamp: new Date().toISOString(),
  });
});

const requireHealthToken = (req, res, next) => {
  const expected = process.env.HEALTH_CHECK_TOKEN;
  if (!expected) return next();
  const provided = req.header('x-health-check-token');
  if (provided !== expected) {
    return res.status(401).json({ message: 'Unauthorized' });
  }
  return next();
};

router.get('/email', requireHealthToken, async (req, res) => {
  const to = req.query.to || process.env.EMAIL_TEST_TO;
  if (!to) {
    return res.status(400).json({ message: 'Email test recipient not configured' });
  }
  try {
    logger.info(`Sending test email to ${to}.`);
    await sendTestEmail(to);
    logger.info(`Test email sent to ${to}.`);
    return res.json({ message: 'Email sent', to });
  } catch (error) {
    logger.error('Test email failed to send.', { message: error?.message || error });
    return res.status(500).json({
      message: 'Email send failed',
      error: error?.message || 'Unknown error',
    });
  }
});

export default router;
