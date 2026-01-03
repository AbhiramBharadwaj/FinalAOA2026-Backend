import express from 'express';
import Accommodation from '../models/Accommodation.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import { authenticateUser, requireProfileComplete } from '../middleware/auth.js';

const router = express.Router();


router.get('/my-bookings', authenticateUser, async (req, res) => {
  try {
    const bookings = await AccommodationBooking.find({ userId: req.user._id })
      .populate('accommodationId')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    console.error('Get my-bookings error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/', async (req, res) => {
  try {
    const accommodations = await Accommodation.find({ isActive: true });
    res.json(accommodations);
  } catch (error) {
    console.error('Get all accommodations error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.get('/:id', async (req, res) => {
  try {
    const accommodation = await Accommodation.findById(req.params.id);
    if (!accommodation) {
      return res.status(404).json({ message: 'Accommodation not found' });
    }
    res.json(accommodation);
  } catch (error) {
    console.error('Get accommodation by ID error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});


router.post('/book', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
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

    res.status(201).json({
      message: 'Booking created successfully',
      booking,
    });
  } catch (error) {
    console.error('Booking error:', error);
    res.status(500).json({ message: 'Server error during booking' });
  }
});

export default router;
