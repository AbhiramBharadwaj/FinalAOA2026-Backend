import express from 'express';
import Accommodation from '../models/Accommodation.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import { authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();


router.get('/my-bookings', authenticateUser, async (req, res) => {
  try {
    logger.info('accommodation.bookings.self.start', { requestId: req.requestId, userId: req.user?._id });
    const bookings = await AccommodationBooking.find({ userId: req.user._id })
      .populate('accommodationId')
      .sort({ createdAt: -1 });

    logger.info('accommodation.bookings.self.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      count: bookings.length,
    });
    res.json(bookings);
  } catch (error) {
    logger.error('accommodation.bookings.self.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/', async (req, res) => {
  try {
    logger.info('accommodation.list.start', { requestId: req.requestId });
    const accommodations = await Accommodation.find({ isActive: true });
    logger.info('accommodation.list.success', { requestId: req.requestId, count: accommodations.length });
    res.json(accommodations);
  } catch (error) {
    logger.error('accommodation.list.error', { requestId: req.requestId, message: error?.message || error });
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    logger.info('accommodation.get.start', { requestId: req.requestId, accommodationId: req.params.id });
    const accommodation = await Accommodation.findById(req.params.id);
    if (!accommodation) {
      return res.status(404).json({ message: 'Accommodation not found' });
    }
    logger.info('accommodation.get.success', { requestId: req.requestId, accommodationId: req.params.id });
    res.json(accommodation);
  } catch (error) {
    logger.error('accommodation.get.error', {
      requestId: req.requestId,
      accommodationId: req.params.id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error' });
  }
});


router.post('/book', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    logger.info('accommodation.book.start', { requestId: req.requestId, userId: req.user?._id });
    const {
      accommodationId,
      checkInDate,
      checkOutDate,
      numberOfGuests,
      roomsBooked,
      specialRequests,
    } = req.body;

    const accommodation = await Accommodation.findById(accommodationId);
    if (!accommodation) {
      return res.status(404).json({ message: 'Accommodation not found' });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);
    const numberOfNights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

    if (numberOfNights <= 0) {
      return res.status(400).json({ message: 'Invalid date range' });
    }

    if (accommodation.availableRooms < roomsBooked) {
      return res.status(400).json({ message: 'Not enough rooms available' });
    }

    const totalAmount = accommodation.pricePerNight * numberOfNights * roomsBooked;

    const booking = new AccommodationBooking({
      userId: req.user._id,
      accommodationId,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      numberOfNights,
      numberOfGuests,
      roomsBooked,
      totalAmount,
      specialRequests,
    });

    await booking.save();

    accommodation.availableRooms -= roomsBooked;
    await accommodation.save();

    await booking.populate(['accommodationId', 'userId']);

    logger.info('accommodation.book.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      bookingId: booking._id,
      accommodationId,
      totalAmount,
    });
    res.status(201).json({
      message: 'Booking created successfully',
      booking,
    });
  } catch (error) {
    logger.error('accommodation.book.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Server error during booking' });
  }
});

export default router;
