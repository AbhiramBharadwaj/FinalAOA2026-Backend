import express from 'express';
import Feedback from '../models/Feedback.js';
import { authenticateUser, authenticateAdmin, requireProfileComplete } from '../middleware/auth.js';

const router = express.Router();


router.post('/submit', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    
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

    res.status(201).json({
      message: 'Feedback submitted successfully',
      feedback
    });
  } catch (error) {
    console.error('Feedback submission error:', error);
    res.status(500).json({ message: 'Server error during feedback submission' });
  }
});


router.get('/my-feedback', authenticateUser, async (req, res) => {
  try {
    const feedback = await Feedback.findOne({ userId: req.user._id });
    
    if (!feedback) {
      return res.status(404).json({ message: 'No feedback found' });
    }

    res.json(feedback);
  } catch (error) {
    console.error('Get feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/all', authenticateAdmin, async (req, res) => {
  try {
    const feedback = await Feedback.find()
      .populate('userId', 'name email role')
      .sort({ createdAt: -1 });

    res.json(feedback);
  } catch (error) {
    console.error('Get all feedback error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/analytics', authenticateAdmin, async (req, res) => {
  try {
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

    res.json(result);
  } catch (error) {
    console.error('Feedback analytics error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

export default router;
