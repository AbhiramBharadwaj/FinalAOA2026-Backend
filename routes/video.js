import express from 'express';
import multer from 'multer';
import path from 'path';
import VideoSubmission from '../models/VideoSubmission.js';
import Registration from '../models/Registration.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';

const router = express.Router();

const allowedMimeTypes = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
  'video/mpeg',
  'video/x-msvideo',
]);
const allowedExtensions = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mpeg', '.mpg', '.avi']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 500 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedMimeTypes.has(file.mimetype) || allowedExtensions.has(extension)) {
      cb(null, true);
    } else {
      cb(new Error('Only MP4, MOV, WEBM, M4V, MPEG, or AVI video files are allowed'), false);
    }
  },
});

const getBunnyStorageConfig = () => {
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const password = process.env.BUNNY_STORAGE_PASSWORD;
  const hostname = process.env.BUNNY_STORAGE_HOSTNAME;
  const publicBaseUrl = process.env.BUNNY_PUBLIC_BASE_URL;

  if (!zone || !password || !hostname || !publicBaseUrl) {
    throw new Error('Bunny storage environment variables are not fully configured');
  }

  return {
    zone,
    password,
    hostname: hostname.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
  };
};

const buildBunnyObjectKey = (req, file) => {
  const extension = path.extname(file.originalname || '').toLowerCase() || '.mp4';
  const safeUserId = req.user?._id?.toString?.() || 'unknown-user';
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `videos/${safeUserId}/${file.fieldname}-${uniqueSuffix}${extension}`;
};

const uploadToBunnyStorage = async ({ file, objectKey }) => {
  const { zone, password, hostname, publicBaseUrl } = getBunnyStorageConfig();
  const uploadUrl = `https://${hostname}/${zone}/${objectKey}`;

  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      AccessKey: password,
      'Content-Type': file.mimetype || 'application/octet-stream',
    },
    body: file.buffer,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Bunny upload failed with ${response.status}: ${errorText}`);
  }

  return `${publicBaseUrl}/${objectKey}`;
};

const handleVideoUpload = (req, res, next) => {
  upload.single('videoFile')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'Video file size must be less than 500MB' });
    }

    return res.status(400).json({ message: error.message || 'Invalid video file upload' });
  });
};

router.post('/submit', authenticateUser, requireProfileComplete, handleVideoUpload, async (req, res) => {
  try {
    const { title, presenterName, presenterDetails, description } = req.body;

    if (!title?.trim() || !presenterName?.trim() || !presenterDetails?.trim() || !description?.trim()) {
      return res.status(400).json({ message: 'All submission fields are required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Video file is required' });
    }

    const uploadedFileUrl = await uploadToBunnyStorage({
      file: req.file,
      objectKey: buildBunnyObjectKey(req, req.file),
    });

    const blockingSubmission = await VideoSubmission.findOne({
      userId: req.user._id,
      status: { $in: ['PENDING', 'APPROVED'] },
    }).sort({ createdAt: -1 });

    if (blockingSubmission) {
      return res.status(400).json({ message: 'You have already submitted a video' });
    }

    const existingRejectedSubmission = await VideoSubmission.findOne({
      userId: req.user._id,
      status: 'REJECTED',
    }).sort({ createdAt: -1 });

    let submission;
    if (existingRejectedSubmission) {
      const existingHistory = [...(existingRejectedSubmission.submissionHistory || [])];

      if (existingHistory.length === 0) {
        existingHistory.push({
          attemptNumber: 1,
          title: existingRejectedSubmission.title,
          presenterName: existingRejectedSubmission.presenterName,
          presenterDetails: existingRejectedSubmission.presenterDetails,
          description: existingRejectedSubmission.description,
          filePath: existingRejectedSubmission.filePath,
          submittedAt: existingRejectedSubmission.createdAt || new Date(),
          finalStatus: existingRejectedSubmission.status || 'PENDING',
          reviewComments: existingRejectedSubmission.reviewComments || '',
          reviewedAt: existingRejectedSubmission.reviewedAt || null,
        });
      }

      const nextAttemptNumber = existingHistory.length + 1;
      existingRejectedSubmission.title = title.trim();
      existingRejectedSubmission.presenterName = presenterName.trim();
      existingRejectedSubmission.presenterDetails = presenterDetails.trim();
      existingRejectedSubmission.description = description.trim();
      existingRejectedSubmission.filePath = uploadedFileUrl;
      existingRejectedSubmission.status = 'PENDING';
      existingRejectedSubmission.reviewComments = '';
      existingRejectedSubmission.reviewedBy = null;
      existingRejectedSubmission.reviewedAt = null;
      existingRejectedSubmission.submissionHistory = [
        ...existingHistory,
        {
          attemptNumber: nextAttemptNumber,
          title: title.trim(),
          presenterName: presenterName.trim(),
          presenterDetails: presenterDetails.trim(),
          description: description.trim(),
          filePath: uploadedFileUrl,
          submittedAt: new Date(),
          finalStatus: 'PENDING',
          reviewComments: '',
        },
      ];
      submission = existingRejectedSubmission;
    } else {
      submission = new VideoSubmission({
        userId: req.user._id,
        title: title.trim(),
        presenterName: presenterName.trim(),
        presenterDetails: presenterDetails.trim(),
        description: description.trim(),
        filePath: uploadedFileUrl,
        submissionHistory: [
          {
            attemptNumber: 1,
            title: title.trim(),
            presenterName: presenterName.trim(),
            presenterDetails: presenterDetails.trim(),
            description: description.trim(),
            filePath: uploadedFileUrl,
            submittedAt: new Date(),
            finalStatus: 'PENDING',
            reviewComments: '',
          },
        ],
      });
    }

    await submission.save();
    await submission.populate('userId', 'name email');

    logger.info(`${req.actorName || 'User'} submitted an award video.`);
    res.status(201).json({
      message: 'Video submitted successfully',
      submission,
    });
  } catch (error) {
    logger.error('Video submission failed.', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Video could not be submitted. Please try again.');
  }
});

router.get('/my-video', authenticateUser, async (req, res) => {
  try {
    const submission = await VideoSubmission.findOne({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('userId', 'name email')
      .populate('reviewedBy', 'name');

    if (!submission) {
      return res.status(404).json({ message: 'No video submission found' });
    }

    res.json(submission);
  } catch (error) {
    logger.error('video.fetch_self.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Video submission details could not be loaded. Please try again.');
  }
});

router.get('/all', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};

    const submissions = await VideoSubmission.find(filter)
      .populate('userId', 'name email role')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const userIds = submissions
      .map((submission) => submission.userId?._id)
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

    const submissionsWithRegistration = submissions.map((submission) => ({
      ...submission,
      registration: submission.userId?._id
        ? registrationByUserId.get(submission.userId._id.toString()) || null
        : null,
    }));

    res.json(submissionsWithRegistration);
  } catch (error) {
    logger.error('video.list.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Video submissions could not be loaded. Please try again.');
  }
});

router.put('/review/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, reviewComments } = req.body;
    const submission = await VideoSubmission.findById(req.params.id);

    if (!submission) {
      return res.status(404).json({ message: 'Video submission not found' });
    }

    submission.status = status;
    submission.reviewComments = reviewComments;
    submission.reviewedBy = req.admin._id;
    submission.reviewedAt = new Date();

    if (Array.isArray(submission.submissionHistory) && submission.submissionHistory.length > 0) {
      const latestIndex = submission.submissionHistory.length - 1;
      submission.submissionHistory[latestIndex].finalStatus = status;
      submission.submissionHistory[latestIndex].reviewComments = reviewComments || '';
      submission.submissionHistory[latestIndex].reviewedAt = submission.reviewedAt;
    }

    await submission.save();
    await submission.populate(['userId', 'reviewedBy']);

    logger.info(`${req.actorName || 'Admin'} reviewed a video submission with status ${status}.`);
    res.json({
      message: 'Video submission reviewed successfully',
      submission,
    });
  } catch (error) {
    logger.error('Video review failed.', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Video review could not be saved. Please try again.');
  }
});

export default router;
