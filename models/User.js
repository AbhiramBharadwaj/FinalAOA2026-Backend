import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  gender: {
    type: String,
    enum: ['Male', 'Female', 'Other'],
    required: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    unique: true, 
    trim: true,
    match: [/^[\d\s-()]{10,15}$/, 'Please enter valid phone number']
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['AOA', 'NON_AOA', 'PGS'],
    required: true
  },
  
  country: {
    type: String,
    required: true,
    default: 'India',
    trim: true
  },
  state: {
    type: String,
    required: true,
    trim: true
  },
  city: {
    type: String,
    required: true,
    trim: true
  },
  address: { 
    type: String,
    required: true,
    trim: true
  },
  pincode: { 
    type: String,
    required: true,
    trim: true,
    match: [/^\d{4,10}$/, 'Please enter valid pincode/zip (4-10 digits)']
  },
  
  instituteHospital: {
    type: String,
    required: true,
    trim: true
  },
  designation: {
    type: String,
    required: true,
    trim: true
  },
  medicalCouncilName: {
    type: String,
    required: true,
    trim: true
  },
  medicalCouncilNumber: {
    type: String,
    trim: true
  },
  
  membershipId: {
    type: String,
    sparse: true,
    unique: true
  },
  collegeLetter: {
    type: String 
  },
  
  isActive: {
    type: Boolean,
    default: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isProfileComplete: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});


userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});


userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};


userSchema.virtual('fullAddress').get(function() {
  return `${this.address}, ${this.city}, ${this.state}, ${this.pincode}, ${this.country}`;
});


userSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.password;
  }
});

export default mongoose.model('User', userSchema);