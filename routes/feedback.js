import express from 'express';
import Feedback from '../models/Feedback.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();


router.post('/submit', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    logger.info('feedback.submit.start', { requestId: req.requestId, userId: req.user?._id });
    
    const now = new Date();
    const feedbackOpenDate = new Date('2024-11-01');
    
    if (now < feedbackOpenDate) {
      return res.status(400).json({ 
        message: 'Feedback submission will be available after the conference ends (Nov 1, 2024)' 
      });
    }

    
    const existingFeedback = await Feedback.findOne({ userId: req.user._id });
    if (existingFeedback) {
      return res.status(400).json({ message: 'You have already submitted feedback' });
    }

    const {
      overallRating,
      venueRating,
      contentRating,
      organizationRating,
      networkingRating,
      comments,
      suggestions,
      wouldRecommend,
      futureTopics
    } = req.body;

    const feedback = new Feedback({
      userId: req.user._id,
      overallRating,
      venueRating,
      contentRating,
      organizationRating,
      networkingRating,
      comments,
      suggestions,
      wouldRecommend,
      futureTopics
    });

    await feedback.save();

    await feedback.populate('userId', 'name email');

    logger.info('feedback.submit.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      feedbackId: feedback._id,
    });
    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    logger.error('feedback.submit.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error during feedback submission' });
  }
});


router.get('/my-feedback', authenticateUser, async (req, res) => {
  try {
    logger.debug('feedback.fetch_self.start', { requestId: req.requestId, userId: req.user?._id });
    const feedback = await Feedback.findOne({ userId: req.user._id });
    
    if (!feedback) {
      return res.status(404).json({ message: 'No feedback found' });
    }

    logger.debug('feedback.fetch_self.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      feedbackId: feedback._id,
    });
    res.json(feedback);
  } catch (error) {
    logger.error('feedback.fetch_self.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/all', authenticateAdmin, async (req, res) => {
  try {
    logger.debug('feedback.list.start', { requestId: req.requestId, adminId: req.admin?._id });
    const feedback = await Feedback.find()
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 });

    logger.debug('feedback.list.success', { requestId: req.requestId, count: feedback.length });
    res.json(feedback);
  } catch (error) {
    logger.error('feedback.list.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/analytics', authenticateAdmin, async (req, res) => {
  try {
    logger.debug('feedback.analytics.start', { requestId: req.requestId, adminId: req.admin?._id });
    const totalFeedback = await Feedback.countDocuments();
    
    const analytics = await Feedback.aggregate([
      {
        $group: {
          _id: null,
          avgOverallRating: { $avg: '$overallRating' },
          avgVenueRating: { $avg: '$venueRating' },
          avgContentRating: { $avg: '$contentRating' },
          avgOrganizationRating: { $avg: '$organizationRating' },
          avgNetworkingRating: { $avg: '$networkingRating' },
          totalRecommend: { $sum: { $cond: ['$wouldRecommend', 1, 0] } }
        }
      }
    ]);

    const result = analytics[0] || {
      avgOverallRating: 0,
      avgVenueRating: 0,
      avgContentRating: 0,
      avgOrganizationRating: 0,
      avgNetworkingRating: 0,
      totalRecommend: 0
    };

    result.totalFeedback = totalFeedback;
    result.recommendationRate = totalFeedback > 0 ? (result.totalRecommend / totalFeedback) * 100 : 0;

    logger.debug('feedback.analytics.success', { requestId: req.requestId, totalFeedback });
    res.json(result);
  } catch (error) {
    logger.error('feedback.analytics.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
