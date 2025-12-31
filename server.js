import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import authRoutes from './routes/auth.js';
import registrationRoutes from './routes/registration.js';
import accommodationRoutes from './routes/accommodation.js';
import abstractRoutes from './routes/abstract.js';
import feedbackRoutes from './routes/feedback.js';
import adminRoutes from './routes/admin.js';
import paymentRoutes from './routes/payment.js';
import attendanceRoutes from './routes/attendance.js';
dotenv.config();

const app = express();
const PORT = 5050;

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

app.use('/api/auth', authRoutes);
app.use('/api/registration', registrationRoutes);
app.use('/api/accommodation', accommodationRoutes);
app.use('/api/abstract', abstractRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/attendance', attendanceRoutes);

mongoose.connect("mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority")
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});