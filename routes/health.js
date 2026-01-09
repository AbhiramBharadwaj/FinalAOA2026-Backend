import express from 'express';
import { sendTestEmail } from '../utils/email.js';

const router = express.Router();

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
    await sendTestEmail(to);
    return res.json({ message: 'Email sent', to });
  } catch (error) {
    return res.status(500).json({
      message: 'Email send failed',
      error: error?.message || 'Unknown error',
    });
  }
});

export default router;
