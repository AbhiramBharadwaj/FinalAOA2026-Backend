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
  if (!text.includes('.') && !text.includes('_')) return text;
  const cleaned = text.replace(/[_\\.]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned[0].toUpperCase() + cleaned.slice(1) : cleaned;
};

const normalizeValue = (value) => {
  if (value === undefined) return '';
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return '[unserializable]';
  }
};

const formatMeta = (meta) => {
  if (!meta || typeof meta !== 'object') return normalizeValue(meta);
  return Object.entries(meta)
    .map(([key, value]) => {
      if (value === undefined) return null;
      return `${key}=${normalizeValue(value)}`;
    })
    .filter(Boolean)
    .join(' ');
};

const write = (level, message, meta) => {
  if (levels[level] > currentLevel) return;
  const timestamp = new Date().toISOString();
  const metaText = formatMeta(meta);
  const line = `[${timestamp}] ${level.toUpperCase()} ${humanizeMessage(message)}${metaText ? ` | ${metaText}` : ''}`;
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
