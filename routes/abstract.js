import express from 'express';
import multer from 'multer';
import path from 'path';
import Abstract from '../models/Abstract.js';
import { authenticateUser, authenticateAdmin } from '../middleware/auth.js';

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
    fileSize: 5 * 1024 * 1024, 
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  }
});


router.post('/submit', authenticateUser, upload.single('abstractFile'), async (req, res) => {
  try {
    const { title, authors, category } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'PDF file is required' });
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

    res.status(201).json({
      message: 'Abstract submitted successfully',
      abstract
    });
  } catch (error) {
    console.error('Abstract submission error:', error);
    res.status(500).json({ message: 'Server error during abstract submission' });
  }
});


router.get('/my-abstract', authenticateUser, async (req, res) => {
  try {
    const abstract = await Abstract.findOne({ userId: req.user._id })
      .populate('userId', 'name email')
      .populate('reviewedBy', 'name');

    if (!abstract) {
      return res.status(404).json({ message: 'No abstract found' });
    }

    res.json(abstract);
  } catch (error) {
    console.error('Get abstract error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/all', authenticateAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    
    const abstracts = await Abstract.find(filter)
      .populate('userId', 'name email role')
      .populate('reviewedBy', 'name')
      .sort({ createdAt: -1 });

    res.json(abstracts);
  } catch (error) {
    console.error('Get all abstracts error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.put('/review/:id', authenticateAdmin, async (req, res) => {
  try {
    const { status, reviewComments } = req.body;
    const abstractId = req.params.id;

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

    res.json({
      message: 'Abstract reviewed successfully',
      abstract
    });
  } catch (error) {
    console.error('Abstract review error:', error);
    res.status(500).json({ message: 'Server error during abstract review' });
  }
});

export default router;