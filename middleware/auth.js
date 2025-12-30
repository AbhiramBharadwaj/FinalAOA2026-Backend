import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Admin.js';

export const authenticateUser = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, "dndjjdhjdhjd");
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }
    console.log(user)
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Invalid token' });
  }
};

export const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, "dndjjdhjdhjd");
    console.log(decoded);
    
    if (decoded.isAdmin) {
      const admin = await Admin.findById(decoded.adminId).select('-password');
      
      if (!admin) {
        return res.status(401).json({ message: 'Admin not found' });
      }
      console.log("a = ", admin)
      
      req.admin = admin;
    } else {
      return res.status(403).json({ message: 'Admin access required' });
    }

    next();
  } catch (error) {
    console.log(error)
    res.status(401).json({ message: 'Invalid token' });
  }
};