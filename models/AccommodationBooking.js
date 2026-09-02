import mongoose from 'mongoose';
import Counter from './Counter.js';

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
  occupancyType: {
    type: String,
    enum: ['SINGLE', 'SHARING']
  },
  roommateName: {
    type: String,
    trim: true
  },
  checkInTime: {
    type: String,
    default: '14:00'
  },
  checkOutTime: {
    type: String,
    default: '12:00'
  },
  baseRatePerNight: {
    type: Number,
    min: 0
  },
  gstRate: {
    type: Number,
    min: 0
  },
  baseAmount: {
    type: Number,
    min: 0
  },
  gstAmount: {
    type: Number,
    min: 0
  },
  amountCollected: {
    type: Number,
    min: 0
  },
  paymentMethod: {
    type: String,
    enum: ['UPI', 'BANK_TRANSFER', 'CASH', 'OTHER']
  },
  paymentReference: {
    type: String,
    trim: true
  },
  paymentDate: Date,
  amountAdjustmentNote: {
    type: String,
    trim: true
  },
  adminNotes: {
    type: String,
    trim: true
  },
  createdByAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  updatedByAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
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
  paymentEmailSentAt: Date,
  paymentEmailSendingAt: Date,
  paymentEmailFailedAt: Date,
  paymentEmailError: String,
  paymentOrderCreatingAt: Date,
  bookingNumber: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});


accommodationBookingSchema.pre('save', async function(next) {
  if (!this.isNew || this.bookingNumber) return next();
  try {
    const session = this.$session();
    let counter = await Counter.findOne({ name: 'accommodationBookingNumber' }).session(session || null);
    if (!counter) {
      const existing = await this.constructor.find(
        { bookingNumber: { $regex: /^ACC-\d+$/ } },
        'bookingNumber'
      ).session(session || null).lean();
      const maxSeq = existing.reduce((max, booking) => {
        const seq = Number(String(booking.bookingNumber).slice(4));
        return Number.isFinite(seq) ? Math.max(max, seq) : max;
      }, 0);
      try {
        [counter] = await Counter.create(
          [{ name: 'accommodationBookingNumber', seq: maxSeq }],
          session ? { session } : undefined
        );
      } catch (error) {
        if (error?.code !== 11000) throw error;
      }
    }
    counter = await Counter.findOneAndUpdate(
      { name: 'accommodationBookingNumber' },
      { $inc: { seq: 1 } },
      { new: true, ...(session ? { session } : {}) }
    );
    this.bookingNumber = `ACC-${String(counter.seq).padStart(4, '0')}`;
    return next();
  } catch (error) {
    return next(error);
  }
});

export default mongoose.model('AccommodationBooking', accommodationBookingSchema);
