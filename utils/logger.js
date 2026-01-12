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

const safeSerialize = (meta) => {
  if (meta === undefined) return '';
  try {
    return JSON.stringify(meta);
  } catch (error) {
    return '[unserializable]';
  }
};

const write = (level, message, meta) => {
  if (levels[level] > currentLevel) return;
  const timestamp = new Date().toISOString();
  const metaText = meta !== undefined ? ` ${safeSerialize(meta)}` : '';
  const line = `[${timestamp}] ${level.toUpperCase()} ${message}${metaText}`;
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
