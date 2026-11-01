// The conference has ended. Keep viewing and account access available, but
// reject event mutations before authentication, uploads, or payment creation.
const accessPaths = new Set([
  '/auth/login', '/auth/admin/login',
  '/auth/forgot-password', '/auth/reset-password',
  '/auth/admin/forgot-password', '/auth/admin/reset-password',
]);

export function eventReadOnly(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const path = req.path.replace(/\/+$/, '');
  // Honor signed gateway callbacks for payments already taken before closure.
  if (req.method === 'POST' && (accessPaths.has(path) || path === '/payment/webhook')) {
    return next();
  }
  return res.status(403).json({
    success: false,
    code: 'EVENT_CLOSED',
    readOnly: true,
    message: 'AOACON 2026 has concluded. This website is now view-only. Registrations, payments, bookings and submissions are closed.',
  });
}
