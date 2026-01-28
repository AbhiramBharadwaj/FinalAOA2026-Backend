import mongoose from 'mongoose';
import Counter from './Counter.js';

const registrationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    registrationType: {
      type: String,
      enum: [
        'CONFERENCE_ONLY',
        'WORKSHOP_CONFERENCE',
        'COMBO',
        'AOA_CERTIFIED_COURSE',
      ],
      required: true,
    },
    selectedWorkshop: {
      type: String,
      enum: [
        'labour-analgesia',
        'critical-incidents',
        'pocus',
        'maternal-collapse',
        '',
      ],
      default: null,
      validate: {
        validator: function (value) {
          if (this.addWorkshop) {
            return value && value.trim() !== '';
          }
          return true; 
        },
        message: 'Workshop selection is required when adding a workshop',
      },
    },
    accompanyingPersons: {
      type: Number,
      min: 0,
      default: 0,
    },
    accompanyingBase: {
      type: Number,
      default: 0,
    },
    accompanyingGST: {
      type: Number,
      default: 0,
    },

    
    addWorkshop: {
      type: Boolean,
      default: false,
    },
    addAoaCourse: {
      type: Boolean,
      default: false,
    },
    addLifeMembership: {
      type: Boolean,
      default: false,
    },
    aoaCourseBase: {
      type: Number,
      default: 0,
    },
    aoaCourseGST: {
      type: Number,
      default: 0,
    },
    lifeMembershipBase: {
      type: Number,
      default: 0,
    },
    workshopAddOn: {
      type: Number,
      default: 0,
    },

    bookingPhase: {
      type: String,
      enum: ['EARLY_BIRD', 'REGULAR', 'SPOT'],
      required: true,
    },

    
    packageBase: {
      type: Number,
      default: 0,
    },
    packageGST: {
      type: Number,
      default: 0,
    },

    
    totalBase: {
      type: Number,
      default: 0,
    },
    totalGST: {
      type: Number,
      default: 0,
    },
    subtotalWithGST: {
      type: Number,
      default: 0,
    },
    processingFee: {
      type: Number,
      default: 0,
    },
    totalAmount: {
      type: Number,
      required: true, 
    },
    totalPaid: {
      type: Number,
      default: 0,
    },

    
    basePrice: {
      type: Number,
      default: 0,
    },
    workshopPrice: {
      type: Number,
      default: 0,
    },
    comboDiscount: {
      type: Number,
      default: 0,
    },
    gst: {
      type: Number,
      default: 0,
    },

    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED'],
      default: 'PENDING',
    },
    lifetimeMembershipId: {
      type: String,
      sparse: true,
    },
    razorpayOrderId: String,
    razorpayPaymentId: String,
    registrationNumber: {
      type: String,
      unique: true,
    },
    paymentEmailSentAt: {
      type: Date,
    },
    paymentEmailFailedAt: {
      type: Date,
    },
    paymentEmailError: {
      type: String,
    },
    collegeLetter: {
      data: Buffer,
      contentType: String,
    },
  },
  {
    timestamps: true,
  }
);


const REGISTRATION_COUNTER_NAME = 'registrationNumber';
const REGISTRATION_PREFIX = 'AOA2026-';
const REGISTRATION_PREFIX_LENGTH = REGISTRATION_PREFIX.length;

const ensureRegistrationCounter = async (RegistrationModel) => {
  const existing = await Counter.findOne({ name: REGISTRATION_COUNTER_NAME });
  if (existing) return;

  const maxResult = await RegistrationModel.aggregate([
    { $match: { registrationNumber: { $regex: /^AOA2026-\d+$/ } } },
    {
      $project: {
        seq: {
          $toInt: {
            $substrBytes: ['$registrationNumber', REGISTRATION_PREFIX_LENGTH, 10],
          },
        },
      },
    },
    { $group: { _id: null, maxSeq: { $max: '$seq' } } },
  ]);

  const initialSeq = maxResult[0]?.maxSeq || 0;
  try {
    await Counter.create({
      name: REGISTRATION_COUNTER_NAME,
      seq: initialSeq,
    });
  } catch (err) {
    if (err?.code !== 11000) {
      throw err;
    }
  }
};

registrationSchema.pre('save', async function (next) {
  if (this.isNew && !this.registrationNumber) {
    try {
      await ensureRegistrationCounter(this.constructor);
      const counter = await Counter.findOneAndUpdate(
        { name: REGISTRATION_COUNTER_NAME },
        { $inc: { seq: 1 } },
        { new: true }
      );
      this.registrationNumber = `${REGISTRATION_PREFIX}${String(counter.seq).padStart(4, '0')}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

export default mongoose.model('Registration', registrationSchema);
