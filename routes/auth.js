import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import { sendRegistrationEmail } from '../utils/email.js';

const router = express.Router();


const JWT_SECRET = "dndjjdhjdhjd"; 

router.post('/register', async (req, res) => {
  try {
    const {
      name, email, phone, password, role, 
      membershipId, collegeLetter,
      gender, country, state, city, address, pincode,
      instituteHospital, designation, medicalCouncilName, medicalCouncilNumber
    } = req.body;

    
    const requiredFields = [
      'name', 'email', 'phone', 'password', 'role', 'gender',
      'country', 'state', 'city', 'address', 'pincode',
      'instituteHospital', 'designation', 'medicalCouncilName'
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

    if (role === 'AOA' && !membershipId?.trim()) {
      return res.status(400).json({ message: 'Membership ID required for AOA' });
    }

    if (role === 'PGS' && !collegeLetter?.trim()) {
      return res.status(400).json({ message: 'College letter required for PGS' });
    }

    
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password, 
      role,
      gender,
      country: country.trim(),
      state: state.trim(),
      city: city.trim(),
      address: address.trim(),
      pincode: pincode.trim(),
      instituteHospital: instituteHospital.trim(),
      designation: designation.trim(),
      medicalCouncilName: medicalCouncilName.trim(),
      medicalCouncilNumber: medicalCouncilNumber?.trim() || '',
      membershipId: role === 'AOA' ? membershipId.trim() : undefined,
      collegeLetter: role === 'PGS' ? collegeLetter.trim() : undefined,
      isProfileComplete: true
    });

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
        isProfileComplete: true
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
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
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
