import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Registration from '../models/Registration.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Payment from '../models/Payment.js';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import QRCode from 'qrcode';
import { authenticateAdmin, authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import { sendPaymentSuccessEmail } from '../utils/email.js';
import {
  buildRegistrationInvoicePdf,
  buildAccommodationInvoicePdf,
} from '../utils/invoice.js';
import logger from '../utils/logger.js';

const router = express.Router();

const buildRegistrationLabel = (registration) => {
  const labels = [];
  if (registration?.addWorkshop || registration?.selectedWorkshop) labels.push('Workshop');
  if (registration?.addAoaCourse) labels.push('AOA Certified Course');
  if (registration?.addLifeMembership) labels.push('AOA Life Membership');
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
};


const razorpay = new Razorpay({
  key_id: "rzp_live_S1h8EPxjXzDsaM",
  key_secret: "sGAW1CE3Mnpus4PfYMdUAp8i"
});
const razorpayWebhookSecret =
  process.env.RAZORPAY_WEBHOOK_SECRET || "sGAW1CE3Mnpus4PfYMdUAp8i";

const updateRegistrationPaymentStatus = async (registrationId, razorpayPaymentId) => {
  const paidAggregate = await Payment.aggregate([
    {
      $match: {
        registrationId,
        status: 'SUCCESS',
      },
    },
    {
      $group: { _id: null, total: { $sum: '$amount' } },
    },
  ]);
  const totalPaid = paidAggregate[0]?.total || 0;
  const registration = await Registration.findById(registrationId);
  if (!registration) return;
  const paymentStatus = totalPaid >= registration.totalAmount ? 'PAID' : 'PENDING';
  await Registration.findByIdAndUpdate(registrationId, {
    paymentStatus,
    totalPaid,
    ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
  });
};


router.post('/create-order/registration', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    logger.info(`${req.actorName || 'User'} started a registration payment.`);
    const registration = await Registration.findOne({ userId: req.user._id });
    
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    const paidAggregate = await Payment.aggregate([
      {
        $match: {
          registrationId: registration._id,
          status: 'SUCCESS',
        },
      },
      {
        $group: { _id: null, total: { $sum: '$amount' } },
      },
    ]);
    const totalPaid = paidAggregate[0]?.total || 0;
    registration.totalPaid = totalPaid;
    registration.paymentStatus = totalPaid >= registration.totalAmount ? 'PAID' : 'PENDING';
    await registration.save();

    const balanceDue = Math.max(0, registration.totalAmount - totalPaid);

    if (balanceDue <= 0) {
      return res.status(400).json({ message: 'Registration already fully paid' });
    }

    const order = await razorpay.orders.create({
      amount: balanceDue * 100, 
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
      amount: balanceDue,
      paymentType: 'REGISTRATION',
      razorpayOrderId: order.id
    });
    await payment.save();

    logger.info(
      `${req.actorName || 'User'} created a registration payment of INR ${balanceDue}. Order ID: ${order.id}.`
    );
    res.json({
      orderId: order.id,
      amount: balanceDue,
      currency: 'INR',
      keyId: "rzp_live_S1h8EPxjXzDsaM"
    });
  } catch (error) {
    logger.error('Registration payment order failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Failed to create payment order' });
  }
});


router.post('/create-order/accommodation', authenticateUser, requireProfileComplete, async (req, res) => {
  try {
    const { bookingId } = req.body;
    logger.info(`${req.actorName || 'User'} started an accommodation payment.`);
    
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

    logger.info(
      `${req.actorName || 'User'} created an accommodation payment of INR ${booking.totalAmount}. Order ID: ${order.id}.`
    );
    res.json({
      orderId: order.id,
      amount: booking.totalAmount,
      currency: 'INR',
      keyId: "rzp_live_S1h8EPxjXzDsaM"
    });
  } catch (error) {
    logger.error('Accommodation payment order failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Failed to create payment order' });
  }
});


router.post('/verify', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    logger.info(`Payment verification started for order ${razorpay_order_id}.`);

    
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', "sGAW1CE3Mnpus4PfYMdUAp8i")
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
      await updateRegistrationPaymentStatus(payment.registrationId, razorpay_payment_id);
    } else if (payment.paymentType === 'ACCOMMODATION') {
      await AccommodationBooking.findByIdAndUpdate(payment.accommodationBookingId, {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        razorpayPaymentId: razorpay_payment_id
      });
    }

    try {
      if (payment.paymentType === 'REGISTRATION') {
        const registration = await Registration.findById(payment.registrationId)
          .populate('userId', 'name email phone role')
          .lean();
        if (registration?.userId?.email) {
          const currentPaymentStatus =
            (registration.totalPaid || 0) >= (registration.totalAmount || 0) ? 'PAID' : 'PENDING';
          let attendance = await Attendance.findOne({ registrationId: registration._id });
          if (!attendance) {
            attendance = new Attendance({
              registrationId: registration._id,
              qrCodeData: registration.registrationNumber,
            });
            await attendance.save();
          }

          const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
            width: 512,
            margin: 1,
            color: { dark: '#005aa9', light: '#ffffff' },
          });
          const invoiceBuffer = buildRegistrationInvoicePdf(
            registration,
            registration.userId,
            {
              paymentId: razorpay_payment_id || registration.razorpayPaymentId,
              paidAt: payment.createdAt || new Date(),
            }
          );

          await sendPaymentSuccessEmail({
            user: registration.userId,
            subject: `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
            summaryLines: [
              `Registration No: ${registration.registrationNumber || 'N/A'}`,
              `Package: ${buildRegistrationLabel(registration)}`,
              `Amount Paid: INR ${Number(payment.amount || 0).toLocaleString('en-IN')}`,
              `Payment Status: ${currentPaymentStatus}`,
            ],
            qrCid: 'qr-ticket',
            attachments: [
              {
                filename: `AOA_Ticket_${registration.registrationNumber}.png`,
                content: qrBuffer,
                contentType: 'image/png',
                cid: 'qr-ticket',
              },
              {
                filename: `AOA_Invoice_${registration.registrationNumber}.pdf`,
                content: invoiceBuffer,
                contentType: 'application/pdf',
              },
            ],
          });
          await Registration.findByIdAndUpdate(registration._id, {
            paymentEmailSentAt: new Date(),
            paymentEmailFailedAt: null,
            paymentEmailError: null,
          });
        }
      } else if (payment.paymentType === 'ACCOMMODATION') {
        const booking = await AccommodationBooking.findById(
          payment.accommodationBookingId
        )
          .populate('accommodationId', 'name location')
          .lean();
        const user = await User.findById(payment.userId).lean();
        if (booking && user?.email) {
          const invoiceBuffer = buildAccommodationInvoicePdf(booking, user);
          await sendPaymentSuccessEmail({
            user,
            subject: `AOACON 2026 Payment Successful - ${booking.bookingNumber || 'Booking'}`,
            summaryLines: [
              `Booking No: ${booking.bookingNumber || 'N/A'}`,
              `Hotel: ${booking.accommodationId?.name || 'N/A'}`,
              `Amount Paid: INR ${Number(booking.totalAmount || 0).toLocaleString('en-IN')}`,
              'Payment Status: PAID',
            ],
            attachments: [
              {
                filename: `AOA_Invoice_${booking.bookingNumber || 'Booking'}.pdf`,
                content: invoiceBuffer,
                contentType: 'application/pdf',
              },
            ],
          });
        }
      }
    } catch (emailError) {
      if (payment.paymentType === 'REGISTRATION' && payment.registrationId) {
        await Registration.findByIdAndUpdate(payment.registrationId, {
          paymentEmailFailedAt: new Date(),
          paymentEmailError: emailError?.message || String(emailError),
        });
      }
      logger.warn('Payment email failed to send.', { message: emailError?.message || emailError });
    }

    logger.info(
      `${req.actorName || 'User'} completed payment of INR ${payment.amount}. Payment ID: ${razorpay_payment_id}.`
    );
    res.json({ message: 'Payment verified successfully' });
  } catch (error) {
    logger.error('Payment verification failed.', { message: error?.message || error });
    res.status(500).json({ message: 'Payment verification failed' });
  }
});

router.post('/webhook', async (req, res) => {
  try {
    const signature = req.headers['x-razorpay-signature'];
    const rawBody = req.body instanceof Buffer ? req.body.toString('utf8') : JSON.stringify(req.body || {});
    const expectedSignature = crypto
      .createHmac('sha256', razorpayWebhookSecret)
      .update(rawBody)
      .digest('hex');

    if (!signature || signature !== expectedSignature) {
      logger.warn('payment.webhook.invalid_signature');
      return res.status(400).json({ message: 'Invalid webhook signature' });
    }

    const event = JSON.parse(rawBody);
    const eventType = event?.event;

    if (eventType !== 'payment.captured' && eventType !== 'order.paid') {
      return res.json({ message: 'Event ignored' });
    }

    const paymentEntity = event?.payload?.payment?.entity;
    const orderEntity = event?.payload?.order?.entity;
    const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id;
    const razorpayPaymentId = paymentEntity?.id;

    if (!razorpayOrderId) {
      logger.warn('payment.webhook.missing_order_id');
      return res.json({ message: 'Missing order id' });
    }

    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      logger.warn('payment.webhook.payment_not_found', { razorpayOrderId });
      return res.json({ message: 'Payment not found' });
    }

    if (payment.status !== 'SUCCESS') {
      payment.status = 'SUCCESS';
      if (razorpayPaymentId) payment.razorpayPaymentId = razorpayPaymentId;
      await payment.save();
    }

    if (payment.paymentType === 'REGISTRATION') {
      await updateRegistrationPaymentStatus(payment.registrationId, razorpayPaymentId);
    } else if (payment.paymentType === 'ACCOMMODATION') {
      await AccommodationBooking.findByIdAndUpdate(payment.accommodationBookingId, {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        ...(razorpayPaymentId ? { razorpayPaymentId } : {}),
      });
    }

    res.json({ message: 'Webhook processed' });
  } catch (error) {
    logger.error('payment.webhook.error', { message: error?.message || error });
    res.status(500).json({ message: 'Webhook error' });
  }
});

router.post('/reconcile/order', authenticateAdmin, async (req, res) => {
  try {
    const { razorpayOrderId } = req.body;
    if (!razorpayOrderId) {
      return res.status(400).json({ message: 'razorpayOrderId is required' });
    }

    const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
    const captured = payments?.items?.find((item) => item?.status === 'captured');

    if (!captured) {
      return res.json({ message: 'No captured payment found for this order' });
    }

    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      return res.status(404).json({ message: 'Payment record not found' });
    }

    if (payment.status !== 'SUCCESS') {
      payment.status = 'SUCCESS';
      payment.razorpayPaymentId = captured?.id || payment.razorpayPaymentId;
      await payment.save();
    }

    if (payment.paymentType === 'REGISTRATION') {
      await updateRegistrationPaymentStatus(payment.registrationId, captured?.id);
    } else if (payment.paymentType === 'ACCOMMODATION') {
      await AccommodationBooking.findByIdAndUpdate(payment.accommodationBookingId, {
        paymentStatus: 'PAID',
        bookingStatus: 'CONFIRMED',
        ...(captured?.id ? { razorpayPaymentId: captured.id } : {}),
      });
    }

    res.json({ message: 'Reconciliation completed' });
  } catch (error) {
    logger.error('payment.reconcile.error', { message: error?.message || error });
    res.status(500).json({ message: 'Failed to reconcile payment' });
  }
});

router.post('/failed', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, error } = req.body;

    logger.warn(`Payment failed for order ${razorpay_order_id}.`);

    
    const payment = await Payment.findOne({ razorpayOrderId: razorpay_order_id });
    
    if (payment) {
      payment.status = 'FAILED';
      payment.failureReason = error?.description || 'Payment failed';
      await payment.save();
    }

    logger.warn(`Payment failure recorded for order ${razorpay_order_id}.`);
    res.json({ message: 'Payment failure recorded' });
  } catch (error) {
    logger.error('Failed to record payment failure.', { message: error?.message || error });
    res.status(500).json({ message: 'Failed to record payment failure' });
  }
});

export default router;
