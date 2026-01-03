import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

const JWT_SECRET = "dndjjdhjdhjd";

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    
    if (decoded.userId) {
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) return res.status(401).json({ message: 'User not found' });
      req.user = user;
      return next();
    }

    
    if (decoded.adminId && decoded.isAdmin) {
      const admin = await Admin.findById(decoded.adminId).select('-password');
      if (!admin) return res.status(401).json({ message: 'Admin not found' });
      req.user = admin; 
      req.isAdmin = true;
      return next();
    }

    return res.status(401).json({ message: 'Invalid token structure' });

  } catch (error) {
    console.error('Auth error:', error.message);
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.isAdmin || !decoded.adminId) {
      return res.status(403).json({ message: 'Admin access required' });
    }

    const admin = await Admin.findById(decoded.adminId).select('-password');
    if (!admin) return res.status(401).json({ message: 'Admin not found' });

    req.admin = admin;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid admin token' });
  }
};

export const requireProfileComplete = (req, res, next) => {
  if (req.isAdmin) {
    return res.status(403).json({ message: 'Admins do not have a user profile' });
  }

  if (!req.user?.isProfileComplete) {
    return res.status(403).json({ message: 'Please complete your profile before continuing' });
  }

  return next();
};
