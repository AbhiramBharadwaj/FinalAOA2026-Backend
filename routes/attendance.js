import express from 'express';
import QRCode from 'qrcode';
import Registration from '../models/Registration.js';
import Attendance from '../models/Attendance.js';
import jsPDF from 'jspdf';
import { authenticateUser, authenticateAdmin } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();


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
    res.status(500).json({ message: 'Failed to fetch QR code' });
  }
});


router.post('/generate-qr/:registrationId', authenticateUser, async (req, res) => {
  try {
    logger.info('attendance.generate_qr.start', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: req.params.registrationId,
    });
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
      logger.info('attendance.generate_qr.already_exists', {
        requestId: req.requestId,
        userId: req.user?._id,
        registrationId: registration._id,
      });
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
    
    logger.info('attendance.generate_qr.success', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: registration._id,
      attendanceId: attendanceData._id,
    });
    res.status(201).json({
      message: 'QR code generated successfully',
      qrData,
      qrUrl,
      attendance: attendanceData,
    });
  } catch (error) {
    logger.error('attendance.generate_qr.error', {
      requestId: req.requestId,
      userId: req.user?._id,
      registrationId: req.params.registrationId,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Failed to generate QR code' });
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
    res.status(500).json({ message: 'Failed to fetch attendance records' });
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
    res.status(500).json({ message: 'QR generation failed' });
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
      maxScans: 10, 
    });
  } catch (error) {
    logger.error('attendance.scan_check.error', {
      requestId: req.requestId,
      adminId: req.admin?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Scan validation failed' });
  }
});


router.post('/scan/mark', authenticateAdmin, async (req, res) => {
  try {
    const { qrCode, count = 1, location = 'Main Gate', notes = '' } = req.body;
    
    logger.info('attendance.scan_mark.start', { requestId: req.requestId, adminId: req.admin?._id });
    const attendance = await Attendance.findOne({ 
      qrCodeData: qrCode.trim(),
      isActive: true 
    });

    if (!attendance) {
      return res.status(404).json({ message: 'Invalid QR Code' });
    }

    
    attendance.scanHistory.push({
      scannedAt: new Date(),
      scannedBy: req.admin._id,
      location,
      notes,
      count: parseInt(count),
    });
    attendance.totalScans += parseInt(count);
    await attendance.save();

    await attendance.populate([
      { path: 'registrationId', select: 'userId registrationNumber registrationType' },
      { path: 'scanHistory.scannedBy', select: 'name email' }
    ]);

    logger.info('attendance.scan_mark.success', {
      requestId: req.requestId,
      attendanceId: attendance._id,
      totalScans: attendance.totalScans,
    });
    res.json({
      message: `${count} entry(s) marked successfully`,
      totalScans: attendance.totalScans,
      remainingScans: 10 - attendance.totalScans, 
      registration: attendance.registrationId,
      scanHistory: attendance.scanHistory,
    });
  } catch (error) {
    logger.error('attendance.scan_mark.error', {
      requestId: req.requestId,
      adminId: req.admin?._id,
      message: error?.message || error,
    });
    res.status(500).json({ message: 'Failed to mark attendance' });
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
    res.status(500).json({ message: 'QR generation failed' });
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
    res.status(500).json({ message: 'QR fetch failed' });
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
    res.status(500).json({ message: 'QR generation failed' });
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
    res.status(500).json({ message: 'PDF generation failed' });
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
    res.status(500).json({ message: 'Details fetch failed' });
  }
});

export default router;
