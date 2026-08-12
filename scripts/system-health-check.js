import fs from 'node:fs';
import path from 'node:path';

const apiBaseUrl = (process.env.SYSTEM_CHECK_API_URL || 'https://api.aoacon2026.com/api').replace(/\/$/, '');
const frontendUrl = (process.env.SYSTEM_CHECK_FRONTEND_URL || 'https://www.aoacon2026.com').replace(/\/$/, '');
const colorsEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = (code, value) =>
  colorsEnabled ? `\u001b[${code}m${value}\u001b[0m` : String(value);
const green = (value) => color('1;32', value);
const red = (value) => color('1;31', value);
const yellow = (value) => color('1;33', value);
const cyan = (value) => color('1;36', value);
const dim = (value) => color('2', value);
const bold = (value) => color('1', value);

const formatBody = (body) => {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body);
    return JSON.stringify(parsed);
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 240);
  }
};

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
    const responseBody = await response.text();
    const passed = check.expected.includes(response.status);
    results.push({
      ...check,
      url,
      status: response.status,
      passed,
      durationMs: Date.now() - startedAt,
      requestId: response.headers.get('x-request-id'),
      responseBody: formatBody(responseBody),
    });
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

const startedLabel = new Date().toLocaleString('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'medium',
});
console.log(`\n${bold(cyan('AOACON 2026 — SYSTEM HEALTH REPORT'))}`);
console.log(dim('='.repeat(64)));
console.log(`${cyan('Started:')}  ${startedLabel} IST`);
console.log(`${cyan('API:')}      ${apiBaseUrl}`);
console.log(`${cyan('Frontend:')} ${frontendUrl}`);
console.log(`${cyan('Routes:')}   ${routeInventory.length} inventoried`);
console.log(`\n${bold('LIVE CHECKS')}`);

for (const result of results) {
  const marker = result.passed ? green('✓ PASS') : red('✗ FAIL');
  const expected = result.expected.join('/');
  console.log(`${marker}  ${bold(result.name)}`);
  console.log(
    `        ${result.method} ${result.url}\n` +
      `        HTTP ${result.status} · expected ${expected} · ${cyan(`${result.durationMs}ms`)}`
  );
  if (result.requestId) console.log(`        request-id: ${dim(result.requestId)}`);
  if (result.responseBody && (result.name.includes('readiness') || !result.passed)) {
    console.log(`        response: ${dim(result.responseBody)}`);
  }
  if (result.error) console.log(`        ${red(`error: ${result.error}`)}`);
}

const countsByMethod = routeInventory.reduce((counts, route) => {
  counts[route.method] = (counts[route.method] || 0) + 1;
  return counts;
}, {});
console.log(`\n${bold('ROUTE INVENTORY')}`);
console.log(
  Object.entries(countsByMethod)
    .map(([method, count]) => `${cyan(method)}=${count}`)
    .join('  ')
);
console.log(
  yellow(
    '⚠ Authenticated and mutating business endpoints are inventoried but not executed, to protect production data.'
  )
);

const failures = results.filter((result) => !result.passed);
const passedCount = results.length - failures.length;
const healthScore = Math.round((passedCount / results.length) * 100);
const averageDuration = Math.round(
  results.reduce((total, result) => total + result.durationMs, 0) / results.length
);
console.log(`\n${bold('SUMMARY')}`);
console.log(`${green(`${passedCount} passed`)}  ${failures.length ? red(`${failures.length} failed`) : dim('0 failed')}`);
console.log(`Health score: ${failures.length ? red(`${healthScore}%`) : green(`${healthScore}%`)}`);
console.log(`Average response time: ${cyan(`${averageDuration}ms`)}`);

if (failures.length) {
  console.error(`\n${red(`SYSTEM NEEDS ATTENTION — ${failures.length} check(s) failed`)}`);
  process.exitCode = 1;
} else {
  console.log(`\n${green('✓ EVERYTHING CHECKED IS OK')}`);
}
