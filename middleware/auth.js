import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';
import logger from '../utils/logger.js';

const JWT_SECRET = "dndjjdhjdhjd";

export const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.warn('Unauthorized request. Missing token.');
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    
    if (decoded.userId) {
      const user = await User.findById(decoded.userId).select('-password');
      if (!user) {
        logger.warn('Unauthorized request. User not found.');
        return res.status(401).json({ message: 'User not found' });
      }
      req.user = user;
      req.actorName = user.name;
      return next();
    }

    
    if (decoded.adminId && decoded.isAdmin) {
      const admin = await Admin.findById(decoded.adminId).select('-password');
      if (!admin) {
        logger.warn('Unauthorized request. Admin not found.');
        return res.status(401).json({ message: 'Admin not found' });
      }
      req.user = admin; 
      req.isAdmin = true;
      req.actorName = admin.name;
      return next();
    }

    logger.warn('Unauthorized request. Invalid token.');
    return res.status(401).json({ message: 'Invalid token structure' });

  } catch (error) {
    logger.warn('Unauthorized request. Invalid or expired token.', { message: error?.message || error });
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
};

export const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      logger.warn('Unauthorized admin request. Missing token.');
      return res.status(401).json({ message: 'No token provided' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET);

    if (!decoded.isAdmin || !decoded.adminId) {
      logger.warn('Forbidden request. Admin access required.');
      return res.status(403).json({ message: 'Admin access required' });
    }

    const admin = await Admin.findById(decoded.adminId).select('-password');
    if (!admin) {
      logger.warn('Unauthorized admin request. Admin not found.');
      return res.status(401).json({ message: 'Admin not found' });
    }

    req.admin = admin;
    req.actorName = admin.name;
    next();
  } catch (error) {
    logger.warn('Unauthorized admin request. Invalid token.', { message: error?.message || error });
    return res.status(401).json({ message: 'Invalid admin token' });
  }
};

export const requireProfileComplete = (req, res, next) => {
  if (req.isAdmin) {
    logger.warn('Profile completion is not allowed for admins.');
    return res.status(403).json({ message: 'Admins do not have a user profile' });
  }

  if (!req.user?.isProfileComplete) {
    logger.warn(`${req.actorName || 'User'} needs to complete the profile.`);
    return res.status(403).json({ message: 'Please complete your profile before continuing' });
  }

  return next();
};
