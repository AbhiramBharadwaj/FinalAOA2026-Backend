import mongoose from 'mongoose';
import { parseRegistrationSeq, registrationNumbering } from '../services/registrationNumbering.js';

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
    pricingRole: {
      type: String,
      enum: ['AOA', 'NON_AOA', 'PGS'],
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
    couponCode: {
      type: String,
      default: null,
    },
    couponDiscount: {
      type: Number,
      default: 0,
    },
    couponAppliedAt: {
      type: Date,
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
    membershipStatus: {
      type: String,
      enum: ['NOT_REQUESTED', 'PAYMENT_PENDING', 'ACTIVATING', 'ACTIVE'],
      default: 'NOT_REQUESTED',
    },
    membershipRequestedAt: Date,
    membershipActivatedAt: Date,
    membershipRequestedByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
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
    paymentEmailSendingAt: {
      type: Date,
    },
    paymentEmailFailedAt: {
      type: Date,
    },
    paymentEmailError: {
      type: String,
    },
    paymentOrderCreatingAt: {
      type: Date,
    },
    isManualRegistration: {
      type: Boolean,
      default: false,
    },
    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    manualRegistrationNotes: {
      type: String,
      trim: true,
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
  if (this.isNew) {
    try {
      const explicit = Boolean(this.registrationNumber);
      const preferredSeq = explicit ? parseRegistrationSeq(this.registrationNumber) : this.$locals.preferredRegistrationSeq;
      if (explicit && preferredSeq === null) throw new Error('Invalid registration number.');
      const result = await registrationNumbering.allocate(this.constructor, {
        source: this.isManualRegistration || explicit ? 'import' : 'online',
        preferredSeq, exact: explicit, session: this.$session(),
      });
      this.registrationNumber = result.registrationNumber;
    } catch (err) {
      return next(err);
    }
  }
  next();
});

export default mongoose.model('Registration', registrationSchema);
