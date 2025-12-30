import mongoose from 'mongoose';

const feedbackSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  overallRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  venueRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  contentRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  organizationRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  networkingRating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  comments: {
    type: String,
    maxlength: 1000
  },
  suggestions: {
    type: String,
    maxlength: 1000
  },
  wouldRecommend: {
    type: Boolean,
    required: true
  },
  futureTopics: {
    type: String,
    maxlength: 500
  }
}, {
  timestamps: true
});

export default mongoose.model('Feedback', feedbackSchema);