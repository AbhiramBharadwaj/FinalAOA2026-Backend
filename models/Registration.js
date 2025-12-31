import mongoose from 'mongoose';

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
          if (
            this.registrationType === 'WORKSHOP_CONFERENCE' ||
            this.registrationType === 'COMBO'
          ) {
            return value && value.trim() !== '';
          }
          return true; 
        },
        message: 'Workshop selection is required for WORKSHOP_CONFERENCE or COMBO',
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

    
    addAoaCourse: {
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
    collegeLetter: {
      data: Buffer,
      contentType: String,
    },
  },
  {
    timestamps: true,
  }
);


registrationSchema.pre('save', async function (next) {
  if (this.isNew && !this.registrationNumber) {
    try {
      const count = await this.constructor.countDocuments();
      this.registrationNumber = `AOA2026-${String(count + 1).padStart(4, '0')}`;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

export default mongoose.model('Registration', registrationSchema);