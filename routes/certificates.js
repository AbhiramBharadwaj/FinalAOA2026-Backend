import express from 'express';
import { randomUUID, randomBytes } from 'node:crypto';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { certificateRepositories } from '../services/certificateRepository.js';
import { authenticateAdmin } from '../middleware/auth.js';
import { sendEmail } from '../utils/email.js';
import { certificateStorage } from '../services/certificateStorage.js';
import { boundedText, emailIsValid, searchFilter, publicCertificate, certificateEmail,
  normalizeCertificateName, personKey, certificateCategories, fileType, escapeHtml } from '../utils/certificatePortal.js';

const limit = (count, minutes) => rateLimit({ windowMs: minutes * 60000, limit: count,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { message: 'Too many requests. Please wait before trying again.' } });
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 12 } });
const idIsValid = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{10,80}$/.test(id);
const invalid = message => Object.assign(new Error(message), { status: 400 });
const issueKinds = ['name', 'role', 'missing', 'workshop', 'email', 'other'];
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createCertificateRouter({ certs = certificateRepositories.certs, queries = certificateRepositories.queries,
  deliveries = certificateRepositories.deliveries, adminAuth = authenticateAdmin, mail = sendEmail,
  storage = certificateStorage, enabled = () => process.env.CERTIFICATE_PORTAL_ENABLED === 'true',
  limiters = true } = {}) {
  const router = express.Router();
  router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  const enabledOnly = (req, res, next) => enabled() ? next() : res.status(503).json({ message: 'The certificate portal is being prepared. Please check back soon.' });
  router.get('/config', (req, res) => res.json({ enabled: enabled(), categories: certificateCategories }));
  router.get('/search', ...(limiters ? [limit(60, 15)] : []), enabledOnly, wrap(async (req, res) => {
    const filter = searchFilter(req.query.q);
    const hits = await certs.find(filter).select('personKey').limit(101).lean();
    const keys = [...new Set(hits.map(c => c.personKey))].slice(0, 20);
    if (!keys.length) return res.json({ people: [], message: 'No record found for the details entered. Please check your spelling or registration number, or submit a query.' });
    const rows = await certs.find({ personKey: { $in: keys }, published: true }).lean();
    const people = keys.map(key => {
      let items = rows.filter(row => row.personKey === key);
      // A corrected conference faculty certificate replaces that person's delegate certificate.
      if (items.some(c => c.category === 'conference' && c.role.toLowerCase() === 'faculty')) {
        items = items.filter(c => c.category !== 'conference' || c.role.toLowerCase() !== 'delegate');
      }
      return { name: items[0]?.name, certificates: items.map(publicCertificate) };
    }).filter(p => p.certificates.length);
    res.json({ people, truncated: hits.length > 100 || new Set(hits.map(c => c.personKey)).size > 20 });
  }));
  router.get('/:id/download', ...(limiters ? [limit(60, 15)] : []), enabledOnly, wrap(async (req, res) => {
    if (!idIsValid(req.params.id)) throw invalid('Invalid certificate.');
    const row = await certs.findOne({ publicId: req.params.id, published: true }).lean();
    if (!row) return res.status(404).json({ message: 'This certificate is not available. Please submit a query.' });
    res.json({ url: await storage().download(row), expiresIn: 120 });
  }));
  router.post('/:id/email', ...(limiters ? [limit(8, 15)] : []), enabledOnly, wrap(async (req, res) => {
    if (!idIsValid(req.params.id)) throw invalid('Invalid certificate.');
    const to = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!emailIsValid(to)) throw invalid('Enter a valid email address.');
    const requestId = boundedText(req.body.requestId, 'Request ID', 16, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) throw invalid('Invalid request ID.');
    const old = await deliveries.findOne({ requestId }).lean();
    if (old) {
      if (old.certificateId !== req.params.id || old.to !== to) throw invalid('Request ID already used.');
      return res.status(old.status === 'accepted' ? 200 : 409).json({ status: old.status,
        message: old.status === 'accepted' ? 'Your email request was accepted.' : 'This request has already been submitted. Please contact the team through the query form.' });
    }
    const row = await certs.findOne({ publicId: req.params.id, published: true }).lean();
    if (!row) return res.status(404).json({ message: 'This certificate is not available.' });
    const bytes = await storage().read(row); // Validate availability before creating a delivery attempt.
    let attempt;
    try { attempt = await deliveries.create({ requestId, certificateId: row.publicId, to, status: 'pending' }); }
    catch (error) { if (error.code === 11000) return res.status(409).json({ message: 'This request is already being processed.' }); throw error; }
    const reserved = await certs.findOneAndUpdate({ publicId: row.publicId, published: true,
      $or: [{ lastEmailRequestedAt: { $exists: false } }, { lastEmailRequestedAt: { $lt: new Date(Date.now() - 60000) } }] },
    { $set: { lastEmailRequestedAt: new Date() } }, { new: true });
    if (!reserved) {
      await deliveries.updateOne({ _id: attempt._id }, { $set: { status: 'failed' } });
      return res.status(429).json({ message: 'This certificate was requested recently. Please wait one minute before requesting it again.' });
    }
    try {
      const result = await mail({ to, ...certificateEmail(row), attachments: [{ filename: `AOACON-${row.publicId}.${row.contentType === 'application/pdf' ? 'pdf' : row.contentType === 'image/jpeg' ? 'jpg' : 'png'}`,
        content: bytes, contentType: row.contentType }] });
      await deliveries.updateOne({ _id: attempt._id }, { $set: { status: 'accepted', provider: result?.provider, messageId: result?.messageId } });
      res.json({ status: 'accepted', message: 'Your certificate email was accepted for sending. Please check your inbox and spam folder.' });
    } catch (error) {
      // Do not automatically resend when provider acceptance is uncertain.
      await deliveries.updateOne({ _id: attempt._id }, { $set: { status: error.rejected ? 'failed' : 'unknown' } });
      res.status(502).json({ message: 'We could not confirm the email request. Please submit a query; avoid repeatedly requesting the same email.' });
    }
  }));
  router.post('/queries', ...(limiters ? [limit(5, 60)] : []), enabledOnly, wrap(async (req, res) => {
    const name = boundedText(req.body.name, 'Name', 2);
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!emailIsValid(email)) throw invalid('Enter a valid contact email.');
    if (!issueKinds.includes(req.body.issue)) throw invalid('Choose an issue category.');
    const certificateId = boundedText(req.body.certificateId || '', 'Certificate', 0, 80);
    if (certificateId && !await certs.exists({ publicId: certificateId, published: true })) throw invalid('Invalid certificate.');
    const row = await queries.create({ reference: `AOA-${randomBytes(5).toString('hex').toUpperCase()}`,
      name, email, certificateId, issue: req.body.issue,
      phone: boundedText(req.body.phone || '', 'Mobile number', 0, 30),
      registrationNumber: boundedText(req.body.registrationNumber || '', 'Registration number', 0, 80),
      remarks: boundedText(req.body.remarks, 'Remarks', 10, 3000) });
    res.status(201).json({ reference: row.reference, message: 'Your query has been received. Our organising team will review it and email you an update. Please keep your reference number.' });
  }));

  // Uses the existing organiser authentication. Public search never returns these fields.
  router.use('/admin', adminAuth);
  router.get('/admin/queries', wrap(async (req, res) => {
    const status = req.query.status || 'new';
    if (!['new', 'in_review', 'resolved', 'all'].includes(status)) throw invalid('Invalid status.');
    const page = Number(req.query.page || 1);
    if (!Number.isInteger(page) || page < 1 || page > 10000) throw invalid('Invalid page.');
    const filter = status === 'all' ? {} : { status };
    const [items, total] = await Promise.all([queries.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30).lean(), queries.countDocuments(filter)]);
    res.json({ items, total, page });
  }));
  router.put('/admin/queries/:reference', wrap(async (req, res) => {
    const status = req.body.status;
    if (!['new', 'in_review', 'resolved'].includes(status)) throw invalid('Invalid status.');
    const note = boundedText(req.body.resolution || '', 'Resolution', status === 'resolved' ? 5 : 0, 3000);
    const row = await queries.findOneAndUpdate({ reference: req.params.reference }, { $set: { status, resolution: note },
      $push: { history: { at: new Date(), actor: req.admin?.email || req.actorName, status, note } } }, { new: true });
    if (!row) return res.status(404).json({ message: 'Query not found.' });
    res.json({ item: row });
  }));
  router.post('/admin/queries/:reference/notify', wrap(async (req, res) => {
    const row = await queries.findOne({ reference: req.params.reference });
    if (!row) return res.status(404).json({ message: 'Query not found.' });
    if (!row.resolution) throw invalid('Write a response before sending an update.');
    await mail({ to: row.email, subject: `AOACON 2026 — Certificate query ${row.reference}`,
      text: `Dear ${row.name},\n\n${row.resolution}\n\nRegards,\nAOACON 2026 Organising Committee`,
      html: `<p>Dear ${escapeHtml(row.name)},</p><p>${escapeHtml(row.resolution).replace(/\n/g, '<br>')}</p><p>Regards,<br>AOACON 2026 Organising Committee</p>` });
    await queries.updateOne({ _id: row._id }, { $push: { history: { at: new Date(), actor: req.admin?.email || req.actorName, status: row.status, note: 'Email update accepted by provider.' } } });
    res.json({ message: 'Email update accepted.' });
  }));
  router.get('/admin/certificates', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q.length > 100) throw invalid('Search is too long.');
    const filter = q ? { $or: [{ searchName: searchFilter(q).$or[0].searchName }, { email: q.toLowerCase() }, { publicId: q }] } : {};
    res.json({ items: await certs.find(filter).sort({ updatedAt: -1 }).limit(50).lean() });
  }));
  router.get('/admin/certificates/:id/download', wrap(async (req, res) => {
    const row = await certs.findOne({ publicId: req.params.id }).lean();
    if (!row) return res.status(404).json({ message: 'Certificate not found.' });
    res.json({ url: await storage().download(row) });
  }));
  router.post('/admin/certificates', upload.single('file'), wrap(async (req, res) => {
    const name = boundedText(req.body.name, 'Name', 2);
    const role = boundedText(req.body.role, 'Role', 2, 80);
    const title = boundedText(req.body.title, 'Event / presentation title', 3, 1000);
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!emailIsValid(email)) throw invalid('Invalid email.');
    if (!certificateCategories.includes(req.body.category)) throw invalid('Invalid certificate category.');
    if (!req.file) throw invalid('Upload the approved certificate file.');
    if (!['true', 'false'].includes(req.body.published)) throw invalid('Choose a publication status.');
    const note = boundedText(req.body.note, 'Approval note', 5, 1000);
    const registrationNumber = boundedText(req.body.registrationNumber || '', 'Registration number', 0, 80);
    const councilNumber = boundedText(req.body.councilNumber || '', 'Medical council number', 0, 80);
    const stored = await storage().put(req.file.buffer, fileType(req.file.buffer));
    const id = randomUUID();
    const row = await certs.create({ ...stored, publicId: id, sourceId: `manual-${id}`, name, email, role, title,
      category: req.body.category, registrationNumber, councilNumber, personKey: personKey(email, name),
      searchName: normalizeCertificateName(name), published: req.body.published === 'true',
      history: [{ at: new Date(), actor: req.admin?.email || req.actorName, action: 'updated', note }] });
    res.status(201).json({ item: row });
  }));
  router.put('/admin/certificates/:id', upload.single('file'), wrap(async (req, res) => {
    const row = await certs.findOne({ publicId: req.params.id });
    if (!row) return res.status(404).json({ message: 'Certificate not found.' });
    const name = boundedText(req.body.name ?? row.name, 'Name', 2);
    const role = boundedText(req.body.role ?? row.role, 'Role', 2, 80);
    const email = String(req.body.email ?? row.email).trim().toLowerCase();
    if (!emailIsValid(email)) throw invalid('Invalid email.');
    if ((name !== row.name || role !== row.role) && !req.file) throw invalid('Upload a corrected certificate when changing its name or role.');
    const note = boundedText(req.body.note, 'Change note', 5, 1000);
    if (req.file) Object.assign(row, await storage().put(req.file.buffer, fileType(req.file.buffer)));
    Object.assign(row, { name, role, email, personKey: personKey(email, name), searchName: normalizeCertificateName(name) });
    if (req.body.published !== undefined) {
      if (!['true', 'false'].includes(req.body.published)) throw invalid('Invalid publication status.');
      row.published = req.body.published === 'true';
    }
    row.history.push({ at: new Date(), actor: req.admin?.email || req.actorName, action: 'updated', note });
    await row.save();
    res.json({ item: row });
  }));
  router.get('/admin/deliveries', wrap(async (req, res) => {
    res.json({ items: await deliveries.find({}).sort({ createdAt: -1 }).limit(100).lean() });
  }));
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.code === 'LIMIT_FILE_SIZE' ? 400 : error.status || 500;
    res.status(status).json({ message: status < 500 ? error.message : 'This request could not be completed. Please try again later.' });
  });
  return router;
}
export default createCertificateRouter();
