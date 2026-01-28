import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import User from '../models/User.js';
import Registration from '../models/Registration.js';
import Attendance from '../models/Attendance.js';
import Payment from '../models/Payment.js';
import Counter from '../models/Counter.js';
import { calculateRegistrationTotals, getBookingPhase } from '../utils/pricing.js';
import { buildRegistrationInvoicePdf } from '../utils/invoice.js';
import { sendPasswordResetEmail, sendPaymentSuccessEmail } from '../utils/email.js';

dotenv.config();

const DEFAULT_DB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  "mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority";

const ROLE_VALUES = new Set(['AOA', 'NON_AOA', 'PGS']);
const WORKSHOP_OPTIONS = [
  { key: 'labour-analgesia', aliases: ['labour', 'labor', 'analgesia'] },
  { key: 'critical-incidents', aliases: ['critical', 'incident'] },
  { key: 'pocus', aliases: ['pocus'] },
  { key: 'maternal-collapse', aliases: ['maternal', 'collapse'] },
];

const normalizeHeader = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseDelimitedLine = (line, delimiter) => {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      const nextChar = line[i + 1];
      if (inQuotes && nextChar === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === delimiter && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
};

const parseDelimitedFile = (content) => {
  const lines = content.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = parseDelimitedLine(lines[0], delimiter);
  const rows = lines.slice(1).map((line) => parseDelimitedLine(line, delimiter));
  return { headers, rows, delimiter };
};

const findColumnIndex = (headers, aliases) => {
  const normalized = headers.map((header) => normalizeHeader(header));
  for (const alias of aliases) {
    const aliasKey = normalizeHeader(alias);
    const index = normalized.indexOf(aliasKey);
    if (index !== -1) return index;
  }
  return -1;
};

const mapHeaders = (headers) => {
  return {
    timestamp: findColumnIndex(headers, ['timestamp', 'date', 'time']),
    name: findColumnIndex(headers, ['fullname', 'name']),
    utr: findColumnIndex(headers, ['utrtransactionid', 'utr', 'transactionid']),
    institution: findColumnIndex(headers, ['institutionaffiliation', 'institution', 'affiliation']),
    address: findColumnIndex(headers, ['address']),
    city: findColumnIndex(headers, ['city']),
    state: findColumnIndex(headers, ['state']),
    pincode: findColumnIndex(headers, ['pincode', 'zip', 'zipcode', 'postalcode']),
    country: findColumnIndex(headers, ['country']),
    medicalCouncilName: findColumnIndex(headers, ['nameofmedicalcouncil', 'medicalcouncilname']),
    medicalCouncilNumber: findColumnIndex(headers, ['medicalcouncilregistrationnumber', 'medicalcouncilnumber']),
    phone: findColumnIndex(headers, ['phoneno', 'phone', 'mobile']),
    email: findColumnIndex(headers, ['emailid', 'email']),
    packageType: findColumnIndex(headers, ['conferenceconferenceworkshop', 'package', 'registrationtype']),
    role: findColumnIndex(headers, ['role', 'category', 'membertype', 'column14']),
    workshop: findColumnIndex(headers, ['workshop', 'selectedworkshop']),
    amountPaid: findColumnIndex(headers, ['amountpaid', 'paidamount', 'amount']),
  };
};

const normalizeRole = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  const lower = trimmed.toLowerCase();
  if (lower === 'aoa' || lower === 'aoa member') return 'AOA';
  if (lower === 'non-aoa' || lower === 'non aoa' || lower === 'non_aoa' || lower === 'non-aoa member') {
    return 'NON_AOA';
  }
  if (lower === 'pgs' || lower === 'pgs & fellows' || lower === 'pgs and fellows') return 'PGS';
  return ROLE_VALUES.has(trimmed) ? trimmed : null;
};

const normalizePhone = (value) => {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  return digits || null;
};

const parsePackage = (value) => {
  const text = String(value || '').toLowerCase();
  return {
    addWorkshop: text.includes('workshop'),
    addAoaCourse: text.includes('aoa certified'),
    addLifeMembership: text.includes('life membership') || text.includes('combo'),
  };
};

const resolveWorkshop = (value) => {
  if (!value) return null;
  const text = String(value).toLowerCase();
  for (const option of WORKSHOP_OPTIONS) {
    if (option.aliases.some((alias) => text.includes(alias))) {
      return option.key;
    }
  }
  return null;
};

const buildManualOrderId = (utr, registrationNumber) => {
  const base = utr ? `upi_${utr}` : `upi_${registrationNumber}`;
  return base.replace(/\s+/g, '_');
};

const createResetToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  return { rawToken, tokenHash, expiresAt };
};

const getResetLink = (email) => {
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const { rawToken, tokenHash, expiresAt } = createResetToken();
  const link = `${frontendUrl}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;
  return { link, tokenHash, expiresAt };
};

const shouldSkipEmail = (flags) => !flags.sendEmail;

const parseArgs = () => {
  const args = process.argv.slice(2);
  const options = {
    file: null,
    startSeq: 1,
    apply: false,
    sendEmail: false,
    syncCounter: false,
    defaultRole: 'NON_AOA',
    bookingPhase: null,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--file') options.file = args[i + 1];
    if (arg === '--start-seq') options.startSeq = Number(args[i + 1] || 1);
    if (arg === '--apply') options.apply = true;
    if (arg === '--send-email') options.sendEmail = true;
    if (arg === '--sync-counter') options.syncCounter = true;
    if (arg === '--default-role') options.defaultRole = args[i + 1] || 'NON_AOA';
    if (arg === '--booking-phase') options.bookingPhase = args[i + 1];
  }
  return options;
};

const main = async () => {
  const options = parseArgs();
  if (!options.file) {
    console.error('Missing --file path to TSV/CSV.');
    process.exit(1);
  }

  const filePath = path.resolve(process.cwd(), options.file);
  const raw = fs.readFileSync(filePath, 'utf8');
  const { headers, rows, delimiter } = parseDelimitedFile(raw);
  if (!headers.length) {
    console.error('Input file has no header row.');
    process.exit(1);
  }

  const indices = mapHeaders(headers);
  const bookingPhase = options.bookingPhase || getBookingPhase();

  if (!options.apply) {
    console.log('Running in DRY RUN mode. Use --apply to write changes.');
  }
  console.log(`Detected delimiter: ${delimiter === '\t' ? 'TAB' : 'COMMA'}`);
  console.log(`Using booking phase: ${bookingPhase}`);

  await mongoose.connect(DEFAULT_DB_URI);

  let sequence = Number(options.startSeq) || 1;
  let processed = 0;
  let skipped = 0;

  for (const row of rows) {
    const getValue = (index) => (index >= 0 ? row[index] : '');

    const name = getValue(indices.name);
    const email = getValue(indices.email)?.toLowerCase().trim();
    const phone = normalizePhone(getValue(indices.phone));
    const packageRaw = getValue(indices.packageType);
    const workshopRaw = getValue(indices.workshop);
    const roleRaw = getValue(indices.role);
    const utr = getValue(indices.utr);
    const amountPaidRaw = getValue(indices.amountPaid);

    if (!name || !email || !phone) {
      console.warn(`Skipping row (missing name/email/phone): ${name || ''} ${email || ''}`);
      skipped += 1;
      continue;
    }

    let role = normalizeRole(roleRaw);
    if (!role) role = normalizeRole(options.defaultRole) || 'NON_AOA';

    const packageInfo = parsePackage(packageRaw);
    const selectedWorkshop = resolveWorkshop(workshopRaw);

    if (packageInfo.addWorkshop && !selectedWorkshop) {
      console.warn(`Skipping ${email}: workshop selected but no workshop value provided.`);
      skipped += 1;
      continue;
    }

    const pricingTotals = calculateRegistrationTotals(role, bookingPhase, {
      addWorkshop: packageInfo.addWorkshop,
      addAoaCourse: packageInfo.addAoaCourse,
      addLifeMembership: packageInfo.addLifeMembership,
    });

    if (!pricingTotals || pricingTotals.packageBase <= 0) {
      console.warn(`Skipping ${email}: pricing unavailable for role ${role}.`);
      skipped += 1;
      continue;
    }

    const accompanyingBase = 0;
    const totalBase = pricingTotals.packageBase + accompanyingBase;
    const totalGST = Math.round(totalBase * 0.18);
    const subtotalWithGST = totalBase + totalGST;
    const processingFee = Math.round(subtotalWithGST * 0.0195);
    const finalAmount = subtotalWithGST + processingFee;
    const totalAmount = Number(amountPaidRaw) > 0 ? Number(amountPaidRaw) : finalAmount;

    const registrationNumber = `AOA2026-${String(sequence).padStart(4, '0')}`;
    sequence += 1;

    const userPayload = {
      name: name.trim(),
      email,
      phone,
      role,
      instituteHospital: getValue(indices.institution) || undefined,
      address: getValue(indices.address) || undefined,
      city: getValue(indices.city) || undefined,
      state: getValue(indices.state) || undefined,
      pincode: getValue(indices.pincode) || undefined,
      country: getValue(indices.country) || undefined,
      medicalCouncilName: getValue(indices.medicalCouncilName) || undefined,
      medicalCouncilNumber: getValue(indices.medicalCouncilNumber) || undefined,
      isActive: true,
      isVerified: true,
      isProfileComplete: true,
    };

    const registrationPayload = {
      registrationType: packageInfo.addWorkshop ? 'WORKSHOP_CONFERENCE' : 'CONFERENCE_ONLY',
      addWorkshop: packageInfo.addWorkshop,
      selectedWorkshop: packageInfo.addWorkshop ? selectedWorkshop : null,
      workshopAddOn: pricingTotals.workshopAddOn,
      accompanyingPersons: 0,
      accompanyingBase,
      accompanyingGST: 0,
      addAoaCourse: packageInfo.addAoaCourse,
      aoaCourseBase: pricingTotals.aoaCourseAddOn,
      aoaCourseGST:
        pricingTotals.aoaCourseAddOn > 0 ? Math.round(pricingTotals.aoaCourseAddOn * 0.18) : 0,
      addLifeMembership: packageInfo.addLifeMembership,
      lifeMembershipBase: pricingTotals.lifeMembershipAddOn,
      bookingPhase,
      basePrice: pricingTotals.basePrice,
      packageBase: pricingTotals.packageBase,
      packageGST: pricingTotals.gst,
      totalBase,
      totalGST,
      subtotalWithGST,
      processingFee,
      totalAmount,
      totalPaid: totalAmount,
      paymentStatus: 'PAID',
      registrationNumber,
      razorpayPaymentId: utr || undefined,
      razorpayOrderId: buildManualOrderId(utr, registrationNumber),
    };

    if (!options.apply) {
      console.log(`[DRY RUN] ${email} -> ${registrationNumber} (${role})`);
      processed += 1;
      continue;
    }

    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    let user;
    if (existingUser) {
      Object.assign(existingUser, userPayload);
      if (!existingUser.password) {
        existingUser.password = crypto.randomBytes(10).toString('hex');
      }
      user = await existingUser.save();
    } else {
      const tempPassword = crypto.randomBytes(10).toString('hex');
      user = await User.create({ ...userPayload, password: tempPassword });
    }

    let registration = await Registration.findOne({ userId: user._id });
    if (registration) {
      Object.assign(registration, registrationPayload);
      registration = await registration.save();
    } else {
      registration = await Registration.create({
        userId: user._id,
        ...registrationPayload,
      });
    }

    let attendance = await Attendance.findOne({ registrationId: registration._id });
    if (!attendance) {
      attendance = await Attendance.create({
        registrationId: registration._id,
        qrCodeData: registration.registrationNumber,
      });
    }

    await Payment.create({
      userId: user._id,
      registrationId: registration._id,
      amount: totalAmount,
      currency: 'INR',
      status: 'SUCCESS',
      paymentType: 'REGISTRATION',
      razorpayOrderId: registrationPayload.razorpayOrderId,
      razorpayPaymentId: utr || undefined,
    });

    if (!shouldSkipEmail(options)) {
      const { link, tokenHash, expiresAt } = getResetLink(email);
      user.resetPasswordToken = tokenHash;
      user.resetPasswordExpires = expiresAt;
      await user.save();

      await sendPasswordResetEmail({
        email: user.email,
        name: user.name,
        resetLink: link,
        isAdmin: false,
      });

      const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
        width: 512,
        margin: 1,
        color: { dark: '#005aa9', light: '#ffffff' },
      });
      const invoiceBuffer = buildRegistrationInvoicePdf(registration, user, {
        paymentId: registration.razorpayPaymentId || 'Manual',
        paidAt: registration.updatedAt || new Date(),
      });

      await sendPaymentSuccessEmail({
        user,
        subject: `AOACON 2026 Payment Successful - ${registration.registrationNumber}`,
        summaryLines: [
          `Registration No: ${registration.registrationNumber || 'N/A'}`,
          `Package: ${registration.registrationType || 'N/A'}`,
          `Amount Paid: INR ${Number(totalAmount || 0).toLocaleString('en-IN')}`,
          'Payment Status: PAID',
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
    }

    processed += 1;
  }

  if (options.apply && options.syncCounter) {
    const maxReg = await Registration.findOne({ registrationNumber: { $regex: /^AOA2026-\d+$/ } })
      .sort({ registrationNumber: -1 })
      .lean();
    if (maxReg?.registrationNumber) {
      const maxSeq = Number(String(maxReg.registrationNumber).split('-')[1]) || 0;
      await Counter.findOneAndUpdate(
        { name: 'registrationNumber' },
        { seq: maxSeq },
        { upsert: true, new: true }
      );
      console.log(`Counter synced to ${maxSeq}.`);
    }
  }

  console.log(`Processed: ${processed}, Skipped: ${skipped}`);
  await mongoose.disconnect();
};

main().catch((error) => {
  console.error('Backfill failed:', error);
  process.exit(1);
});
