import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import Abstract from '../models/Abstract.js';
import Registration from '../models/Registration.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';
import { sendAbstractSubmittedEmail, sendAbstractReviewEmail } from '../utils/email.js';
import logger from '../utils/logger.js';
import { getPublicUploadPath, getUploadDirectory } from '../utils/uploadStorage.js';

const router = express.Router();


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const abstractUploadDir = getUploadDirectory('abstracts');
    fs.mkdirSync(abstractUploadDir, { recursive: true });
    cb(null, abstractUploadDir);
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
      if (req.file) {
        req.file.path = getPublicUploadPath('abstracts', req.file.filename);
      }
      console.log('[abstract.submit] Upload middleware completed', {
        userId: req.user?._id?.toString?.(),
        body: req.body,
        file: req.file
          ? {
              fieldname: req.file.fieldname,
              originalname: req.file.originalname,
              mimetype: req.file.mimetype,
              size: req.file.size,
              path: req.file.path,
            }
          : null,
      });
      return next();
    }

    console.error('[abstract.submit] Upload middleware failed', {
      userId: req.user?._id?.toString?.(),
      code: error.code,
      message: error.message,
      stack: error.stack,
    });

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

    console.log('[abstract.submit] Request entered handler', {
      userId: req.user?._id?.toString?.(),
      title,
      authors,
      category,
      hasFile: Boolean(req.file),
      filePath: req.file?.path,
    });

    if (!req.file) {
      console.warn('[abstract.submit] Missing abstract file', {
        userId: req.user?._id?.toString?.(),
      });
      return res.status(400).json({ message: 'PDF, DOC, or DOCX file is required' });
    }

    console.log('[abstract.submit] Checking for existing abstract', {
      userId: req.user?._id?.toString?.(),
    });

    const blockingAbstract = await Abstract.findOne({
      userId: req.user._id,
      status: { $in: ['PENDING', 'APPROVED'] },
    }).sort({ createdAt: -1 });

    if (blockingAbstract) {
      console.warn('[abstract.submit] Existing abstract found', {
        userId: req.user?._id?.toString?.(),
        abstractId: blockingAbstract._id?.toString?.(),
        submissionNumber: blockingAbstract.submissionNumber,
        status: blockingAbstract.status,
      });
      return res.status(400).json({ message: 'You have already submitted an abstract' });
    }

    const existingAbstract = await Abstract.findOne({
      userId: req.user._id,
      status: 'REJECTED',
    }).sort({ createdAt: -1 });

    let abstract;
    if (existingAbstract) {
      const existingHistory = [...(existingAbstract.submissionHistory || [])];

      // Backfill legacy data: if older records have no history yet, preserve
      // the previous reviewed submission as attempt #1 before overwriting.
      if (existingHistory.length === 0) {
        existingHistory.push({
          attemptNumber: 1,
          title: existingAbstract.title,
          authors: existingAbstract.authors,
          category: existingAbstract.category,
          filePath: existingAbstract.filePath,
          submittedAt: existingAbstract.createdAt || new Date(),
          finalStatus: existingAbstract.status || 'PENDING',
          reviewComments: existingAbstract.reviewComments || '',
          reviewedAt: existingAbstract.reviewedAt || null,
        });
      }

      const nextAttemptNumber = existingHistory.length + 1;
      const historyEntry = {
        attemptNumber: nextAttemptNumber,
        title,
        authors,
        category,
        filePath: req.file.path,
        submittedAt: new Date(),
        finalStatus: 'PENDING',
        reviewComments: '',
      };

      existingAbstract.title = title;
      existingAbstract.authors = authors;
      existingAbstract.category = category;
      existingAbstract.filePath = req.file.path;
      existingAbstract.status = 'PENDING';
      existingAbstract.reviewComments = '';
      existingAbstract.reviewedBy = null;
      existingAbstract.reviewedAt = null;
      existingAbstract.submissionHistory = [
        ...existingHistory,
        historyEntry,
      ];
      abstract = existingAbstract;
    } else {
      const historyEntry = {
        attemptNumber: 1,
        title,
        authors,
        category,
        filePath: req.file.path,
        submittedAt: new Date(),
        finalStatus: 'PENDING',
        reviewComments: '',
      };

      abstract = new Abstract({
        userId: req.user._id,
        title,
        authors,
        category,
        filePath: req.file.path,
        submissionHistory: [historyEntry],
      });
    }

    console.log('[abstract.submit] Abstract document prepared', {
      userId: req.user?._id?.toString?.(),
      title: abstract.title,
      authors: abstract.authors,
      category: abstract.category,
      filePath: abstract.filePath,
    });

    await abstract.save();
    console.log('[abstract.submit] Abstract saved', {
      abstractId: abstract._id?.toString?.(),
      submissionNumber: abstract.submissionNumber,
    });

    await abstract.populate('userId', 'name email');
    console.log('[abstract.submit] Abstract populated', {
      abstractId: abstract._id?.toString?.(),
      populatedUserId: abstract.userId?._id?.toString?.(),
      populatedEmail: abstract.userId?.email,
    });

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
    console.error('[abstract.submit] Submission failed', {
      name: error?.name,
      message: error?.message,
      stack: error?.stack,
      errors: error?.errors,
    });
    logger.error('Abstract submission failed.', {
      name: error?.name,
      message: error?.message || error,
      errors: error?.errors,
    });

    if (error?.name === 'ValidationError') {
      return res.status(400).json({
        message: error.message,
      });
    }

    res.status(500).json({ message: 'Server error during abstract submission' });
  }
});


router.get('/my-abstract', authenticateUser, async (req, res) => {
  try {
    logger.debug('abstract.fetch_self.start', { requestId: req.requestId, userId: req.user?._id });
    const abstract = await Abstract.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 })
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
      .sort({ createdAt: -1 })
      .lean();

    const userIds = abstracts
      .map((abstract) => abstract.userId?._id)
      .filter(Boolean);

    const registrations = await Registration.find(
      { userId: { $in: userIds } },
      'userId registrationNumber'
    ).lean();

    const registrationByUserId = new Map(
      registrations.map((registration) => [
        registration.userId.toString(),
        {
          _id: registration._id,
          registrationNumber: registration.registrationNumber,
        },
      ])
    );

    const abstractsWithRegistration = abstracts.map((abstract) => ({
      ...abstract,
      registration: abstract.userId?._id
        ? registrationByUserId.get(abstract.userId._id.toString()) || null
        : null,
    }));

    logger.debug('abstract.list.success', {
      requestId: req.requestId,
      count: abstractsWithRegistration.length,
    });
    res.json(abstractsWithRegistration);
  } catch (error) {
    logger.error('abstract.list.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});


router.put('/review/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, reviewComments } = req.body;
    const abstractId = req.params.id;

    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      return res.status(400).json({ message: 'Invalid abstract review status' });
    }

    logger.info(`${req.actorName || 'Admin'} reviewed an abstract with status ${status}.`);
    const abstract = await Abstract.findById(abstractId);

    if (!abstract) {
      return res.status(404).json({ message: 'Abstract not found' });
    }

    abstract.status = status;
    abstract.reviewComments = reviewComments;
    abstract.reviewedBy = req.admin._id;
    abstract.reviewedAt = new Date();

    if (Array.isArray(abstract.submissionHistory) && abstract.submissionHistory.length > 0) {
      const latestIndex = abstract.submissionHistory.length - 1;
      abstract.submissionHistory[latestIndex].finalStatus = status;
      abstract.submissionHistory[latestIndex].reviewComments = reviewComments || '';
      abstract.submissionHistory[latestIndex].reviewedAt = abstract.reviewedAt;
    }

    await abstract.save();
    await abstract.populate(['userId', 'reviewedBy']);

    logger.info(`${req.actorName || 'Admin'} saved the abstract review.`);
    res.json({
      message: 'Abstract reviewed successfully',
      abstract
    });

    try {
      await sendAbstractReviewEmail(abstract);
    } catch (emailError) {
      logger.warn('Abstract review email failed to send.', { message: emailError?.message || emailError });
    }
  } catch (error) {
    logger.error('Abstract review failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Server error during abstract review' });
  }
});

export default router;
