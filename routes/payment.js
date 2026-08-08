import 'dotenv/config';
import express from 'express';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import Registration from '../models/Registration.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Payment from '../models/Payment.js';
import { authenticateAdmin, authenticateUser, requireProfileComplete } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';
import {
  createPaymentFinalizer,
  PaymentFinalizationError,
} from '../services/paymentFinalization.js';

const router = express.Router();
const ORDER_CREATION_LOCK_MS = 60 * 1000;

const razorpay = new Razorpay({
  key_id: "rzp_live_S1h8EPxjXzDsaM",
  key_secret: "sGAW1CE3Mnpus4PfYMdUAp8i"
});
const razorpayWebhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
if (!razorpayWebhookSecret) {
  throw new Error('RAZORPAY_WEBHOOK_SECRET is required');
}
const finalizePayment = createPaymentFinalizer({ razorpay });

const getFinalizationStatusCode = (error, fallback = 500) =>
  error instanceof PaymentFinalizationError ? error.statusCode : fallback;

const isNotCapturedError = (error) => error?.code === 'PAYMENT_NOT_CAPTURED';

const acquireOrderCreationLock = (Model, id) =>
  Model.findOneAndUpdate(
    {
      _id: id,
      $or: [
        { paymentOrderCreatingAt: { $exists: false } },
        { paymentOrderCreatingAt: null },
        { paymentOrderCreatingAt: { $lt: new Date(Date.now() - ORDER_CREATION_LOCK_MS) } },
      ],
    },
    { $set: { paymentOrderCreatingAt: new Date() } },
    { new: true }
  );

const releaseOrderCreationLock = (Model, id) =>
  Model.findByIdAndUpdate(id, { $unset: { paymentOrderCreatingAt: 1 } });

const reconcilePendingPayments = async ({ filter, expectedUserId }) => {
  const pendingPayments = await Payment.find({
    ...filter,
    status: { $in: ['PENDING', 'FAILED'] },
  }).sort({ createdAt: -1 });
  for (const pendingPayment of pendingPayments) {
    try {
      const result = await finalizePayment({
        razorpayOrderId: pendingPayment.razorpayOrderId,
        source: 'ORDER_RETRY',
        expectedUserId,
      });
      if (result.paymentStatus === 'PAID') return { result, pendingPayments };
    } catch (error) {
      if (!isNotCapturedError(error)) throw error;
    }
  }
  return { result: null, pendingPayments };
};

const findReusableOrder = async (pendingPayments, balanceDue) => {
  const expectedAmount = Math.round(Number(balanceDue) * 100);
  for (const pendingPayment of pendingPayments) {
    const order = await razorpay.orders.fetch(pendingPayment.razorpayOrderId);
    const canAcceptPayment = order?.status === 'created' || order?.status === 'attempted';
    if (
      canAcceptPayment &&
      Number(order.amount_due) === expectedAmount &&
      Number(order.amount_paid) === 0
    ) {
      return order;
    }
  }
  return null;
};


router.post('/create-order/registration', authenticateUser, requireProfileComplete, async (req, res) => {
  let lockedRegistrationId;
  try {
    logger.info(`${req.actorName || 'User'} started a registration payment.`);
    let registration = await Registration.findOne({ userId: req.user._id });
    
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }
    if (
      registration.paymentStatus === 'PAID' &&
      Number(registration.totalPaid || 0) >= Number(registration.totalAmount || 0)
    ) {
      return res.status(400).json({ message: 'Registration already fully paid' });
    }

    const lockedRegistration = await acquireOrderCreationLock(Registration, registration._id);
    if (!lockedRegistration) {
      return res.status(409).json({
        message: 'Payment setup is already in progress. Please wait and try again.',
      });
    }
    lockedRegistrationId = registration._id;

    const reconciliation = await reconcilePendingPayments({
      filter: { registrationId: registration._id, paymentType: 'REGISTRATION' },
      expectedUserId: req.user._id,
    });
    if (reconciliation.result?.paymentStatus === 'PAID') {
      return res.status(409).json({
        message: 'A previous payment was already captured. Registration has been confirmed.',
        paymentStatus: 'PAID',
      });
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
    registration = await Registration.findById(registration._id);
    registration.totalPaid = totalPaid;
    registration.paymentStatus = totalPaid >= registration.totalAmount ? 'PAID' : 'PENDING';
    await registration.save();

    const balanceDue = Math.max(0, registration.totalAmount - totalPaid);

    if (balanceDue <= 0) {
      return res.status(400).json({ message: 'Registration already fully paid' });
    }

    const reusableOrder = await findReusableOrder(reconciliation.pendingPayments, balanceDue);
    if (reusableOrder) {
      registration.razorpayOrderId = reusableOrder.id;
      await registration.save();
      return res.json({
        orderId: reusableOrder.id,
        amount: balanceDue,
        currency: reusableOrder.currency || 'INR',
        keyId: "rzp_live_S1h8EPxjXzDsaM",
        reused: true,
      });
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
    res.status(getFinalizationStatusCode(error)).json({
      message: error instanceof PaymentFinalizationError
        ? error.message
        : 'Failed to create payment order',
    });
  } finally {
    if (lockedRegistrationId) {
      await releaseOrderCreationLock(Registration, lockedRegistrationId).catch((error) => {
        logger.error('Registration payment lock release failed.', {
          message: error?.message || error,
        });
      });
    }
  }
});


router.post('/create-order/accommodation', authenticateUser, requireProfileComplete, async (req, res) => {
  let lockedBookingId;
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

    const lockedBooking = await acquireOrderCreationLock(AccommodationBooking, booking._id);
    if (!lockedBooking) {
      return res.status(409).json({
        message: 'Payment setup is already in progress. Please wait and try again.',
      });
    }
    lockedBookingId = booking._id;

    const reconciliation = await reconcilePendingPayments({
      filter: { accommodationBookingId: booking._id, paymentType: 'ACCOMMODATION' },
      expectedUserId: req.user._id,
    });
    if (reconciliation.result?.paymentStatus === 'PAID') {
      return res.status(409).json({
        message: 'A previous payment was already captured. Booking has been confirmed.',
        paymentStatus: 'PAID',
      });
    }

    const reusableOrder = await findReusableOrder(
      reconciliation.pendingPayments,
      booking.totalAmount
    );
    if (reusableOrder) {
      booking.razorpayOrderId = reusableOrder.id;
      await booking.save();
      return res.json({
        orderId: reusableOrder.id,
        amount: booking.totalAmount,
        currency: reusableOrder.currency || 'INR',
        keyId: "rzp_live_S1h8EPxjXzDsaM",
        reused: true,
      });
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
    res.status(getFinalizationStatusCode(error)).json({
      message: error instanceof PaymentFinalizationError
        ? error.message
        : 'Failed to create payment order',
    });
  } finally {
    if (lockedBookingId) {
      await releaseOrderCreationLock(AccommodationBooking, lockedBookingId).catch((error) => {
        logger.error('Accommodation payment lock release failed.', {
          message: error?.message || error,
        });
      });
    }
  }
});


router.post('/verify', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ message: 'Complete Razorpay verification details are required' });
    }

    logger.info(`Payment verification started for order ${razorpay_order_id}.`);
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac('sha256', "sGAW1CE3Mnpus4PfYMdUAp8i")
      .update(body.toString())
      .digest('hex');

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(String(razorpay_signature), 'utf8');
    const signatureValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    if (!signatureValid) {
      return res.status(400).json({ message: 'Invalid payment signature' });
    }

    const result = await finalizePayment({
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id,
      source: 'BROWSER',
      expectedUserId: req.user._id,
    });

    await Payment.findOneAndUpdate(
      { razorpayOrderId: razorpay_order_id },
      { $set: { razorpaySignature: razorpay_signature } }
    );

    logger.info(
      `${req.actorName || 'User'} finalized payment ${razorpay_payment_id}.`
    );
    res.json({ message: 'Payment verified successfully', ...result });
  } catch (error) {
    logger.error('Payment verification failed.', { message: error?.message || error });
    res.status(getFinalizationStatusCode(error)).json({
      message: error instanceof PaymentFinalizationError
        ? error.message
        : 'Payment verification failed',
      code: error?.code,
    });
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

    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');
    const receivedBuffer = Buffer.from(String(signature || ''), 'utf8');
    const signatureValid =
      expectedBuffer.length === receivedBuffer.length &&
      crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
    if (!signatureValid) {
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

    const result = await finalizePayment({
      razorpayOrderId,
      razorpayPaymentId,
      providerPayment: paymentEntity?.status === 'captured' ? paymentEntity : undefined,
      source: 'WEBHOOK',
    });

    res.json({ message: 'Webhook processed', ...result });
  } catch (error) {
    logger.error('payment.webhook.error', { message: error?.message || error });
    const statusCode = error?.code === 'PAYMENT_RECORD_NOT_FOUND'
      ? 503
      : getFinalizationStatusCode(error);
    res.status(statusCode).json({
      message: error instanceof PaymentFinalizationError ? error.message : 'Webhook error',
      code: error?.code,
    });
  }
});

router.post('/reconcile/order', authenticateAdmin, async (req, res) => {
  try {
    const { razorpayOrderId } = req.body;
    if (!razorpayOrderId) {
      return res.status(400).json({ message: 'razorpayOrderId is required' });
    }

    const result = await finalizePayment({
      razorpayOrderId,
      source: 'ADMIN',
    });
    res.json({ message: 'Reconciliation completed', ...result });
  } catch (error) {
    if (isNotCapturedError(error)) {
      return res.json({ message: 'No captured payment found for this order' });
    }
    logger.error('payment.reconcile.error', { message: error?.message || error });
    res.status(getFinalizationStatusCode(error)).json({
      message: error instanceof PaymentFinalizationError
        ? error.message
        : 'Failed to reconcile payment',
      code: error?.code,
    });
  }
});

router.post('/failed', authenticateUser, async (req, res) => {
  try {
    const { razorpay_order_id, error } = req.body;
    let capturedResult;

    logger.warn(`Payment failed for order ${razorpay_order_id}.`);

    
    const payment = await Payment.findOne({
      razorpayOrderId: razorpay_order_id,
      userId: req.user._id,
    });
    
    if (payment) {
      const providerPayments = await razorpay.orders.fetchPayments(razorpay_order_id);
      const captured = providerPayments?.items?.find((item) => item?.status === 'captured');
      if (captured) {
        capturedResult = await finalizePayment({
          razorpayOrderId: razorpay_order_id,
          providerPayment: captured,
          source: 'ORDER_RETRY',
          expectedUserId: req.user._id,
        });
      } else {
        payment.status = 'FAILED';
        payment.failureReason = error?.description || 'Payment failed';
        await payment.save();
      }
    }

    if (capturedResult) {
      return res.json({
        message: 'Payment was captured and has been finalized',
        ...capturedResult,
      });
    }

    logger.warn(`Payment failure recorded for order ${razorpay_order_id}.`);
    res.json({ message: 'Payment failure recorded' });
  } catch (error) {
    logger.error('Failed to record payment failure.', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Payment failure could not be recorded. Please do not retry payment until your payment status is checked.');
  }
});

export default router;
