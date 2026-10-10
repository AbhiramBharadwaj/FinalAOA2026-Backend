import express from 'express';
import multer from 'multer';
import path from 'path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import VideoSubmission from '../models/VideoSubmission.js';
import Registration from '../models/Registration.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';
import { sendVideoReviewEmail, sendVideoSubmittedEmail } from '../utils/email.js';

const router = express.Router();
const MAX_VIDEO_FILE_SIZE_BYTES = 500 * 1024 * 1024;
const SIGNED_UPLOAD_URL_EXPIRES_SECONDS = 15 * 60;

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
    fileSize: MAX_VIDEO_FILE_SIZE_BYTES,
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

const getR2StorageConfig = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_BUCKET_NAME;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

  if (!accessKeyId || !secretAccessKey || !bucketName || !publicBaseUrl || !endpoint) {
    throw new Error('Cloudflare R2 environment variables are not fully configured');
  }

  return {
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: endpoint.replace(/\/+$/, ''),
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ''),
  };
};

const createR2Client = () => {
  const { accessKeyId, secretAccessKey, endpoint } = getR2StorageConfig();
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

const getPublicR2Url = (objectKey) => {
  const { publicBaseUrl } = getR2StorageConfig();
  return `${publicBaseUrl}/${objectKey}`;
};

const buildR2ObjectKey = (req, file) => {
  const extension = path.extname(file.originalname || '').toLowerCase() || '.mp4';
  const safeUserId = req.user?._id?.toString?.() || 'unknown-user';
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `videos/${safeUserId}/${file.fieldname}-${uniqueSuffix}${extension}`;
};

const buildDirectUploadObjectKey = (req, fileName) => {
  const extension = path.extname(fileName || '').toLowerCase() || '.mp4';
  const safeUserId = req.user?._id?.toString?.() || 'unknown-user';
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  return `videos/${safeUserId}/direct-${uniqueSuffix}${extension}`;
};

const uploadToR2Storage = async ({ file, objectKey }) => {
  const { bucketName } = getR2StorageConfig();
  const client = createR2Client();

  await client.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
    Body: file.buffer,
    ContentType: file.mimetype || 'application/octet-stream',
  }));

  return getPublicR2Url(objectKey);
};

const validateVideoFileMetadata = ({ fileName, fileType, fileSize }) => {
  const extension = path.extname(fileName || '').toLowerCase();
  const normalizedFileType = String(fileType || '').trim().toLowerCase();
  const numericFileSize = Number(fileSize);

  if (!allowedMimeTypes.has(normalizedFileType) && !allowedExtensions.has(extension)) {
    return 'Only MP4, MOV, WEBM, M4V, MPEG, or AVI video files are allowed';
  }

  if (!Number.isFinite(numericFileSize) || numericFileSize <= 0) {
    return 'Video file size is required';
  }

  if (numericFileSize > MAX_VIDEO_FILE_SIZE_BYTES) {
    return 'Video file size must be less than 500MB';
  }

  return null;
};

const validateRequiredSubmissionFields = ({ title, presenterName, presenterDetails, description }) =>
  Boolean(title?.trim() && presenterName?.trim() && presenterDetails?.trim() && description?.trim());

const findBlockingSubmission = (userId) =>
  VideoSubmission.findOne({
    userId,
    status: { $in: ['PENDING', 'APPROVED'] },
  }).sort({ createdAt: -1 });

const findRejectedSubmission = (userId) =>
  VideoSubmission.findOne({
    userId,
    status: 'REJECTED',
  }).sort({ createdAt: -1 });

const assertUserCanSubmitVideo = async (userId) => {
  const blockingSubmission = await findBlockingSubmission(userId);
  if (blockingSubmission) {
    return 'You have already submitted a video';
  }
  return null;
};

const saveVideoSubmission = async ({
  userId,
  title,
  presenterName,
  presenterDetails,
  description,
  filePath,
}) => {
  const existingRejectedSubmission = await findRejectedSubmission(userId);

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
    existingRejectedSubmission.filePath = filePath;
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
        filePath,
        submittedAt: new Date(),
        finalStatus: 'PENDING',
        reviewComments: '',
      },
    ];
    submission = existingRejectedSubmission;
  } else {
    submission = new VideoSubmission({
      userId,
      title: title.trim(),
      presenterName: presenterName.trim(),
      presenterDetails: presenterDetails.trim(),
      description: description.trim(),
      filePath,
      submissionHistory: [
        {
          attemptNumber: 1,
          title: title.trim(),
          presenterName: presenterName.trim(),
          presenterDetails: presenterDetails.trim(),
          description: description.trim(),
          filePath,
          submittedAt: new Date(),
          finalStatus: 'PENDING',
          reviewComments: '',
        },
      ],
    });
  }

  await submission.save();
  await submission.populate('userId', 'name email');
  return submission;
};

const assertUploadedObjectExists = async ({ objectKey, fileType }) => {
  const { bucketName } = getR2StorageConfig();
  const client = createR2Client();
  const objectHead = await client.send(new HeadObjectCommand({
    Bucket: bucketName,
    Key: objectKey,
  }));

  if (objectHead.ContentLength > MAX_VIDEO_FILE_SIZE_BYTES) {
    return 'Video file size must be less than 500MB';
  }

  const uploadedContentType = String(objectHead.ContentType || fileType || '').toLowerCase();
  if (uploadedContentType && !allowedMimeTypes.has(uploadedContentType)) {
    return 'Uploaded file is not a supported video format';
  }

  return null;
};

const sendVideoSubmittedEmailSafely = async (submission) => {
  try {
    await sendVideoSubmittedEmail(submission);
  } catch (emailError) {
    logger.warn('video.submitted_email_failed', {
      submissionId: submission?._id,
      userId: submission?.userId?._id,
      message: emailError?.message || emailError,
    });
  }
};

const sendVideoReviewEmailSafely = async (submission) => {
  try {
    await sendVideoReviewEmail(submission);
  } catch (emailError) {
    logger.warn('video.review_email_failed', {
      submissionId: submission?._id,
      userId: submission?.userId?._id,
      status: submission?.status,
      message: emailError?.message || emailError,
    });
  }
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

    if (!validateRequiredSubmissionFields({ title, presenterName, presenterDetails, description })) {
      return res.status(400).json({ message: 'All submission fields are required' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'Video file is required' });
    }

    const blockingMessage = await assertUserCanSubmitVideo(req.user._id);
    if (blockingMessage) {
      return res.status(400).json({ message: blockingMessage });
    }

    const uploadedFileUrl = await uploadToR2Storage({
      file: req.file,
      objectKey: buildR2ObjectKey(req, req.file),
    });

    const submission = await saveVideoSubmission({
      userId: req.user._id,
      title,
      presenterName,
      presenterDetails,
      description,
      filePath: uploadedFileUrl,
    });

    await sendVideoSubmittedEmailSafely(submission);

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

router.post('/upload-url', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const { fileName, fileType, fileSize } = req.body;
    const validationMessage = validateVideoFileMetadata({ fileName, fileType, fileSize });
    if (validationMessage) {
      return res.status(400).json({ message: validationMessage });
    }

    const blockingMessage = await assertUserCanSubmitVideo(req.user._id);
    if (blockingMessage) {
      return res.status(400).json({ message: blockingMessage });
    }

    const { bucketName } = getR2StorageConfig();
    const objectKey = buildDirectUploadObjectKey(req, fileName);
    const contentType = String(fileType || 'application/octet-stream').trim().toLowerCase();
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(createR2Client(), command, {
      expiresIn: SIGNED_UPLOAD_URL_EXPIRES_SECONDS,
    });

    res.json({
      uploadUrl,
      method: 'PUT',
      objectKey,
      fileUrl: getPublicR2Url(objectKey),
      headers: {
        'Content-Type': contentType,
      },
      expiresIn: SIGNED_UPLOAD_URL_EXPIRES_SECONDS,
      maxFileSizeBytes: MAX_VIDEO_FILE_SIZE_BYTES,
    });
  } catch (error) {
    logger.error('video.direct_upload_url.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Video upload could not be prepared. Please try again.');
  }
});

router.post('/submit-direct', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const { title, presenterName, presenterDetails, description, objectKey, fileType } = req.body;

    if (!validateRequiredSubmissionFields({ title, presenterName, presenterDetails, description })) {
      return res.status(400).json({ message: 'All submission fields are required' });
    }

    const normalizedObjectKey = String(objectKey || '').trim();
    const userPrefix = `videos/${req.user._id}/`;
    if (!normalizedObjectKey.startsWith(userPrefix) || normalizedObjectKey.includes('..')) {
      return res.status(400).json({ message: 'Uploaded video reference is invalid' });
    }

    const extension = path.extname(normalizedObjectKey).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      return res.status(400).json({ message: 'Uploaded file is not a supported video format' });
    }

    const blockingMessage = await assertUserCanSubmitVideo(req.user._id);
    if (blockingMessage) {
      return res.status(400).json({ message: blockingMessage });
    }

    const uploadedObjectMessage = await assertUploadedObjectExists({
      objectKey: normalizedObjectKey,
      fileType,
    });
    if (uploadedObjectMessage) {
      return res.status(400).json({ message: uploadedObjectMessage });
    }

    const submission = await saveVideoSubmission({
      userId: req.user._id,
      title,
      presenterName,
      presenterDetails,
      description,
      filePath: getPublicR2Url(normalizedObjectKey),
    });

    await sendVideoSubmittedEmailSafely(submission);

    logger.info(`${req.actorName || 'User'} submitted an award video via direct upload.`);
    res.status(201).json({
      message: 'Video submitted successfully',
      submission,
    });
  } catch (error) {
    logger.error('video.direct_submit.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
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

    await sendVideoReviewEmailSafely(submission);

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
