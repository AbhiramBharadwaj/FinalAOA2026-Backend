const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const configuredLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
const currentLevel = Object.prototype.hasOwnProperty.call(levels, configuredLevel)
  ? levels[configuredLevel]
  : levels.info;

const humanizeMessage = (message) => {
  const text = String(message);
  if (text.includes(' ')) return text;
  if (!text.includes('.') && !text.includes('_')) return text;
  const cleaned = text.replace(/[_\\.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
};

const write = (level, message, meta) => {
  if (levels[level] > currentLevel) return;
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] ${level.toUpperCase()} ${humanizeMessage(message)}`;
  const detail =
    meta && typeof meta === 'object' && meta.message ? ` - ${meta.message}` : '';
  const line = `${base}${detail}`;
  const method = level === 'debug' ? 'log' : level;
  if (typeof console[method] === 'function') {
    console[method](line);
  } else {
    console.log(line);
  }
};

const logger = {
  info: (message, meta) => write('info', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  error: (message, meta) => write('error', message, meta),
  debug: (message, meta) => write('debug', message, meta),
};

export default logger;
