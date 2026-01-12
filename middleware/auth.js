import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import logger from '../utils/logger.js';

const JWT_SECRET = "dndjjdhjdhjd";

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('auth.missing_token', { requestId: req.requestId, path: req.originalUrl });
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    
    if (decoded.userId) {
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        logger.warn('auth.user_not_found', { requestId: req.requestId, userId: decoded.userId });
        return res.status(401).json({ message: 'User not found' });
      }
      req.user = user;
      return next();
    }

    
    if (decoded.adminId && decoded.isAdmin) {
      const admin = await Admin.findById(decoded.adminId).select('-password');
      if (!admin) {
        logger.warn('auth.admin_not_found', { requestId: req.requestId, adminId: decoded.adminId });
        return res.status(401).json({ message: 'Admin not found' });
      }
      req.user = admin; 
      req.isAdmin = true;
      return next();
    }

    logger.warn('auth.invalid_token_structure', { requestId: req.requestId });
    return res.status(401).json({ message: 'Invalid token structure' });

  } catch (error) {
    logger.warn('auth.invalid_token', { requestId: req.requestId, message: error?.message || error });
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn('admin_auth.missing_token', { requestId: req.requestId, path: req.originalUrl });
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.isAdmin || !decoded.adminId) {
      logger.warn('admin_auth.forbidden', { requestId: req.requestId, adminId: decoded.adminId });
      return res.status(403).json({ message: 'Admin access required' });
    }

    const admin = await Admin.findById(decoded.adminId).select('-password');
    if (!admin) {
      logger.warn('admin_auth.admin_not_found', { requestId: req.requestId, adminId: decoded.adminId });
      return res.status(401).json({ message: 'Admin not found' });
    }

    req.admin = admin;
    next();
  } catch (error) {
    logger.warn('admin_auth.invalid_token', { requestId: req.requestId, message: error?.message || error });
    return res.status(401).json({ message: 'Invalid admin token' });
  }
};

export const requireProfileComplete = (req, res, next) => {
  if (req.isAdmin) {
    logger.warn('profile_complete.admin_forbidden', { requestId: req.requestId });
    return res.status(403).json({ message: 'Admins do not have a user profile' });
  }

  if (!req.user?.isProfileComplete) {
    logger.warn('profile_complete.required', { requestId: req.requestId, userId: req.user?._id });
    return res.status(403).json({ message: 'Please complete your profile before continuing' });
  }

  return next();
};
