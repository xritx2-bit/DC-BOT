const EventEmitter = require('events');

class BotLogger extends EventEmitter {
  constructor() {
    super();
    this.logs = [];
    this.maxLogs = 300;
  }

  formatTimestamp() {
    const d = new Date();
    return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  addLog(type, message, details = null) {
    const timestamp = this.formatTimestamp();
    const logItem = {
      id: Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      timestamp,
      type: type.toUpperCase(),
      message: typeof message === 'object' ? JSON.stringify(message) : String(message),
      details
    };

    this.logs.push(logItem);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Terminal display with custom cyber styling
    const colors = {
      SYSTEM: '\x1b[36m',   // Cyan
      DISCORD: '\x1b[35m',  // Magenta
      TICKETS: '\x1b[33m',  // Yellow
      MODMAIL: '\x1b[32m',  // Green
      VC: '\x1b[96m',       // Bright cyan
      CONSOLE: '\x1b[34m',  // Blue
      WARN: '\x1b[33m',     // Yellow
      ERROR: '\x1b[31m',    // Red
      RESET: '\x1b[0m'
    };

    const color = colors[logItem.type] || '\x1b[37m';
    console.log(`[${logItem.timestamp}] ${color}[${logItem.type}]${colors.RESET} ${logItem.message}`);
    if (details) {
      console.log(details);
    }

    // Emit event for WebSocket live feed
    this.emit('log', logItem);
    return logItem;
  }

  system(msg, details) { return this.addLog('SYSTEM', msg, details); }
  discord(msg, details) { return this.addLog('DISCORD', msg, details); }
  ticket(msg, details) { return this.addLog('TICKETS', msg, details); }
  modmail(msg, details) { return this.addLog('MODMAIL', msg, details); }
  vc(msg, details) { return this.addLog('VC', msg, details); }
  console(msg, details) { return this.addLog('CONSOLE', msg, details); }
  warn(msg, details) { return this.addLog('WARN', msg, details); }
  error(msg, details) { return this.addLog('ERROR', msg, details); }

  getRecentLogs() {
    return this.logs;
  }
}

const logger = new BotLogger();
module.exports = logger;
