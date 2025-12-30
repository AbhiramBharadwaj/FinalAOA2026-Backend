import mongoose from 'mongoose';

const accommodationBookingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  accommodationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Accommodation',
    required: true
  },
  checkInDate: {
    type: Date,
    required: true
  },
  checkOutDate: {
    type: Date,
    required: true
  },
  numberOfNights: {
    type: Number,
    required: true
  },
  numberOfGuests: {
    type: Number,
    required: true,
    min: 1,
    max: 4
  },
  roomsBooked: {
    type: Number,
    required: true,
    min: 1
  },
  totalAmount: {
    type: Number,
    required: true
  },
  paymentStatus: {
    type: String,
    enum: ['PENDING', 'PAID', 'FAILED'],
    default: 'PENDING'
  },
  bookingStatus: {
    type: String,
    enum: ['CONFIRMED', 'CANCELLED', 'PENDING'],
    default: 'PENDING'
  },
  specialRequests: String,
  razorpayOrderId: String,
  razorpayPaymentId: String,
  bookingNumber: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});


accommodationBookingSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    this.bookingNumber = `ACC-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('AccommodationBooking', accommodationBookingSchema);