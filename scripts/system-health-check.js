import fs from 'node:fs';
import path from 'node:path';

const apiBaseUrl = (process.env.SYSTEM_CHECK_API_URL || 'https://api.aoacon2026.com/api').replace(/\/$/, '');
const frontendUrl = (process.env.SYSTEM_CHECK_FRONTEND_URL || 'https://www.aoacon2026.com').replace(/\/$/, '');

const checks = [
  { name: 'Frontend website', method: 'GET', url: frontendUrl, expected: [200] },
  { name: 'Backend liveness', method: 'GET', path: '/health/live', expected: [200] },
  { name: 'Backend readiness', method: 'GET', path: '/health/ready', expected: [200] },
  { name: 'Public accommodation list', method: 'GET', path: '/accommodation', expected: [200] },
  { name: 'Accommodation booking disabled', method: 'POST', path: '/accommodation/book', expected: [410] },
  {
    name: 'Accommodation payment disabled',
    method: 'POST',
    path: '/payment/create-order/accommodation',
    expected: [410],
  },
  { name: 'User profile auth guard', method: 'GET', path: '/auth/me', expected: [401] },
  { name: 'Registration auth guard', method: 'GET', path: '/registration/pricing', expected: [401] },
  { name: 'Payment auth guard', method: 'POST', path: '/payment/create-order/registration', expected: [401] },
  { name: 'Abstract admin guard', method: 'GET', path: '/abstract/all', expected: [401] },
  { name: 'Video admin guard', method: 'GET', path: '/video/all', expected: [401] },
  { name: 'Feedback admin guard', method: 'GET', path: '/feedback/all', expected: [401] },
  { name: 'Attendance admin guard', method: 'GET', path: '/attendance', expected: [401] },
  { name: 'Admin dashboard guard', method: 'GET', path: '/admin/dashboard', expected: [401] },
];

const routeDirectory = path.resolve('routes');
const routePattern = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
const routeInventory = [];

for (const filename of fs.readdirSync(routeDirectory).filter((name) => name.endsWith('.js')).sort()) {
  const source = fs.readFileSync(path.join(routeDirectory, filename), 'utf8');
  for (const match of source.matchAll(routePattern)) {
    routeInventory.push({ file: filename, method: match[1].toUpperCase(), path: match[2] });
  }
}

const results = [];
for (const check of checks) {
  const url = check.url || `${apiBaseUrl}${check.path}`;
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: check.method,
      headers: check.method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
      body: check.method === 'GET' ? undefined : '{}',
      signal: AbortSignal.timeout(10_000),
      redirect: 'follow',
    });
    const passed = check.expected.includes(response.status);
    results.push({ ...check, url, status: response.status, passed, durationMs: Date.now() - startedAt });
  } catch (error) {
    results.push({
      ...check,
      url,
      status: 'ERROR',
      passed: false,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    });
  }
}

console.log('\nAOACON system check');
console.log(`API: ${apiBaseUrl}`);
console.log(`Frontend: ${frontendUrl}`);
console.log(`Routes inventoried: ${routeInventory.length}`);

for (const result of results) {
  const marker = result.passed ? 'PASS' : 'FAIL';
  const expected = result.expected.join('/');
  console.log(`${marker.padEnd(4)} ${result.name} — HTTP ${result.status} (expected ${expected}, ${result.durationMs}ms)`);
  if (result.error) console.log(`     ${result.error}`);
}

const countsByMethod = routeInventory.reduce((counts, route) => {
  counts[route.method] = (counts[route.method] || 0) + 1;
  return counts;
}, {});
console.log('\nRoute inventory:', Object.entries(countsByMethod).map(([method, count]) => `${method}=${count}`).join(', '));
console.log('Authenticated and mutating business endpoints are inventoried but not executed to avoid changing production data.');

const failures = results.filter((result) => !result.passed);
if (failures.length) {
  console.error(`\nSystem check failed: ${failures.length} check(s) need attention.`);
  process.exitCode = 1;
} else {
  console.log('\nEverything checked is OK.');
}
