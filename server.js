import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import crypto from 'crypto';
import authRoutes from './routes/auth.js';
import registrationRoutes from './routes/registration.js';
import accommodationRoutes from './routes/accommodation.js';
import abstractRoutes from './routes/abstract.js';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payment.js';
import attendanceRoutes from './routes/attendance.js';
import healthRoutes from './routes/health.js';
import logger from './utils/logger.js';
dotenv.config();

const app = express();
const PORT = 5050;

// Replace app.use(cors()) with this:
app.use(cors({
  origin: ["https://www.aoacon2026.com", "https://aoacon2026.com"],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true, // Allow cookies/auth headers if needed
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Add this right after to handle the browser's initial "OPTIONS" check
app.options('*', cors());

app.use(express.json());
app.use('/uploads', express.static('uploads'));
app.use((req, res, next) => {
  const requestId = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  req.requestId = requestId;
  const start = Date.now();
  logger.info('request.start', {
    requestId,
    method: req.method,
    path: req.originalUrl,
    ip: req.ip,
  });
  res.on('finish', () => {
    logger.info('request.end', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

app.use('/api/auth', authRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/accommodation', accommodationRoutes);
app.use('/api/abstract', abstractRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/health', healthRoutes);

mongoose.connect("mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority")
  .then(() => logger.info('mongo.connected'))
  .catch(err => logger.error('mongo.connection_error', { message: err?.message || err }));

app.use((err, req, res, next) => {
  logger.error('request.unhandled_error', {
    requestId: req.requestId,
    message: err?.message || 'Unknown error',
    stack: err?.stack,
  });
  if (res.headersSent) {
    return next(err);
  }
  return res.status(500).json({ message: 'Server error' });
});

app.listen(PORT, () => {
  logger.info('server.started', { port: PORT });
});
