import mongoose from 'mongoose';
import Counter from './Counter.js';

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
      'ORIGINAL_RESEARCH',
      'CLINICAL_AUDIT_QUALITY_IMPROVEMENT',
      'CASE_REPORT_CASE_SERIES',
      'REVIEW_EDUCATIONAL_POSTER',
      'INNOVATIONS_IN_LABOUR_ANALGESIA_OBSTETRIC_ANAESTHESIA',
      'PATIENT_SAFETY_IN_OBSTETRIC_ANAESTHESIA',
      'SIMULATION_TRAINING_INITIATIVES'
    ],
    required: true
  },
  filePath: {
    type: String,
    required: true
  },
  finalPosterPath: {
    type: String
  },
  finalPosterOriginalName: {
    type: String,
    trim: true
  },
  finalPosterMimeType: {
    type: String,
    trim: true
  },
  finalPosterSize: {
    type: Number
  },
  finalPosterUploadedAt: {
    type: Date
  },
  finalPosterStatus: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED'],
    default: 'PENDING'
  },
  finalPosterReviewComments: {
    type: String,
    default: ''
  },
  finalPosterReviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  finalPosterReviewedAt: {
    type: Date
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
  },
  submissionHistory: {
    type: [
      {
        attemptNumber: { type: Number, required: true },
        title: { type: String, required: true, trim: true },
        authors: { type: String, required: true, trim: true },
        category: {
          type: String,
          enum: [
            'ORIGINAL_RESEARCH',
            'CLINICAL_AUDIT_QUALITY_IMPROVEMENT',
            'CASE_REPORT_CASE_SERIES',
            'REVIEW_EDUCATIONAL_POSTER',
            'INNOVATIONS_IN_LABOUR_ANALGESIA_OBSTETRIC_ANAESTHESIA',
            'PATIENT_SAFETY_IN_OBSTETRIC_ANAESTHESIA',
            'SIMULATION_TRAINING_INITIATIVES'
          ],
          required: true
        },
        filePath: { type: String, required: true },
        submittedAt: { type: Date, default: Date.now },
        finalStatus: {
          type: String,
          enum: ['PENDING', 'APPROVED', 'REJECTED'],
          default: 'PENDING'
        },
        reviewComments: { type: String, default: '' },
        reviewedAt: { type: Date }
      }
    ],
    default: []
  }
}, {
  timestamps: true
});


const ABSTRACT_COUNTER_NAME = 'abstractSubmissionNumber';
const ABSTRACT_PREFIX = 'ABS-';
const ABSTRACT_PREFIX_LENGTH = ABSTRACT_PREFIX.length;

const ensureAbstractCounter = async (AbstractModel) => {
  const existing = await Counter.findOne({ name: ABSTRACT_COUNTER_NAME });
  if (existing) return;

  const maxResult = await AbstractModel.aggregate([
    { $match: { submissionNumber: { $regex: /^ABS-\d+$/ } } },
    {
      $project: {
        seq: {
          $toInt: {
            $substrBytes: ['$submissionNumber', ABSTRACT_PREFIX_LENGTH, 10],
          },
        },
      },
    },
    { $group: { _id: null, maxSeq: { $max: '$seq' } } },
  ]);

  const initialSeq = maxResult[0]?.maxSeq || 0;
  try {
    await Counter.create({
      name: ABSTRACT_COUNTER_NAME,
      seq: initialSeq,
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }
  }
};

abstractSchema.pre('save', async function(next) {
  if (!this.isNew || this.submissionNumber) return next();

  try {
    await ensureAbstractCounter(this.constructor);
    const counter = await Counter.findOneAndUpdate(
      { name: ABSTRACT_COUNTER_NAME },
      { $inc: { seq: 1 } },
      { new: true }
    );
    this.submissionNumber = `${ABSTRACT_PREFIX}${String(counter.seq).padStart(4, '0')}`;
    return next();
  } catch (error) {
    return next(error);
  }
});

export default mongoose.model('Abstract', abstractSchema);
