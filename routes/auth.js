import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { sendPasswordResetEmail, sendRegistrationEmail } from '../utils/email.js';
import { authenticateUser } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();


const JWT_SECRET = "dndjjdhjdhjd"; 

const profileFields = [
  'gender',
  'mealPreference',
  'country',
  'state',
  'city',
  'address',
  'pincode',
  'instituteHospital',
  'designation',
  'medicalCouncilName',
  'medicalCouncilNumber'
];

const hasValue = (value) => {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : value);
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

const createResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return {
    rawToken,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS)
  };
};

const getFrontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:5173';

const collegeLetterDir = 'uploads/college-letters';
const collegeLetterStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(collegeLetterDir, { recursive: true });
    cb(null, collegeLetterDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, `college-letter-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});
const collegeLetterUpload = multer({
  storage: collegeLetterStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  },
});

const isProfileComplete = (userData) => {
  for (const field of profileFields) {
    if (!hasValue(userData[field])) return false;
  }
  if (userData.role === 'AOA' && !hasValue(userData.membershipId)) return false;
  if (userData.role === 'PGS' && !hasValue(userData.collegeLetter)) return false;
  return true;
};

router.post('/register', async (req, res) => {
  try {
    const {
      name, email, phone, password, role, 
      membershipId, collegeLetter,
      gender, mealPreference, country, state, city, address, pincode,
      instituteHospital, designation, medicalCouncilName, medicalCouncilNumber
    } = req.body;

    logger.info(`${name || 'User'} is registering an account.`);

    
    const requiredFields = [
      'name', 'email', 'phone', 'password', 'role'
    ];

    for (const field of requiredFields) {
      if (!req.body[field] || req.body[field].toString().trim() === '') {
        return res.status(400).json({ message: `Missing required field: ${field}` });
      }
    }

    
    const existingUser = await User.findOne({ 
      $or: [{ email: email.toLowerCase() }, { phone }] 
    });

    if (existingUser) {
      return res.status(400).json({ 
        message: 'User already exists with this email or phone' 
      });
    }

    
    if (!['AOA', 'NON_AOA', 'PGS'].includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    
    const userData = {
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      role
    };

    if (hasValue(gender)) userData.gender = normalizeString(gender);
    if (hasValue(mealPreference)) userData.mealPreference = normalizeString(mealPreference);
    if (hasValue(country)) userData.country = normalizeString(country);
    if (hasValue(state)) userData.state = normalizeString(state);
    if (hasValue(city)) userData.city = normalizeString(city);
    if (hasValue(address)) userData.address = normalizeString(address);
    if (hasValue(pincode)) userData.pincode = normalizeString(pincode);
    if (hasValue(instituteHospital)) userData.instituteHospital = normalizeString(instituteHospital);
    if (hasValue(designation)) userData.designation = normalizeString(designation);
    if (hasValue(medicalCouncilName)) userData.medicalCouncilName = normalizeString(medicalCouncilName);
    if (hasValue(medicalCouncilNumber)) userData.medicalCouncilNumber = normalizeString(medicalCouncilNumber);
    if (role === 'AOA' && hasValue(membershipId)) userData.membershipId = normalizeString(membershipId);
    if (role === 'PGS' && hasValue(collegeLetter)) userData.collegeLetter = normalizeString(collegeLetter);
    userData.isProfileComplete = isProfileComplete(userData);

    const user = new User(userData);

    await user.save();

    logger.info(`${user.name} registered an account.`);

    
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'Registration successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete
      }
    });

    try {
      await sendRegistrationEmail(user);
    } catch (emailError) {
      logger.warn(`Registration email failed for ${user.email}.`, {
        message: emailError?.message || emailError,
      });
    }
  } catch (error) {
    logger.error('Registration failed.', { message: error?.message || error });
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email or phone already registered' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});


router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' });
    }

    logger.info(`Login attempt for ${email?.toLowerCase()}.`);

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      logger.warn(`Login failed for ${email?.toLowerCase()}. Invalid credentials.`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      logger.warn(`Login failed for ${email?.toLowerCase()}. Invalid credentials.`);
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.info(`${user.name} logged in successfully.`);

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        isProfileComplete: user.isProfileComplete
      }
    });

  } catch (error) {
    logger.error('Login failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/forgot-password', async (req, res) => {
  try {
    const email = normalizeString(req.body.email)?.toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    logger.info(`Password reset requested for ${email}.`);

    const user = await User.findOne({ email });
    if (!user) {
      logger.info(`Password reset request for ${email} but account was not found.`);
      return res.json({ message: 'If this email is registered, a reset link was sent.' });
    }

    const { rawToken, tokenHash, expiresAt } = createResetToken();
    user.resetPasswordToken = tokenHash;
    user.resetPasswordExpires = expiresAt;
    await user.save();

    const resetLink = `${getFrontendUrl()}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
    try {
      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetLink,
        isAdmin: false
      });
      user.resetEmailSentAt = new Date();
      user.resetEmailFailedAt = undefined;
      user.resetEmailError = undefined;
      await user.save();
    } catch (emailError) {
      user.resetEmailFailedAt = new Date();
      user.resetEmailError = emailError?.message || String(emailError);
      await user.save();
      logger.warn(`Password reset email failed for ${user.email}.`, {
        message: emailError?.message || emailError,
      });
    }

    return res.json({ message: 'If this email is registered, a reset link was sent.' });
  } catch (error) {
    logger.error('Password reset request failed.', { message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const email = normalizeString(req.body.email)?.toLowerCase();
    const { token, password } = req.body;

    if (!email || !token || !password) {
      return res.status(400).json({ message: 'Email, token, and password are required' });
    }

    logger.info(`Password reset started for ${email}.`);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      email,
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    user.password = password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    logger.info(`${user.name} updated the password successfully.`);

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Password reset failed.', { message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});

router.get('/me', authenticateUser, async (req, res) => {
  if (req.isAdmin) {
    return res.status(403).json({ message: 'Admins do not have a user profile' });
  }

  return res.json({ user: req.user });
});

router.put('/profile', authenticateUser, async (req, res) => {
  try {
    if (req.isAdmin) {
      return res.status(403).json({ message: 'Admins cannot update user profiles' });
    }

    logger.info(`${req.actorName || 'User'} is updating the profile.`);

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const requestedEmail = Object.prototype.hasOwnProperty.call(req.body, 'email')
      ? normalizeString(req.body.email)
      : undefined;
    const requestedPhone = Object.prototype.hasOwnProperty.call(req.body, 'phone')
      ? normalizeString(req.body.phone)
      : undefined;

    if (requestedEmail && requestedEmail.toLowerCase().trim() !== user.email) {
      return res.status(400).json({ message: 'Email cannot be changed after registration' });
    }

    if (requestedPhone && requestedPhone.trim() !== user.phone) {
      return res.status(400).json({ message: 'Phone cannot be changed after registration' });
    }

    const updates = {};
    const updatableFields = [
      'name',
      'gender',
      'mealPreference',
      'country',
      'state',
      'city',
      'address',
      'pincode',
      'instituteHospital',
      'designation',
      'medicalCouncilName',
      'medicalCouncilNumber',
      'membershipId'
    ];

    for (const field of updatableFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        updates[field] = normalizeString(req.body[field]);
        if (updates[field] === '') updates[field] = undefined;
      }
    }

    if (updates.membershipId && user.role !== 'AOA') {
      updates.membershipId = undefined;
    }

    const nextUser = { ...user.toObject(), ...updates };
    if (!isProfileComplete(nextUser)) {
      return res.status(400).json({ message: 'Please complete all required profile fields before continuing' });
    }

    Object.assign(user, updates);
    user.isProfileComplete = isProfileComplete(user);

    await user.save();

    logger.info(`${user.name} saved the profile.`);

    return res.json({ user });
  } catch (error) {
    logger.error('Profile update failed.', { message: error?.message || error });
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Duplicate value not allowed' });
    }
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/profile/college-letter', authenticateUser, collegeLetterUpload.single('collegeLetter'), async (req, res) => {
  try {
    if (req.isAdmin) {
      return res.status(403).json({ message: 'Admins cannot update user profiles' });
    }

    logger.info(`${req.actorName || 'User'} is uploading a college letter.`);

    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role !== 'PGS') {
      return res.status(400).json({ message: 'Recommendation letter is only required for PGS & Fellows' });
    }

    user.collegeLetter = req.file.path;
    user.collegeLetterStatus = 'PENDING';
    user.collegeLetterReviewedAt = undefined;
    user.collegeLetterReviewedBy = undefined;
    user.isProfileComplete = isProfileComplete(user);
    await user.save();

    logger.info(`${user.name} uploaded the college letter successfully.`);

    return res.json({ user });
  } catch (error) {
    logger.error('College letter upload failed.', { message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});


router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    logger.info(`Admin login attempt for ${email?.toLowerCase()}.`);

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin._id, isAdmin: true },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    logger.info(`${admin.name} logged in as admin.`);

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email
      }
    });
  } catch (error) {
    logger.error('Admin login failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/admin/forgot-password', async (req, res) => {
  try {
    const email = normalizeString(req.body.email)?.toLowerCase();
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    logger.info(`Admin password reset requested for ${email}.`);

    const admin = await Admin.findOne({ email });
    if (!admin) {
      logger.info(`Admin password reset request for ${email} but account was not found.`);
      return res.json({ message: 'If this email is registered, a reset link was sent.' });
    }

    const { rawToken, tokenHash, expiresAt } = createResetToken();
    admin.resetPasswordToken = tokenHash;
    admin.resetPasswordExpires = expiresAt;
    await admin.save();

    const resetLink = `${getFrontendUrl()}/admin/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
    try {
      await sendPasswordResetEmail({
        email: admin.email,
        name: admin.name,
        resetLink,
        isAdmin: true
      });
      admin.resetEmailSentAt = new Date();
      admin.resetEmailFailedAt = undefined;
      admin.resetEmailError = undefined;
      await admin.save();
    } catch (emailError) {
      admin.resetEmailFailedAt = new Date();
      admin.resetEmailError = emailError?.message || String(emailError);
      await admin.save();
      logger.warn(`Admin password reset email failed for ${admin.email}.`, {
        message: emailError?.message || emailError,
      });
    }

    return res.json({ message: 'If this email is registered, a reset link was sent.' });
  } catch (error) {
    logger.error('Admin password reset failed.', { message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});

router.post('/admin/reset-password', async (req, res) => {
  try {
    const email = normalizeString(req.body.email)?.toLowerCase();
    const { token, password } = req.body;

    if (!email || !token || !password) {
      return res.status(400).json({ message: 'Email, token, and password are required' });
    }

    logger.info(`Admin password reset started for ${email}.`);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const admin = await Admin.findOne({
      email,
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    });

    if (!admin) {
      return res.status(400).json({ message: 'Invalid or expired reset link' });
    }

    admin.password = password;
    admin.resetPasswordToken = undefined;
    admin.resetPasswordExpires = undefined;
    await admin.save();

    logger.info(`${admin.name} updated the admin password successfully.`);

    return res.json({ message: 'Password updated successfully' });
  } catch (error) {
    logger.error('Admin password reset failed.', { message: error?.message || error });
    return res.status(500).json({ message: 'Server error' });
  }
});

export default router;
