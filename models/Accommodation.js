import mongoose from 'mongoose';

const accommodationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  images: [{
    type: String
  }],
  pricePerNight: {
    type: Number,
    required: true
  },
  totalRooms: {
    type: Number,
    required: true
  },
  availableRooms: {
    type: Number,
    required: true
  },
  amenities: [{
    type: String
  }],
  inclusions: [{
    type: String
  }],
  exclusions: [{
    type: String
  }],
  faqs: [{
    question: String,
    answer: String
  }],
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 4
  },
  location: {
    type: String,
    required: true
  },
  checkInTime: {
    type: String,
    default: '14:00'
  },
  checkOutTime: {
    type: String,
    default: '12:00'
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

export default mongoose.model('Accommodation', accommodationSchema);