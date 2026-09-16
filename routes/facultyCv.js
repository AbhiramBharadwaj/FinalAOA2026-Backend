import crypto from 'crypto';
import express from 'express';
import multer from 'multer';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import FacultyCv from '../models/FacultyCv.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { facultyCvOtpLimiter } from '../middleware/rateLimits.js';
import { sendFacultyCvOtpEmail } from '../utils/email.js';
import { sendErrorResponse } from '../utils/httpError.js';
import logger from '../utils/logger.js';

const router = express.Router();

const MAX_CV_SIZE = 25 * 1024 * 1024;
const OTP_TTL_MS = 10 * 60 * 1000;
const UPLOAD_TOKEN_TTL_MS = 30 * 60 * 1000;
const allowedExtensions = new Set(['.pdf', '.doc', '.docx', '.ppt', '.pptx']);
const allowedMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_CV_SIZE,
  },
  fileFilter: (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (allowedMimeTypes.has(file.mimetype) || allowedExtensions.has(extension)) {
      cb(null, true);
    } else {
      cb(new Error('Only PDF, DOC, DOCX, PPT, or PPTX files are allowed'), false);
    }
  },
});

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const generateOtp = () => String(crypto.randomInt(100000, 1000000));
const generateUploadToken = () => crypto.randomBytes(32).toString('hex');

const sanitizeFileName = (fileName) =>
  String(fileName || 'faculty-cv')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120) || 'faculty-cv';

const getR2StorageConfig = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucketName = process.env.R2_PRIVATE_BUCKET_NAME || process.env.R2_BUCKET_NAME;
  const endpoint = process.env.R2_ENDPOINT || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

  if (!accessKeyId || !secretAccessKey || !bucketName || !endpoint) {
    throw new Error('Cloudflare R2 environment variables are not fully configured');
  }

  return {
    accessKeyId,
    secretAccessKey,
    bucketName,
    endpoint: endpoint.replace(/\/+$/, ''),
  };
};

const getR2Client = () => {
  const { accessKeyId, secretAccessKey, endpoint } = getR2StorageConfig();
  return new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

const buildFacultyCvKey = (faculty, file) => {
  const extension = path.extname(file.originalname || '').toLowerCase() || '.pdf';
  const emailPart = faculty.email.replace(/[^a-z0-9._-]+/g, '-');
  const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const baseName = sanitizeFileName(path.basename(file.originalname || 'faculty-cv', extension));
  return `faculty-cvs/${emailPart}/${uniqueSuffix}-${baseName}${extension}`;
};

const handleCvUpload = (req, res, next) => {
  upload.single('cvFile')(req, res, (error) => {
    if (!error) return next();

    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ message: 'CV file size must be less than 25MB' });
    }

    return res.status(400).json({ message: error.message || 'Invalid CV file upload' });
  });
};

router.post('/request-otp', facultyCvOtpLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const faculty = await FacultyCv.findOne({ email, isActive: true });
    if (!faculty) {
      return res.status(404).json({ message: 'This email is not listed for faculty CV upload' });
    }

    const otp = generateOtp();
    faculty.lastOtpHash = hashValue(otp);
    faculty.lastOtpExpiresAt = new Date(Date.now() + OTP_TTL_MS);
    faculty.lastOtpSentAt = new Date();
    faculty.uploadTokenHash = undefined;
    faculty.uploadTokenExpiresAt = undefined;
    await faculty.save();

    await sendFacultyCvOtpEmail({ email: faculty.email, name: faculty.name, otp });

    logger.info(`Faculty CV OTP sent to ${faculty.email}.`);
    return res.json({
      message: 'OTP sent to your faculty email',
      faculty: {
        name: faculty.name,
        email: faculty.email,
        role: faculty.role,
      },
    });
  } catch (error) {
    logger.error('faculty_cv.otp_request.error', { message: error?.message || error });
    return sendErrorResponse(res, error, 'OTP could not be sent. Please try again.');
  }
});

router.post('/verify-otp', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const otp = String(req.body.otp || '').trim();
    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const faculty = await FacultyCv.findOne({ email, isActive: true });
    if (!faculty || !faculty.lastOtpHash || !faculty.lastOtpExpiresAt) {
      return res.status(400).json({ message: 'Please request a new OTP' });
    }

    if (faculty.lastOtpExpiresAt.getTime() < Date.now() || faculty.lastOtpHash !== hashValue(otp)) {
      return res.status(400).json({ message: 'Invalid or expired OTP' });
    }

    const uploadToken = generateUploadToken();
    faculty.uploadTokenHash = hashValue(uploadToken);
    faculty.uploadTokenExpiresAt = new Date(Date.now() + UPLOAD_TOKEN_TTL_MS);
    faculty.lastOtpHash = undefined;
    faculty.lastOtpExpiresAt = undefined;
    await faculty.save();

    return res.json({
      message: 'OTP verified',
      uploadToken,
      faculty: {
        name: faculty.name,
        email: faculty.email,
        role: faculty.role,
        cvStatus: faculty.cvStatus,
        cvUploadedAt: faculty.cvUploadedAt,
      },
    });
  } catch (error) {
    logger.error('faculty_cv.otp_verify.error', { message: error?.message || error });
    return sendErrorResponse(res, error, 'OTP could not be verified. Please try again.');
  }
});

router.post('/upload', handleCvUpload, async (req, res) => {
  try {
    const uploadToken = String(req.body.uploadToken || '').trim();
    if (!uploadToken) {
      return res.status(400).json({ message: 'Upload token is required' });
    }
    if (!req.file) {
      return res.status(400).json({ message: 'CV file is required' });
    }

    const faculty = await FacultyCv.findOne({
      uploadTokenHash: hashValue(uploadToken),
      uploadTokenExpiresAt: { $gt: new Date() },
      isActive: true,
    });

    if (!faculty) {
      return res.status(400).json({ message: 'Upload session expired. Please verify OTP again.' });
    }

    const { bucketName } = getR2StorageConfig();
    const objectKey = buildFacultyCvKey(faculty, req.file);
    const client = getR2Client();
    await client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      Body: req.file.buffer,
      ContentType: req.file.mimetype || 'application/octet-stream',
    }));

    faculty.cvStatus = 'UPLOADED';
    faculty.cvFileName = sanitizeFileName(req.file.originalname);
    faculty.cvContentType = req.file.mimetype || 'application/octet-stream';
    faculty.cvSize = req.file.size;
    faculty.cvR2Key = objectKey;
    faculty.cvUploadedAt = new Date();
    faculty.uploadTokenHash = undefined;
    faculty.uploadTokenExpiresAt = undefined;
    await faculty.save();

    logger.info(`Faculty CV uploaded for ${faculty.email}.`);
    return res.status(201).json({
      message: 'CV uploaded successfully',
      faculty: {
        name: faculty.name,
        email: faculty.email,
        role: faculty.role,
        cvStatus: faculty.cvStatus,
        cvFileName: faculty.cvFileName,
        cvUploadedAt: faculty.cvUploadedAt,
      },
    });
  } catch (error) {
    logger.error('faculty_cv.upload.error', { message: error?.message || error });
    return sendErrorResponse(res, error, 'CV could not be uploaded. Please try again.');
  }
});

router.get('/admin/all', authenticateAdmin, async (req, res) => {
  try {
    const faculty = await FacultyCv.find({})
      .sort({ name: 1, email: 1 })
      .lean();

    return res.json(faculty.map((item) => ({
      _id: item._id,
      name: item.name,
      email: item.email,
      role: item.role,
      sourceSheetRow: item.sourceSheetRow,
      isActive: item.isActive,
      cvStatus: item.cvStatus,
      cvFileName: item.cvFileName,
      cvSize: item.cvSize,
      cvUploadedAt: item.cvUploadedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })));
  } catch (error) {
    logger.error('faculty_cv.admin_list.error', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Faculty CV records could not be loaded. Please try again.');
  }
});

router.get('/admin/download/:id', authenticateAdmin, async (req, res) => {
  try {
    const faculty = await FacultyCv.findById(req.params.id);
    if (!faculty || !faculty.cvR2Key) {
      return res.status(404).json({ message: 'Faculty CV not found' });
    }

    const { bucketName } = getR2StorageConfig();
    const client = getR2Client();
    const object = await client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: faculty.cvR2Key,
    }));

    res.setHeader('Content-Type', faculty.cvContentType || object.ContentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${faculty.cvFileName || 'faculty-cv'}"`);
    if (object.ContentLength) {
      res.setHeader('Content-Length', String(object.ContentLength));
    }

    return object.Body.pipe(res);
  } catch (error) {
    logger.error('faculty_cv.admin_download.error', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Faculty CV could not be downloaded. Please try again.');
  }
});

export default router;
