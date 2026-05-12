import express from 'express';
import multer from 'multer';
import path from 'path';
import Abstract from '../models/Abstract.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';
import { sendAbstractSubmittedEmail, sendAbstractReviewEmail } from '../utils/email.js';
import logger from '../utils/logger.js';

const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/abstracts/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = new Set([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]);

    if (allowedMimeTypes.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, or DOCX files are allowed'), false);
    }
  }
});

const handleAbstractUpload = (req, res, next) => {
  upload.single('abstractFile')(req, res, (error) => {
    if (!error) {
      return next();
    }

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Abstract file size must be less than 10MB' });
    }

    return res.status(400).json({ message: error.message || 'Invalid abstract file upload' });
  });
};

router.post('/submit', authenticateUser, requireProfileComplete, handleAbstractUpload, async (req, res) => {
  try {
    logger.info(`${req.actorName || 'User'} is submitting an abstract.`);
    const { title, authors, category } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'PDF, DOC, or DOCX file is required' });
    }

    
    const existingAbstract = await Abstract.findOne({ userId: req.user._id });
    if (existingAbstract) {
      return res.status(400).json({ message: 'You have already submitted an abstract' });
    }

    const abstract = new Abstract({
      userId: req.user._id,
      title,
      authors,
      category,
      filePath: req.file.path
    });

    await abstract.save();

    await abstract.populate('userId', 'name email');

    logger.info(`${req.actorName || 'User'} submitted an abstract.`);
    res.status(201).json({
      message: 'Abstract submitted successfully',
      abstract
    });

    try {
      await sendAbstractSubmittedEmail(abstract);
    } catch (emailError) {
      logger.warn('Abstract email failed to send.', { message: emailError?.message || emailError });
    }
  } catch (error) {
    logger.error('Abstract submission failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Server error during abstract submission' });
  }
});


router.get('/my-abstract', authenticateUser, async (req, res) => {
  try {
    logger.debug('abstract.fetch_self.start', { requestId: req.requestId, userId: req.user?._id });
    const abstract = await Abstract.findOne({ userId: req.user._id })
      .populate('userId', 'name email')
      .populate('reviewedBy', 'name');

    if (!abstract) {
      return res.status(404).json({ message: 'No abstract found' });
    }

    logger.debug('abstract.fetch_self.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      abstractId: abstract._id,
    });
    res.json(abstract);
  } catch (error) {
    logger.error('abstract.fetch_self.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/all', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    
    logger.debug('abstract.list.start', { requestId: req.requestId, status: status || 'ALL' });
    const abstracts = await Abstract.find(filter)
      .populate('userId', 'name email role')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    logger.debug('abstract.list.success', { requestId: req.requestId, count: abstracts.length });
    res.json(abstracts);
  } catch (error) {
    logger.error('abstract.list.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});


router.put('/review/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, reviewComments } = req.body;
    const abstractId = req.params.id;

    logger.info(`${req.actorName || 'Admin'} reviewed an abstract with status ${status}.`);
    const abstract = await Abstract.findByIdAndUpdate(
      abstractId,
      {
        status,
        reviewComments,
        reviewedBy: req.admin._id,
        reviewedAt: new Date()
      },
      { new: true }
    ).populate(['userId', 'reviewedBy']);

    if (!abstract) {
      return res.status(404).json({ message: 'Abstract not found' });
    }

    logger.info(`${req.actorName || 'Admin'} saved the abstract review.`);
    res.json({
      message: 'Abstract reviewed successfully',
      abstract
    });

    try {
      if (abstract.status === 'APPROVED' || abstract.status === 'REJECTED') {
        await sendAbstractReviewEmail(abstract);
      }
    } catch (emailError) {
      logger.warn('Abstract review email failed to send.', { message: emailError?.message || emailError });
    }
  } catch (error) {
    logger.error('Abstract review failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Server error during abstract review' });
  }
});

export default router;
