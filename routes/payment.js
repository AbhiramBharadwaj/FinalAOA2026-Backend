import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Registration from '../models/Registration.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Payment from '../models/Payment.js';
import { authenticateUser } from '../middleware/auth.js';

const router = express.Router();


const razorpay = new Razorpay({
  key_id: "rzp_test_RsGQ0EyONIWnyi",
  key_secret: "gN0xl7IvpO6WDpns8N3gIHcE"
});


router.post('/create-order/registration', authenticateUser, async (req, res) => {
  try {
    const registration = await Registration.findOne({ userId: req.user._id });
    
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    if (registration.paymentStatus === 'PAID') {
      return res.status(400).json({ message: 'Registration already paid' });
    }

    
    const order = await razorpay.orders.create({
      amount: registration.totalAmount * 100, 
      currency: 'INR',
      receipt: `reg_${registration._id}`,
      notes: {
        registrationId: registration._id.toString(),
        userId: req.user._id.toString(),
        type: 'REGISTRATION'
      }
    });

    
    registration.razorpayOrderId = order.id;
    await registration.save();

    
    const payment = new Payment({
      userId: req.user._id,
      registrationId: registration._id,
      amount: registration.totalAmount,
      paymentType: 'REGISTRATION',
      razorpayOrderId: order.id
    });
    await payment.save();

    res.json({
      orderId: order.id,
      amount: registration.totalAmount,
      currency: 'INR',
      keyId: "rzp_test_RsGQ0EyONIWnyi"
    });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
});


router.post('/create-order/accommodation', authenticateUser, async (req, res) => {
  try {
    const { bookingId } = req.body;
    
    const booking = await AccommodationBooking.findOne({
      _id: bookingId,
      userId: req.user._id
    });
    
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.paymentStatus === 'PAID') {
      return res.status(400).json({ message: 'Booking already paid' });
    }

    
    const order = await razorpay.orders.create({
      amount: booking.totalAmount * 100, 
      currency: 'INR',
      receipt: `acc_${booking._id}`,
      notes: {
        bookingId: booking._id.toString(),
        userId: req.user._id.toString(),
        type: 'ACCOMMODATION'
      }
    });

    
    booking.razorpayOrderId = order.id;
    await booking.save();

    
    const payment = new Payment({
      userId: req.user._id,
      accommodationBookingId: booking._id,
      amount: booking.totalAmount,
      paymentType: 'ACCOMMODATION',
      razorpayOrderId: order.id
    });
    await payment.save();

    res.json({
      orderId: order.id,
      amount: booking.totalAmount,
      currency: 'INR',
      keyId: "rzp_test_RsGQ0EyONIWnyi"
    });
  } catch (error) {
    console.error('Create accommodation order error:', error);
    res.status(500).json({ message: 'Failed to create payment order' });
  }
});


router.post('/verify', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', "gN0xl7IvpO6WDpns8N3gIHcE")
      .update(body.toString())
      .digest('hex');

    if (expectedSignature !== razorpay_signature) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    
    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
    
    if (!payment) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    
    payment.status = 'SUCCESS';
    payment.razorpayPaymentId = razorpay_payment_id;
    payment.razorpaySignature = razorpay_signature;
    await payment.save();

    
    if (payment.paymentType === 'REGISTRATION') {
      await Registration.findByIdAndUpdate(payment.registrationId, {
        paymentStatus: 'PAID',
        razorpayPaymentId: razorpay_payment_id
      });
    } else if (payment.paymentType === 'ACCOMMODATION') {
      await AccommodationBooking.findByIdAndUpdate(payment.accommodationBookingId, {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        razorpayPaymentId: razorpay_payment_id
      });
    }

    res.json({ message: 'Payment verified successfully' });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ message: 'Payment verification failed' });
  }
});


router.post('/failed', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, error } = req.body;

    
    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
    
    if (payment) {
      payment.status = 'FAILED';
      payment.failureReason = error?.description || 'Payment failed';
      await payment.save();

      
      if (payment.paymentType === 'REGISTRATION') {
        await Registration.findByIdAndUpdate(payment.registrationId, {
          paymentStatus: 'FAILED'
        });
      } else if (payment.paymentType === 'ACCOMMODATION') {
        await AccommodationBooking.findByIdAndUpdate(payment.accommodationBookingId, {
          paymentStatus: 'FAILED'
        });
      }
    }

    res.json({ message: 'Payment failure recorded' });
  } catch (error) {
    console.error('Payment failure error:', error);
    res.status(500).json({ message: 'Failed to record payment failure' });
  }
});

export default router;