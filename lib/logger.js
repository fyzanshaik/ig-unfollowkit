export class Logger {
  #logs = [];
  #maxLogs = 5000;
  #persistTimer = null;

  constructor() {
    this.#loadFromStorage();
  }

  async #loadFromStorage() {
    try {
      const result = await chrome.storage.local.get('logs');
      if (result.logs && Array.isArray(result.logs)) {
        this.#logs = result.logs;
      }
    } catch (e) {
      console.warn('[Logger] Failed to load persisted logs:', e);
    }
  }

  log(level, message, data = null) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      data: data !== null && data !== undefined ? this.#safeStringify(data) : null,
    };

    this.#logs.push(entry);
    if (this.#logs.length > this.#maxLogs) {
      this.#logs = this.#logs.slice(-this.#maxLogs);
    }

    const consoleFn = level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log';
    console[consoleFn](`[${entry.ts}] [${level}] ${message}`, data ?? '');

    this.#schedulePersist();
  }

  info(msg, data) { this.log('INFO', msg, data); }
  warn(msg, data) { this.log('WARN', msg, data); }
  error(msg, data) { this.log('ERROR', msg, data); }
  debug(msg, data) { this.log('DEBUG', msg, data); }

  getLogs() {
    return [...this.#logs];
  }

  getLogsAsText() {
    return this.#logs
      .map(
        (e) =>
          `${e.ts} [${e.level}] ${e.msg}${e.data ? ' | ' + e.data : ''}`
      )
      .join('\n');
  }

  clear() {
    this.#logs = [];
    chrome.storage.local.set({ logs: [] });
  }

  #safeStringify(data) {
    try {
      if (typeof data === 'string') return data;
      return JSON.stringify(data, null, 0);
    } catch {
      return String(data);
    }
  }

  #schedulePersist() {
    if (this.#persistTimer) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = null;
      this.persist();
    }, 3000);
  }

  async persist() {
    try {
      await chrome.storage.local.set({ logs: this.#logs.slice(-2000) });
    } catch (e) {
      console.warn('[Logger] Failed to persist logs:', e);
    }
  }
}
