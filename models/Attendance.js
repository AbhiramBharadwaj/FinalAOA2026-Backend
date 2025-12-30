import mongoose from 'mongoose';

const attendanceSchema = new mongoose.Schema(
  {
    registrationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Registration',
      required: true,
      unique: true,
    },
    qrCodeData: {
      type: String, 
      required: true,
      unique: true,
    },
    scanHistory: [{
      scannedAt: { type: Date, default: Date.now },
      scannedBy: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Admin',
        required: true 
      },
      location: { type: String, default: 'Main Gate' },
      notes: String,
      count: { type: Number, default: 1 },
    }],
    totalScans: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model('Attendance', attendanceSchema);
