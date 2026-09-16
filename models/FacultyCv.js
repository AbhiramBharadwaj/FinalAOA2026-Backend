import mongoose from 'mongoose';

const facultyCvSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
    },
    role: {
      type: String,
      trim: true,
      default: '',
    },
    sourceSheetRow: {
      type: Number,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    cvStatus: {
      type: String,
      enum: ['NOT_UPLOADED', 'UPLOADED', 'REVIEWED'],
      default: 'NOT_UPLOADED',
    },
    cvFileName: {
      type: String,
      trim: true,
    },
    cvContentType: {
      type: String,
      trim: true,
    },
    cvSize: {
      type: Number,
    },
    cvR2Key: {
      type: String,
      trim: true,
    },
    cvUploadedAt: {
      type: Date,
    },
    lastOtpHash: {
      type: String,
    },
    lastOtpExpiresAt: {
      type: Date,
    },
    lastOtpSentAt: {
      type: Date,
    },
    uploadTokenHash: {
      type: String,
    },
    uploadTokenExpiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

facultyCvSchema.index({ cvStatus: 1 });

export default mongoose.model('FacultyCv', facultyCvSchema);
