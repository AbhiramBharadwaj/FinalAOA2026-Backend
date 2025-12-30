import mongoose from 'mongoose';

const abstractSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  title: {
    type: String,
    required: true,
    trim: true
  },
  authors: {
    type: String,
    required: true,
    trim: true
  },
  category: {
    type: String,
    enum: [
      'CLINICAL_RESEARCH',
      'CASE_STUDY',
      'REVIEW_ARTICLE',
      'ORIGINAL_RESEARCH',
      'EPIDEMIOLOGICAL_STUDY',
      'SURGICAL_TECHNIQUE',
      'DRUG_TRIAL',
      'DIAGNOSTIC_METHOD',
      'PREVENTIVE_CARE',
      'HEALTHCARE_POLICY'
    ],
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  reviewComments: {
    type: String
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  reviewedAt: {
    type: Date
  },
  submissionNumber: {
    type: String,
    unique: true
  }
}, {
  timestamps: true
});


abstractSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    this.submissionNumber = `ABS-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('Abstract', abstractSchema);