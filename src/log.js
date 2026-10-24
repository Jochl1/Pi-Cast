const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

export function createLogger(level = 'info') {
  const max = LEVELS[level] ?? LEVELS.info;
  const out = (lvl, fn) => (...args) => {
    if (LEVELS[lvl] <= max) fn(`[${new Date().toISOString()}] [${lvl}]`, ...args);
  };
  return {
    error: out('error', console.error),
    warn: out('warn', console.warn),
    info: out('info', console.log),
    debug: out('debug', console.log),
  };
}
