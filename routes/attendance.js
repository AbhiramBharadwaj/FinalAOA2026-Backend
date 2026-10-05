import express from 'express';
import QRCode from 'qrcode';
import Registration from '../models/Registration.js';
import Attendance from '../models/Attendance.js';
import jsPDF from 'jspdf';
import { authenticateUser, authenticateAdmin } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import { sendErrorResponse } from '../utils/httpError.js';

const router = express.Router();
const MAX_ENTRY_SCANS = 1;

const getScanSummary = (attendance) => {
  const scanHistory = attendance?.scanHistory || [];
  const firstScan = scanHistory[0];
  const lastScan = scanHistory[scanHistory.length - 1];

  return {
    alreadyScanned: (attendance?.totalScans || 0) >= MAX_ENTRY_SCANS,
    firstScannedAt: firstScan?.scannedAt || null,
    lastScannedAt: lastScan?.scannedAt || null,
  };
};


router.get('/my-qr', authenticateUser, async (req, res) => {
  try {
    logger.debug('attendance.my_qr.start', { requestId: req.requestId, userId: req.user?._id });
    const registration = await Registration.findOne({ 
      userId: req.user._id,
      paymentStatus: 'PAID'
    }).populate('userId', 'name email phone role membershipId');

    if (!registration) {
      return res.status(404).json({ message: 'No paid registration found' });
    }

    let attendance = await Attendance.findOne({ registrationId: registration._id });
    
    if (!attendance) {
      return res.status(404).json({ 
        message: 'QR not generated yet. Please wait or contact support.' 
      });
    }

    const qrUrl = await QRCode.toDataURL(attendance.qrCodeData, {
      width: 512,
      margin: 1,
      color: { dark: '#0d47a1', light: '#ffffff' }
    });

    res.json({
      qrData: attendance.qrCodeData,
      qrUrl,
      registrationNumber: registration.registrationNumber,
      registration: registration,
      totalScans: attendance.totalScans,
    });
  } catch (error) {
    logger.error('attendance.my_qr.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Your QR code could not be loaded. Please try again.');
  }
});


router.post('/generate-qr/:registrationId', authenticateUser, async (req, res) => {
  try {
    logger.info(`${req.actorName || 'User'} is generating a QR code.`);
    const registration = await Registration.findOne({
      _id: req.params.registrationId,
      userId: req.user._id,
      paymentStatus: 'PAID',
    }).populate('userId', 'name email phone role');

    if (!registration) {
      return res.status(404).json({ 
        message: 'Valid paid registration not found' 
      });
    }

    
    let attendance = await Attendance.findOne({ registrationId: registration._id });
    if (attendance) {
      const qrUrl = await QRCode.toDataURL(attendance.qrCodeData, {
        width: 512,
        margin: 1,
        color: { dark: '#0d47a1', light: '#ffffff' }
      });
      logger.info(`${req.actorName || 'User'} already has a QR code.`);
      return res.json({ 
        message: 'QR already generated',
        qrData: attendance.qrCodeData,
        qrUrl,
        attendance 
      });
    }

    
    const qrData = registration.registrationNumber;
    const attendanceData = new Attendance({
      registrationId: registration._id,
      qrCodeData: qrData,
    });
    await attendanceData.save();

    const qrUrl = await QRCode.toDataURL(qrData, {
      width: 512,
      margin: 1,
      color: { dark: '#0d47a1', light: '#ffffff' }
    });

    await attendanceData.populate('registrationId', 'userId registrationNumber registrationType paymentStatus');
    
    logger.info(`${req.actorName || 'User'} generated a QR code successfully.`);
    res.status(201).json({
      message: 'QR code generated successfully',
      qrData,
      qrUrl,
      attendance: attendanceData,
    });
  } catch (error) {
    logger.error('QR code generation failed.', { message: error?.message || error });
    return sendErrorResponse(res, error, 'Your QR code could not be generated. Please confirm that registration payment is complete.');
  }
});


router.get('/', authenticateAdmin, async (req, res) => {
  try {
    logger.info('attendance.list.start', { requestId: req.requestId, adminId: req.admin?._id });
    const attendances = await Attendance.find({ isActive: true })
      .populate({
        path: 'registrationId',
        populate: { 
          path: 'userId', 
          select: 'name email phone role membershipId' 
        }
      })
      .populate('scanHistory.scannedBy', 'name email')
      .sort({ createdAt: -1 });
    
    logger.info('attendance.list.success', { requestId: req.requestId, count: attendances.length });
    res.json(attendances);
  } catch (error) {
    logger.error('attendance.list.error', { requestId: req.requestId, message: error?.message || error });
    return sendErrorResponse(res, error, 'Attendance records could not be loaded. Please try again.');
  }
});


router.get('/qr-download/:attendanceId/:registrationNumber?', authenticateAdmin, async (req, res) => {
  try {
    const { attendanceId, registrationNumber } = req.params;
    let attendance;

    logger.info('attendance.qr_download.start', {
      requestId: req.requestId,
      attendanceId,
      registrationNumber,
      adminId: req.admin?._id,
    });
    if (attendanceId) {
      attendance = await Attendance.findById(attendanceId)
        .populate('registrationId', 'userId registrationNumber');
    } else if (registrationNumber) {
      const reg = await Registration.findOne({ registrationNumber }).populate('userId');
      if (!reg) return res.status(404).json({ message: 'Registration not found' });
      attendance = await Attendance.findOne({ registrationId: reg._id });
    }

    if (!attendance) {
      return res.status(404).json({ message: 'Attendance record not found' });
    }

    const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
      width: 512,
      margin: 2,
      color: { dark: '#0d47a1', light: '#ffffff' }
    });

    const filename = registrationNumber || attendance.registrationId.registrationNumber || 'QR';
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${filename}_QR.png"`,
      'Content-Length': qrBuffer.length
    });
    logger.info('attendance.qr_download.success', {
      requestId: req.requestId,
      attendanceId: attendance._id,
      filename,
    });
    res.send(qrBuffer);
  } catch (error) {
    logger.error('attendance.qr_download.error', {
      requestId: req.requestId,
      attendanceId: req.params.attendanceId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR code could not be generated. Please check the registration and try again.');
  }
});


router.post('/scan/check', authenticateAdmin, async (req, res) => {
  try {
    const { qrCode } = req.body;
    
    if (!qrCode) {
      return res.status(400).json({ message: 'QR code required' });
    }

    logger.info('attendance.scan_check.start', { requestId: req.requestId, adminId: req.admin?._id });
    const attendance = await Attendance.findOne({ 
      qrCodeData: qrCode.trim(),
      isActive: true 
    }).populate({
      path: 'registrationId',
      populate: { 
        path: 'userId', 
        select: 'name email phone role membershipId' 
      }
    });

    if (!attendance) {
      return res.status(404).json({
        message: 'Invalid QR Code',
        reason: 'Registration not found or deactivated'
      });
    }

    if (attendance.registrationId.paymentStatus !== 'PAID') {
      return res.status(400).json({
        message: 'Payment Pending',
        reason: 'Registration payment not completed'
      });
    }

    res.json({
      valid: true,
      qrCode,
      registration: attendance.registrationId,
      totalScans: attendance.totalScans,
      scanHistory: attendance.scanHistory,
      maxScans: MAX_ENTRY_SCANS,
      ...getScanSummary(attendance),
    });
  } catch (error) {
    logger.error('attendance.scan_check.error', {
      requestId: req.requestId,
      adminId: req.admin?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR code could not be validated. Please scan it again.');
  }
});


router.post('/scan/mark', authenticateAdmin, async (req, res) => {
  try {
    const { qrCode, count = 1, location = 'Main Gate', notes = '' } = req.body;
    const normalizedQrCode = qrCode?.trim();
    const scanCount = Number.parseInt(count, 10);

    if (!normalizedQrCode) {
      return res.status(400).json({ message: 'QR code required' });
    }

    if (!Number.isInteger(scanCount) || scanCount !== 1) {
      return res.status(400).json({ message: 'Only one entry can be marked per scan' });
    }
    
    logger.info('attendance.scan_mark.start', { requestId: req.requestId, adminId: req.admin?._id });
    const existingAttendance = await Attendance.findOne({
      qrCodeData: normalizedQrCode,
      isActive: true 
    }).populate({
      path: 'registrationId',
      populate: {
        path: 'userId',
        select: 'name email phone role membershipId',
      },
    });

    if (!existingAttendance) {
      return res.status(404).json({ message: 'Invalid QR Code' });
    }

    if (existingAttendance.registrationId?.paymentStatus !== 'PAID') {
      return res.status(400).json({
        message: 'Payment Pending',
        reason: 'Registration payment not completed',
      });
    }

    if (existingAttendance.totalScans >= MAX_ENTRY_SCANS) {
      return res.status(409).json({
        code: 'ALREADY_CHECKED_IN',
        message: 'This attendee is already checked in',
        registration: existingAttendance.registrationId,
        totalScans: existingAttendance.totalScans,
        remainingScans: 0,
        scanHistory: existingAttendance.scanHistory,
        maxScans: MAX_ENTRY_SCANS,
        ...getScanSummary(existingAttendance),
      });
    }

    const attendance = await Attendance.findOneAndUpdate(
      {
        _id: existingAttendance._id,
        isActive: true,
        totalScans: { $lt: MAX_ENTRY_SCANS },
      },
      {
        $push: {
          scanHistory: {
            scannedAt: new Date(),
            scannedBy: req.admin._id,
            location,
            notes,
            count: scanCount,
          },
        },
        $inc: { totalScans: scanCount },
      },
      { new: true }
    );

    if (!attendance) {
      const latestAttendance = await Attendance.findById(existingAttendance._id).populate({
        path: 'registrationId',
        populate: {
          path: 'userId',
          select: 'name email phone role membershipId',
        },
      });

      return res.status(409).json({
        code: 'ALREADY_CHECKED_IN',
        message: 'This attendee is already checked in',
        registration: latestAttendance.registrationId,
        totalScans: latestAttendance.totalScans,
        remainingScans: 0,
        scanHistory: latestAttendance.scanHistory,
        maxScans: MAX_ENTRY_SCANS,
        ...getScanSummary(latestAttendance),
      });
    }

    await attendance.populate([
      {
        path: 'registrationId',
        populate: {
          path: 'userId',
          select: 'name email phone role membershipId',
        },
      },
      { path: 'scanHistory.scannedBy', select: 'name email' }
    ]);

    logger.info('attendance.scan_mark.success', {
      requestId: req.requestId,
      attendanceId: attendance._id,
      totalScans: attendance.totalScans,
    });
    res.json({
      message: 'Entry marked successfully',
      attendanceId: attendance._id,
      totalScans: attendance.totalScans,
      remainingScans: Math.max(0, MAX_ENTRY_SCANS - attendance.totalScans),
      registration: attendance.registrationId,
      scanHistory: attendance.scanHistory,
      maxScans: MAX_ENTRY_SCANS,
      ...getScanSummary(attendance),
    });
  } catch (error) {
    logger.error('attendance.scan_mark.error', {
      requestId: req.requestId,
      adminId: req.admin?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Attendance could not be marked. Please scan the QR code again.');
  }
});

router.post('/scan/revert', authenticateAdmin, async (req, res) => {
  try {
    const { qrCode } = req.body;
    const normalizedQrCode = qrCode?.trim();

    if (!normalizedQrCode) {
      return res.status(400).json({ message: 'QR code required' });
    }

    logger.info('attendance.scan_revert.start', { requestId: req.requestId, adminId: req.admin?._id });
    const attendance = await Attendance.findOneAndUpdate(
      {
        qrCodeData: normalizedQrCode,
        isActive: true,
        totalScans: { $gt: 0 },
      },
      {
        $set: { totalScans: 0, scanHistory: [] },
      },
      { new: true }
    ).populate({
      path: 'registrationId',
      populate: {
        path: 'userId',
        select: 'name email phone role membershipId',
      },
    });

    if (!attendance) {
      return res.status(409).json({
        code: 'NO_SCAN_TO_REVERT',
        message: 'There is no marked entry to undo for this QR',
      });
    }

    logger.info('attendance.scan_revert.success', {
      requestId: req.requestId,
      attendanceId: attendance._id,
    });
    res.json({
      message: 'Entry scan undone',
      attendanceId: attendance._id,
      registration: attendance.registrationId,
      totalScans: attendance.totalScans,
      remainingScans: MAX_ENTRY_SCANS,
      scanHistory: attendance.scanHistory,
      maxScans: MAX_ENTRY_SCANS,
      ...getScanSummary(attendance),
    });
  } catch (error) {
    logger.error('attendance.scan_revert.error', {
      requestId: req.requestId,
      adminId: req.admin?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Attendance scan could not be undone. Please try again.');
  }
});









router.get('/qr-download/:registrationId', authenticateAdmin, async (req, res) => {
  try {
    logger.info('attendance.qr_download_legacy.start', {
      requestId: req.requestId,
      registrationId: req.params.registrationId,
      adminId: req.admin?._id,
    });
    const registration = await Registration.findById(req.params.registrationId);
    if (!registration) {
      return res.status(404).json({ message: 'Registration not found' });
    }

    const attendance = await Attendance.findOne({ registrationId: registration._id });
    if (!attendance) {
      return res.status(404).json({ message: 'QR not generated yet' });
    }

    
    const qrBuffer = await QRCode.toBuffer(attendance.qrCodeData, {
      width: 512,
      height: 512,
      margin: 2,
      color: { 
        dark: '#0d47a1', 
        light: '#ffffff' 
      }
    });

    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `attachment; filename="${registration.registrationNumber}_AOA_QR.png"`,
      'Content-Length': qrBuffer.length,
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache'
    });

    logger.info('attendance.qr_download_legacy.success', {
      requestId: req.requestId,
      registrationId: registration._id,
    });
    res.send(qrBuffer);
  } catch (error) {
    logger.error('attendance.qr_download_legacy.error', {
      requestId: req.requestId,
      registrationId: req.params.registrationId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR code could not be generated. Please check the registration and try again.');
  }
});


router.get('/my-qr', authenticateUser, async (req, res) => {
  try {
    logger.debug('attendance.my_qr_legacy.start', { requestId: req.requestId, userId: req.user?._id });
    const registration = await Registration.findOne({ 
      userId: req.user._id, 
      paymentStatus: 'PAID' 
    }).populate('userId', 'name email phone');

    if (!registration) {
      return res.status(404).json({ message: 'No paid registration found' });
    }

    const attendance = await Attendance.findOne({ registrationId: registration._id });
    if (!attendance) {
      return res.status(404).json({ message: 'QR not generated yet' });
    }

    
    const qrDataUrl = await QRCode.toDataURL(attendance.qrCodeData, {
      width: 512,
      margin: 1,
      color: { dark: '#0d47a1', light: '#ffffff' }
    });

    logger.debug('attendance.my_qr_legacy.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: registration._id,
    });
    res.json({
      qrData: attendance.qrCodeData,
      qrUrl: qrDataUrl,
      registrationNumber: registration.registrationNumber,
      totalScans: attendance.totalScans
    });
  } catch (error) {
    logger.error('attendance.my_qr_legacy.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR code could not be loaded. Please check the registration and try again.');
  }
});


router.post('/generate-qr/:registrationId', authenticateUser, async (req, res) => {
  try {
    logger.info('attendance.generate_qr_legacy.start', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: req.params.registrationId,
    });
    const registration = await Registration.findOne({
      _id: req.params.registrationId,
      userId: req.user._id,
      paymentStatus: 'PAID'
    });

    if (!registration) {
      return res.status(404).json({ message: 'Paid registration not found' });
    }

    let attendance = await Attendance.findOne({ registrationId: registration._id });
    if (attendance) {
      const qrUrl = await QRCode.toDataURL(attendance.qrCodeData, { width: 512 });
      logger.info('attendance.generate_qr_legacy.already_exists', {
        requestId: req.requestId,
        userId: req.user?._id,
        registrationId: registration._id,
      });
      return res.json({ 
        message: 'QR already exists',
        qrData: attendance.qrCodeData, 
        qrUrl 
      });
    }

    attendance = new Attendance({
      registrationId: registration._id,
      qrCodeData: registration.registrationNumber
    });
    await attendance.save();

    const qrUrl = await QRCode.toDataURL(registration.registrationNumber, { width: 512 });
    
    logger.info('attendance.generate_qr_legacy.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: registration._id,
      attendanceId: attendance._id,
    });
    res.json({ 
      message: 'QR generated successfully',
      qrData: registration.registrationNumber, 
      qrUrl 
    });
  } catch (error) {
    logger.error('attendance.generate_qr_legacy.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: req.params.registrationId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR code could not be generated. Please check the registration and try again.');
  }
});


router.get('/qr-bulk-pdf', authenticateAdmin, async (req, res) => {
  try {
    const { registrationIds } = req.query;
    if (!registrationIds) {
      return res.status(400).json({ message: 'Registration IDs required' });
    }

    logger.info('attendance.qr_bulk_pdf.start', {
      requestId: req.requestId,
      adminId: req.admin?._id,
    });
    const ids = registrationIds.split(',');
    const registrations = await Registration.find({
      _id: { $in: ids }
    }).populate('userId', 'name');

    const attendances = await Attendance.find({
      registrationId: { $in: registrations.map(r => r._id) }
    });

    const doc = new jsPDF('a4', 'mm');
    let yPos = 25;

    
    doc.setFontSize(18);
    doc.text(`AOA Shivamogga 2026 - QR Sheet (${ids.length} QRs)`, 105, yPos, { align: 'center' });
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 105, yPos + 8, { align: 'center' });
    yPos += 25;

    
    const qrSize = 42; 
    const margin = 12;
    
    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i];
      const attendance = attendances.find(a => a.registrationId.toString() === reg._id.toString());
      if (!attendance) continue;

      const row = Math.floor(i / 4);
      const col = i % 4;
      const xPos = margin + col * (qrSize + 8);
      const rowY = yPos + row * (qrSize + 25);

      if (rowY + qrSize > 270) { 
        doc.addPage();
        yPos = 25;
        continue;
      }

      
      const qrDataUrl = await QRCode.toDataURL(attendance.qrCodeData, {
        width: qrSize * 3, 
        margin: 1
      });

      
      doc.addImage(qrDataUrl, 'PNG', xPos, rowY, qrSize, qrSize);

      
      doc.setFontSize(10);
      doc.setTextColor(0);
      doc.text(reg.registrationNumber, xPos, rowY + qrSize + 4, { maxWidth: qrSize });
      doc.setFontSize(8);
      doc.text(reg.userId?.name?.substring(0, 25) || 'N/A', xPos, rowY + qrSize + 10, { maxWidth: qrSize });
    }

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="AOA_QR_Sheet_${Date.now()}.pdf"`,
      'Cache-Control': 'no-cache'
    });
    
    logger.info('attendance.qr_bulk_pdf.success', {
      requestId: req.requestId,
      count: registrations.length,
    });
    res.send(doc.output('arraybuffer'));
  } catch (error) {
    logger.error('attendance.qr_bulk_pdf.error', {
      requestId: req.requestId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'QR PDF could not be generated. Please try again.');
  }
});


router.get('/qr-details/:registrationId', authenticateAdmin, async (req, res) => {
  try {
    logger.info('attendance.qr_details.start', {
      requestId: req.requestId,
      registrationId: req.params.registrationId,
      adminId: req.admin?._id,
    });
    const registration = await Registration.findById(req.params.registrationId)
      .populate('userId', 'name email phone role membershipId');
    
    const attendance = await Attendance.findOne({ registrationId: req.params.registrationId });

    if (!registration || !attendance) {
      return res.status(404).json({ message: 'Data not found' });
    }

    const qrUrl = await QRCode.toDataURL(attendance.qrCodeData, { width: 512 });
    
    logger.info('attendance.qr_details.success', {
      requestId: req.requestId,
      registrationId: registration._id,
    });
    res.json({
      registration,
      attendance,
      qrUrl,
      qrData: attendance.qrData
    });
  } catch (error) {
    logger.error('attendance.qr_details.error', {
      requestId: req.requestId,
      registrationId: req.params.registrationId,
      message: error?.message || error,
    });
    return sendErrorResponse(res, error, 'Attendance details could not be loaded. Please try again.');
  }
});

export default router;
