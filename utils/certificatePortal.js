import { createHash } from 'node:crypto';

export const certificateCategories = ['conference', 'critical-incidents', 'pocus', 'maternal', 'labour', 'occc', 'presentation', 'video-award'];
export const normalizeCertificateName = value => String(value || '').normalize('NFKC').toLowerCase()
  .replace(/^dr\.?\s*/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const emailIsValid = value => typeof value === 'string' && value.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);
// A shared inbox must never merge different people's certificates.
export const personKey = (email, name) => createHash('sha256').update(`${email.trim().toLowerCase()}|${normalizeCertificateName(name).replace(/\s/g, '')}`).digest('hex');
export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function boundedText(value, name, min = 0, max = 180) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    const error = new Error(`${name} must contain ${min}–${max} characters.`); error.status = 400; throw error;
  }
  return value.trim();
}
export function searchFilter(value) {
  const query = boundedText(value, 'Search', 3, 100);
  const normalized = normalizeCertificateName(query);
  if (normalized.length < 3) { const e = new Error('Enter at least three letters or digits.'); e.status = 400; throw e; }
  return { published: true, $or: [
    { searchName: new RegExp(escapeRegex(normalized)) },
    { registrationNumber: new RegExp(`^${escapeRegex(query)}$`, 'i') },
    { councilNumber: new RegExp(`^${escapeRegex(query)}$`, 'i') },
  ] };
}
// Explicit public projection: never expose contact addresses, private keys, or administrative notes.
export function publicCertificate(row) {
  return { id: row.publicId, name: row.name, registrationNumber: row.registrationNumber || '',
    category: row.category, role: row.role, title: row.title };
}
export function fileType(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (buffer.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  throw Object.assign(new Error('Upload a PNG, JPEG or PDF certificate.'), { status: 400 });
}
export function certificateEmail(row) {
  const greeting = `Dear ${row.name},`;
  const line = `Please find attached your ${row.role.toLowerCase()} e-certificate for ${row.title}.`;
  const text = `${greeting}\n\n${line}\n\nWarm regards,\nOrganising Committee\nAOACON 2026\n\nFor corrections or queries, please use the certificate portal.`;
  const html = `<!doctype html><html><body style="margin:0;background:#f3f1ed;font:15px Arial,sans-serif;color:#253044"><table role="presentation" width="100%"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="640" style="max-width:640px;width:100%;background:white;border-collapse:collapse"><tr><td style="background:#253044;border-bottom:4px solid #b8862e;padding:30px;color:white"><div style="font: bold 30px Georgia,serif;letter-spacing:3px">AOACON 2026</div><p style="color:#e6d4ae;font-size:12px;line-height:20px">19th National Conference of the<br>Association of Obstetric Anaesthesiologists</p></td></tr><tr><td style="padding:32px;line-height:26px"><p>${escapeHtml(greeting)}</p><p>${escapeHtml(line)}</p><p>Warm regards,<br><strong>Organising Committee</strong><br><strong style="color:#8c2946">AOACON 2026</strong></p><p style="font-size:12px">For corrections or queries, please use the certificate portal.</p></td></tr></table></td></tr></table></body></html>`;
  const subjectLabel = ({ conference: 'Conference', presentation: 'Presentation', 'video-award': 'Video Award' })[row.category] || row.title;
  return { subject: `AOACON 2026 — Your ${subjectLabel} E-Certificate`, text, html };
}
