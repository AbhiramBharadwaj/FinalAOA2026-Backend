import QRCode from 'qrcode';
import Registration from '../models/Registration.js';
import AccommodationBooking from '../models/AccommodationBooking.js';
import Payment from '../models/Payment.js';
import Attendance from '../models/Attendance.js';
import User from '../models/User.js';
import { sendPaymentSuccessEmail } from '../utils/email.js';
import {
  buildRegistrationInvoicePdf,
  buildAccommodationInvoicePdf,
} from '../utils/invoice.js';
import logger from '../utils/logger.js';
import { activatePaidLifeMembership } from './membershipActivation.js';

const EMAIL_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;

export class PaymentFinalizationError extends Error {
  constructor(message, { code = 'PAYMENT_FINALIZATION_ERROR', statusCode = 500 } = {}) {
    super(message);
    this.name = 'PaymentFinalizationError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

const buildRegistrationLabel = (registration) => {
  const labels = [];
  if (registration?.addWorkshop || registration?.selectedWorkshop) labels.push('Workshop');
  if (registration?.addAoaCourse) labels.push('AOA Certified Course');
  if (registration?.addLifeMembership) labels.push('AOA Life Membership');
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
};

const isSameId = (left, right) => String(left || '') === String(right || '');

export const validateCapturedPayment = ({ providerPayment, localPayment, razorpayOrderId }) => {
  if (!providerPayment || providerPayment.status !== 'captured' || providerPayment.captured === false) {
    throw new PaymentFinalizationError('No captured payment found for this order', {
      code: 'PAYMENT_NOT_CAPTURED',
      statusCode: 409,
    });
  }

  if (!isSameId(providerPayment.order_id, razorpayOrderId)) {
    throw new PaymentFinalizationError('Razorpay payment belongs to a different order', {
      code: 'PAYMENT_ORDER_MISMATCH',
      statusCode: 409,
    });
  }

  const expectedAmount = Math.round(Number(localPayment.amount || 0) * 100);
  if (Number(providerPayment.amount) !== expectedAmount) {
    throw new PaymentFinalizationError('Razorpay payment amount does not match the local order', {
      code: 'PAYMENT_AMOUNT_MISMATCH',
      statusCode: 409,
    });
  }

  const providerCurrency = String(providerPayment.currency || '').toUpperCase();
  const localCurrency = String(localPayment.currency || 'INR').toUpperCase();
  if (providerCurrency !== localCurrency) {
    throw new PaymentFinalizationError('Razorpay payment currency does not match the local order', {
      code: 'PAYMENT_CURRENCY_MISMATCH',
      statusCode: 409,
    });
  }

  return providerPayment;
};

const fetchCapturedPayment = async ({
  razorpay,
  razorpayOrderId,
  razorpayPaymentId,
  providerPayment,
}) => {
  if (providerPayment) return providerPayment;

  if (razorpayPaymentId) {
    return razorpay.payments.fetch(razorpayPaymentId);
  }

  const payments = await razorpay.orders.fetchPayments(razorpayOrderId);
  return payments?.items?.find((item) => item?.status === 'captured');
};

const claimEmailDelivery = async (Model, id) => {
  const staleBefore = new Date(Date.now() - EMAIL_CLAIM_TIMEOUT_MS);
  return Model.findOneAndUpdate(
    {
      _id: id,
      paymentStatus: 'PAID',
      $and: [
        {
          $or: [
            { paymentEmailSentAt: { $exists: false } },
            { paymentEmailSentAt: null },
          ],
        },
        {
          $or: [
            { paymentEmailSendingAt: { $exists: false } },
            { paymentEmailSendingAt: null },
            { paymentEmailSendingAt: { $lt: staleBefore } },
          ],
        },
      ],
    },
    {
      $set: { paymentEmailSendingAt: new Date() },
    },
    { new: true }
  );
};

const markEmailSent = (Model, id) =>
  Model.findByIdAndUpdate(id, {
    $set: {
      paymentEmailSentAt: new Date(),
      paymentEmailFailedAt: null,
      paymentEmailError: null,
    },
    $unset: { paymentEmailSendingAt: 1 },
  });

const markEmailFailed = (Model, id, error) =>
  Model.findByIdAndUpdate(id, {
    $set: {
      paymentEmailFailedAt: new Date(),
      paymentEmailError: error?.message || String(error),
    },
    $unset: { paymentEmailSendingAt: 1 },
  });

const deliverRegistrationConfirmation = async ({ registrationId, payment, providerPayment }) => {
  const claimed = await claimEmailDelivery(Registration, registrationId);
  if (!claimed) return 'ALREADY_SENT_OR_IN_PROGRESS';

  try {
    const registration = await Registration.findById(registrationId)
      .populate('userId', 'name email phone role membershipId')
      .lean();

    if (!registration?.userId?.email) {
      throw new Error('Registration email is not available');
    }

    const attendance = await Attendance.findOneAndUpdate(
      { registrationId: registration._id },
      {
        $setOnInsert: {
          registrationId: registration._id,
          qrCodeData: registration.registrationNumber,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
      width: 512,
      margin: 1,
      color: { dark: '#005aa9', light: '#ffffff' },
    });
    const invoiceBuffer = buildRegistrationInvoicePdf(registration, registration.userId, {
      paymentId: providerPayment.id || registration.razorpayPaymentId,
      paidAt: providerPayment.created_at
        ? new Date(providerPayment.created_at * 1000)
        : payment.createdAt || new Date(),
    });

    const membershipActive =
      registration.addLifeMembership && registration.membershipStatus === 'ACTIVE';
    const summaryLines = [
      `Registration No: ${registration.registrationNumber || 'N/A'}`,
      `Package: ${buildRegistrationLabel(registration)}`,
      `Amount Paid: INR ${Number(registration.totalPaid || payment.amount || 0).toLocaleString('en-IN')}`,
      'Payment Status: PAID',
    ];
    if (membershipActive && registration.lifetimeMembershipId) {
      summaryLines.splice(3, 0, `AOA Membership ID: ${registration.lifetimeMembershipId}`);
      summaryLines.splice(4, 0, 'Membership Status: ACTIVE');
    }

    await sendPaymentSuccessEmail({
      user: registration.userId,
      subject: membershipActive
        ? `AOA Life Membership Activated - ${registration.lifetimeMembershipId}`
        : `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
      summaryLines,
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

    await markEmailSent(Registration, registrationId);
    return 'SENT';
  } catch (error) {
    await markEmailFailed(Registration, registrationId, error);
    logger.warn('payment.finalization.registration_email_failed', {
      message: error?.message || error,
    });
    return 'FAILED';
  }
};

export const deliverAccommodationConfirmation = async ({ bookingId }) => {
  const claimed = await claimEmailDelivery(AccommodationBooking, bookingId);
  if (!claimed) return 'ALREADY_SENT_OR_IN_PROGRESS';

  try {
    const booking = await AccommodationBooking.findById(bookingId)
      .populate('accommodationId', 'name location')
      .lean();
    const user = booking ? await User.findById(booking.userId).lean() : null;
    if (!booking || !user?.email) throw new Error('Accommodation booking email is not available');

    const invoiceBuffer = buildAccommodationInvoicePdf(booking, user);
    await sendPaymentSuccessEmail({
      user,
      subject: `AOACON 2026 Payment Successful - ${booking.bookingNumber || 'Booking'}`,
      summaryLines: [
        `Booking No: ${booking.bookingNumber || 'N/A'}`,
        `Hotel: ${booking.accommodationId?.name || 'N/A'}`,
        `Stay: ${new Date(booking.checkInDate).toLocaleDateString('en-IN')} to ${new Date(booking.checkOutDate).toLocaleDateString('en-IN')}`,
        `Occupancy: ${booking.occupancyType === 'SHARING' ? 'Sharing' : 'Single'}`,
        `Amount Paid: INR ${Number(booking.amountCollected ?? booking.totalAmount ?? 0).toLocaleString('en-IN')}`,
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

    await markEmailSent(AccommodationBooking, bookingId);
    return 'SENT';
  } catch (error) {
    await markEmailFailed(AccommodationBooking, bookingId, error);
    logger.warn('payment.finalization.accommodation_email_failed', {
      message: error?.message || error,
    });
    return 'FAILED';
  }
};

export const createPaymentFinalizer = ({ razorpay }) => {
  if (!razorpay) throw new Error('Razorpay client is required');

  return async ({
    razorpayOrderId,
    razorpayPaymentId,
    providerPayment,
    source = 'UNKNOWN',
    expectedUserId,
  }) => {
    if (!razorpayOrderId) {
      throw new PaymentFinalizationError('Razorpay order ID is required', {
        code: 'ORDER_ID_REQUIRED',
        statusCode: 400,
      });
    }

    const payment = await Payment.findOne({ razorpayOrderId });
    if (!payment) {
      throw new PaymentFinalizationError('Local payment record not found', {
        code: 'PAYMENT_RECORD_NOT_FOUND',
        statusCode: 404,
      });
    }

    if (expectedUserId && !isSameId(payment.userId, expectedUserId)) {
      throw new PaymentFinalizationError('Payment does not belong to the authenticated user', {
        code: 'PAYMENT_OWNER_MISMATCH',
        statusCode: 403,
      });
    }

    const captured = await fetchCapturedPayment({
      razorpay,
      razorpayOrderId,
      razorpayPaymentId,
      providerPayment,
    });
    validateCapturedPayment({
      providerPayment: captured,
      localPayment: payment,
      razorpayOrderId,
    });

    const finalizedAt = new Date();
    await Payment.findByIdAndUpdate(payment._id, {
      $set: {
        status: 'SUCCESS',
        razorpayPaymentId: captured.id,
        providerAmount: Number(captured.amount) / 100,
        providerCurrency: String(captured.currency || 'INR').toUpperCase(),
        providerCapturedAt: captured.created_at
          ? new Date(captured.created_at * 1000)
          : finalizedAt,
        finalizedAt,
        finalizationSource: source,
        failureReason: null,
      },
    });

    let targetStatus;
    let totalPaid;
    let emailStatus = 'NOT_REQUIRED';
    let membershipActivation = null;

    if (payment.paymentType === 'REGISTRATION') {
      const paidAggregate = await Payment.aggregate([
        { $match: { registrationId: payment.registrationId, status: 'SUCCESS' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totalPaid = paidAggregate[0]?.total || 0;
      const registration = await Registration.findById(payment.registrationId);
      if (!registration) {
        throw new PaymentFinalizationError('Registration not found for payment', {
          code: 'REGISTRATION_NOT_FOUND',
          statusCode: 404,
        });
      }

      targetStatus = totalPaid >= registration.totalAmount ? 'PAID' : 'PENDING';
      await Registration.findByIdAndUpdate(registration._id, {
        $set: {
          paymentStatus: targetStatus,
          totalPaid,
          razorpayPaymentId: captured.id,
        },
      });

      if (targetStatus === 'PAID') {
        if (registration.addLifeMembership) {
          membershipActivation = await activatePaidLifeMembership(registration._id);
        }
        await Attendance.findOneAndUpdate(
          { registrationId: registration._id },
          {
            $setOnInsert: {
              registrationId: registration._id,
              qrCodeData: registration.registrationNumber,
            },
          },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        emailStatus = await deliverRegistrationConfirmation({
          registrationId: registration._id,
          payment,
          providerPayment: captured,
        });
      }
    } else if (payment.paymentType === 'ACCOMMODATION') {
      const booking = await AccommodationBooking.findById(payment.accommodationBookingId);
      if (!booking) {
        throw new PaymentFinalizationError('Accommodation booking not found for payment', {
          code: 'ACCOMMODATION_BOOKING_NOT_FOUND',
          statusCode: 404,
        });
      }
      targetStatus = 'PAID';
      totalPaid = payment.amount;
      await AccommodationBooking.findByIdAndUpdate(booking._id, {
        $set: {
          paymentStatus: 'PAID',
          bookingStatus: 'CONFIRMED',
          razorpayPaymentId: captured.id,
        },
      });
      emailStatus = await deliverAccommodationConfirmation({ bookingId: booking._id });
    } else {
      throw new PaymentFinalizationError('Unsupported payment type', {
        code: 'UNSUPPORTED_PAYMENT_TYPE',
        statusCode: 400,
      });
    }

    logger.info('payment.finalization.completed', {
      message: `${payment.paymentType} ${razorpayOrderId} finalized from ${source}`,
    });

    return {
      paymentId: captured.id,
      orderId: razorpayOrderId,
      paymentType: payment.paymentType,
      paymentStatus: targetStatus,
      totalPaid,
      emailStatus,
      membershipActivated: Boolean(membershipActivation?.activated),
      membershipStatus: membershipActivation?.status,
      membershipId: membershipActivation?.membershipId,
      alreadyFinalized: payment.status === 'SUCCESS',
    };
  };
};
