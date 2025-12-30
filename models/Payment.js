import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  registrationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Registration'
  },
  accommodationBookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccommodationBooking'
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    default: 'INR'
  },
  status: {
    type: String,
    enum: ['PENDING', 'SUCCESS', 'FAILED'],
    default: 'PENDING'
  },
  paymentType: {
    type: String,
    enum: ['REGISTRATION', 'ACCOMMODATION'],
    required: true
  },
  razorpayOrderId: {
    type: String,
    required: true
  },
  razorpayPaymentId: String,
  razorpaySignature: String,
  failureReason: String
}, {
  timestamps: true
});

export default mongoose.model('Payment', paymentSchema);