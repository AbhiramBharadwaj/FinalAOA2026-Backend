import dotenv from 'dotenv';
import mongoose from 'mongoose';
import QRCode from 'qrcode';
import fs from 'fs';
import path from 'path';
import Registration from '../models/Registration.js';
import Attendance from '../models/Attendance.js';
import '../models/User.js';

dotenv.config();

const DEFAULT_MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  'mongodb+srv://bhaskarAntoty123:MQEJ1W9gtKD547hy@bhaskarantony.wagpkay.mongodb.net/AOA1?retryWrites=true&w=majority';

const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  return args[index + 1] ?? fallback;
};

const hasFlag = (name) => args.includes(name);

const padRegistration = (value) => `AOA2026-${String(value).padStart(4, '0')}`;

const parseNumber = (value) => {
  if (!value) return null;
  const match = String(value).match(/(\d+)$/);
  return match ? Number(match[1]) : Number(value);
};

const buildPackageLabel = (registration) => {
  const labels = [];
  if (registration?.addWorkshop || registration?.selectedWorkshop) labels.push('Workshop');
  if (registration?.addAoaCourse) labels.push('AOA Certified Course');
  if (registration?.addLifeMembership) labels.push('AOA Life Membership');
  return labels.length ? `Conference + ${labels.join(' + ')}` : 'Conference Only';
};

const formatDate = (date) =>
  date
    ? new Date(date).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : '';

const loadExcelJS = async () => {
  try {
    return (await import('exceljs')).default;
  } catch {
    throw new Error(
      'Missing dependency: exceljs. Install once with `npm install exceljs`, then rerun this script.'
    );
  }
};

const getTargetRegistrationNumbers = () => {
  const from = parseNumber(getArg('--from'));
  const to = parseNumber(getArg('--to'));
  if (!from && !to) return null;
  if (!from || !to || from > to) {
    throw new Error('Use --from and --to with a valid range, e.g. --from 1 --to 25');
  }
  return Array.from({ length: to - from + 1 }, (_, index) => padRegistration(from + index));
};

const getRegistrations = async () => {
  const registrationNumbers = getTargetRegistrationNumbers();
  const query = { paymentStatus: 'PAID' };
  if (registrationNumbers) query.registrationNumber = { $in: registrationNumbers };

  const registrations = await Registration.find(query)
    .populate('userId', 'name email phone role membershipId')
    .sort({ registrationNumber: 1 })
    .lean();

  if (!registrationNumbers) return registrations;

  const byNumber = new Map(registrations.map((registration) => [registration.registrationNumber, registration]));
  return registrationNumbers.map((registrationNumber) => byNumber.get(registrationNumber) || {
    registrationNumber,
    missing: true,
  });
};

const getAttendanceByRegistrationId = async (registrations) => {
  const ids = registrations.filter((registration) => !registration.missing).map((registration) => registration._id);
  const attendances = await Attendance.find({ registrationId: { $in: ids } }).lean();
  return new Map(attendances.map((attendance) => [String(attendance.registrationId), attendance]));
};

const addHeader = (worksheet) => {
  worksheet.columns = [
    { header: 'Registration No', key: 'registrationNumber', width: 18 },
    { header: 'QR Code', key: 'qr', width: 24 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Email', key: 'email', width: 34 },
    { header: 'Role', key: 'role', width: 12 },
    { header: 'Package', key: 'package', width: 36 },
    { header: 'Workshop', key: 'workshop', width: 22 },
    { header: 'Amount Paid', key: 'amountPaid', width: 16 },
    { header: 'Payment', key: 'paymentStatus', width: 12 },
    { header: 'QR Status', key: 'qrStatus', width: 14 },
    { header: 'Checked In', key: 'checkedIn', width: 14 },
    { header: 'Total Scans', key: 'totalScans', width: 12 },
    { header: 'Created At', key: 'createdAt', width: 22 },
  ];

  const header = worksheet.getRow(1);
  header.height = 32;
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF9C3253' },
    };
  });
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
  worksheet.autoFilter = 'A1:N1';
};

const addRegistrationRow = async ({ workbook, worksheet, registration, attendance, rowNumber }) => {
  if (registration.missing) {
    const row = worksheet.addRow({
      registrationNumber: registration.registrationNumber,
      name: 'NOT FOUND',
      package: 'No paid registration record found',
      paymentStatus: 'N/A',
      qrStatus: 'Missing',
      checkedIn: 'N/A',
    });
    row.height = 118;
    row.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5E5' } };
      cell.font = { bold: true, color: { argb: 'FF8B0000' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    return;
  }

  const user = registration.userId || {};
  const qrData = attendance?.qrCodeData || registration.registrationNumber;
  const totalScans = attendance?.totalScans || 0;
  const checkedIn = totalScans > 0 ? 'Yes' : 'No';

  const row = worksheet.addRow({
    registrationNumber: registration.registrationNumber,
    name: user.name || '',
    phone: user.phone || '',
    email: user.email || '',
    role: user.role || '',
    package: buildPackageLabel(registration),
    workshop: registration.selectedWorkshop || '',
    amountPaid: Number(registration.totalPaid || registration.totalAmount || 0),
    paymentStatus: registration.paymentStatus || '',
    qrStatus: attendance?.qrCodeData ? 'Generated' : 'Generated from registration no',
    checkedIn,
    totalScans,
    createdAt: formatDate(registration.createdAt),
  });

  row.height = 118;
  row.eachCell((cell) => {
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  row.getCell('I').numFmt = '₹#,##0';

  const qrBuffer = await QRCode.toBuffer(qrData, {
    width: 512,
    margin: 2,
    color: { dark: '#0d47a1', light: '#ffffff' },
  });
  const imageId = workbook.addImage({
    buffer: qrBuffer,
    extension: 'png',
  });
  worksheet.addImage(imageId, {
    tl: { col: 1.18, row: rowNumber - 0.84 },
    ext: { width: 110, height: 110 },
    editAs: 'oneCell',
  });
};

const main = async () => {
  const ExcelJS = await loadExcelJS();
  const output = getArg('--out', path.resolve('reports', 'aoacon-offline-list.xlsx'));
  const mongoUri = getArg('--mongo-uri', DEFAULT_MONGODB_URI);

  await mongoose.connect(mongoUri);
  const registrations = await getRegistrations();
  const attendanceByRegistrationId = await getAttendanceByRegistrationId(registrations);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AOACON Backend';
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet('Offline List', {
    properties: { defaultRowHeight: 118 },
    pageSetup: {
      paperSize: 9,
      orientation: 'landscape',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
    },
  });

  addHeader(worksheet);

  for (const registration of registrations) {
    const rowNumber = worksheet.rowCount + 1;
    const attendance = registration.missing
      ? null
      : attendanceByRegistrationId.get(String(registration._id));
    await addRegistrationRow({ workbook, worksheet, registration, attendance, rowNumber });
  }

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      };
    });
  });

  fs.mkdirSync(path.dirname(output), { recursive: true });
  await workbook.xlsx.writeFile(output);
  await mongoose.disconnect();

  console.log(`Created ${output}`);
  console.log(`Rows: ${registrations.length}`);
  if (hasFlag('--open-note')) {
    console.log('Upload this XLSX to Google Drive and open with Google Sheets, or use directly offline.');
  }
};

main().catch(async (error) => {
  try {
    await mongoose.disconnect();
  } catch {
    // Ignore disconnect failures on startup errors.
  }
  console.error(error.message || error);
  process.exit(1);
});
