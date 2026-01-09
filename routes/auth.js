import express from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { sendRegistrationEmail } from '../utils/email.js';
import { authenticateUser } from '../middleware/auth.js';

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
      console.error('Registration email error:', emailError?.message || emailError);
    }
  } catch (error) {
    console.error('Registration error:', error);
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

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const token = jwt.sign(
      { userId: user._id, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

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
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
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

    return res.json({ user });
  } catch (error) {
    console.error('Profile update error:', error);
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

    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    if (user.role !== 'PGS') {
      return res.status(400).json({ message: 'Recommendation letter is only required for PGS & Fellows' });
    }

    user.collegeLetter = req.file.path;
    user.isProfileComplete = isProfileComplete(user);
    await user.save();

    return res.json({ user });
  } catch (error) {
    console.error('College letter upload error:', error);
    return res.status(500).json({ message: 'Server error' });
  }
});


router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const admin = await Admin.findOne({ email: email.toLowerCase() });
    if (!admin) return res.status(400).json({ message: 'Invalid credentials' });

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      { adminId: admin._id, isAdmin: true },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

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
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
