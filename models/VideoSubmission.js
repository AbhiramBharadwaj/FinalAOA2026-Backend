import mongoose from 'mongoose';

const submissionHistorySchema = new mongoose.Schema(
  {
    attemptNumber: { type: Number, required: true },
    title: { type: String, required: true, trim: true },
    presenterName: { type: String, required: true, trim: true },
    presenterDetails: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    filePath: { type: String, required: true },
    submittedAt: { type: Date, default: Date.now },
    finalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewComments: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { _id: false }
);

const videoSubmissionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    presenterName: {
      type: String,
      required: true,
      trim: true,
    },
    presenterDetails: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    filePath: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewComments: {
      type: String,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Admin',
    },
    reviewedAt: {
      type: Date,
    },
    submissionNumber: {
      type: String,
      unique: true,
    },
    submissionHistory: {
      type: [submissionHistorySchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

videoSubmissionSchema.pre('save', async function videoSubmissionPreSave(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    this.submissionNumber = `VID-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('VideoSubmission', videoSubmissionSchema);
