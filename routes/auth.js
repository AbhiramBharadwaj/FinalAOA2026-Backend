import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

const router = express.Router();




router.post('/register', async (req, res) => {
  try {
    const {
      name, email, phone, password, role, 
      membershipId, collegeLetter,
      // All required fields
      gender, country, state, city, address, pincode,
      instituteHospital, designation, medicalCouncilName, medicalCouncilNumber
    } = req.body;

    // Validate ALL required fields
    const requiredFields = {
      name, email, phone, password, role, gender, 
      country, state, city, address, pincode, instituteHospital, 
      designation, medicalCouncilName
    };

    const missingFields = Object.keys(requiredFields).find(
      key => !requiredFields[key] || requiredFields[key].toString().trim() === ''
    );

    if (missingFields) {
      return res.status(400).json({
        message: `Missing required field: ${missingFields}`
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { phone }] 
    });
    
    if (existingUser) {
      return res.status(400).json({ 
        message: `User already exists with this ${existingUser.email === email ? 'email' : 'phone number'}` 
      });
    }

    // Role-specific validation
    if (role === 'AOA' && !membershipId?.trim()) {
      return res.status(400).json({ 
        message: 'Membership ID is required for AOA members' 
      });
    }

    if (role === 'PGS' && !collegeLetter?.trim()) {
      return res.status(400).json({ 
        message: 'College letter is required for PGS users' 
      });
    }

    // Validate role enum
    const validRoles = ['AOA', 'NON_AOA', 'PGS'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ 
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}` 
      });
    }

    // Validate gender enum
    const validGenders = ['Male', 'Female', 'Other'];
    if (!validGenders.includes(gender)) {
      return res.status(400).json({ 
        message: `Invalid gender. Must be one of: ${validGenders.join(', ')}` 
      });
    }

    // Password strength validation
    if (password.length < 6) {
      return res.status(400).json({ 
        message: 'Password must be at least 6 characters long' 
      });
    }

    // Phone number validation (no country code required)
    const phoneRegex = /^[\d\s-()]{10,15}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({ 
        message: 'Please enter a valid phone number (10-15 digits)' 
      });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        message: 'Please enter a valid email address' 
      });
    }

    // Pincode validation
    const pincodeRegex = /^\d{4,10}$/;
    if (!pincodeRegex.test(pincode)) {
      return res.status(400).json({ 
        message: 'Please enter valid pincode/zip (4-10 digits)' 
      });
    }

    // Create new user with ALL fields
    const user = new User({
      name: name.trim(),
      gender,
      email: email.toLowerCase().trim(),
      phone: phone.trim(),
      password,
      role,
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
      isProfileComplete: true // Set to true since all fields are provided
    });

    await user.save();

    // Generate secure JWT token
    const token = jwt.sign(
      { 
        userId: user._id,
        role: user.role,
        email: user.email 
      },
      process.env.JWT_SECRET || "dndjjdhjdhjd",
      { expiresIn: '7d' }
    );

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        gender: user.gender,
        country: user.country,
        fullAddress: user.fullAddress,
        isVerified: user.isVerified,
        isProfileComplete: user.isProfileComplete
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle specific Mongoose validation errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ 
        message: `${field === 'email' ? 'Email' : 'Phone number'} already registered` 
      });
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({ 
        message: 'Validation failed', 
        errors 
      });
    }

    res.status(500).json({ 
      message: 'Server error during registration',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});




router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const isMatch = await user.comparePassword(password);
    console.log(password);
    
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const token = jwt.sign(
      { userId: user._id },
      "dndjjdhjdhjd",
      { expiresIn: '7d' }
    );

    res.json({
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
    res.status(500).json({ message: 'Server error during login' });
  }
});


router.post('/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    
    const token = jwt.sign(
      { adminId: admin._id, isAdmin: true },
      "dndjjdhjdhjd",
      { expiresIn: '7d' }
    );

    res.json({
      message: 'Admin login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ message: 'Server error during admin login' });
  }
});

export default router;
