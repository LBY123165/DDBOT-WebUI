const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

class LogWatcher extends EventEmitter {
  constructor(logsDir) {
    super();
    this.logsDir = logsDir;
    this.watchers = new Map();
    this.filePositions = new Map();
    this.isWatching = false;
    this.pollTimer = null;
  }

  start() {
    if (this.isWatching) return;
    this.isWatching = true;

    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }

    this._scanFiles();
    this._startPolling();
  }

  _scanFiles() {
    try {
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.endsWith('.log'))
        .sort()
        .slice(-7); // Keep last 7 days

      for (const file of files) {
        const filePath = path.join(this.logsDir, file);
        if (!this.filePositions.has(filePath)) {
          const stats = fs.statSync(filePath);
          // Start from end for existing files, or 0 for today's file
          const today = new Date().toISOString().split('T')[0];
          const isToday = file.includes(today);
          this.filePositions.set(filePath, isToday ? Math.max(0, stats.size - 5000) : stats.size);
        }
      }
    } catch (e) {
      // Directory might not exist yet
    }
  }

  _startPolling() {
    this.pollTimer = setInterval(() => {
      this._checkForNewContent();
    }, 1000);
  }

  _checkForNewContent() {
    try {
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.endsWith('.log'))
        .sort();

      for (const file of files) {
        const filePath = path.join(this.logsDir, file);
        try {
          const stats = fs.statSync(filePath);
          const lastPos = this.filePositions.get(filePath) || 0;

          if (stats.size > lastPos) {
            const stream = fs.createReadStream(filePath, {
              start: lastPos,
              encoding: 'utf-8'
            });

            let buffer = '';
            stream.on('data', (chunk) => {
              buffer += chunk;
            });

            stream.on('end', () => {
              this.filePositions.set(filePath, stats.size);
              const lines = buffer.split('\n').filter(l => l.trim());
              for (const line of lines) {
                const parsed = this._parseLine(line, file);
                if (parsed) {
                  this.emit('log', parsed);
                }
              }
            });
          }
        } catch (e) {
          // File might be locked or deleted
        }
      }
    } catch (e) {
      // Directory might not exist
    }
  }

  _parseLine(line, filename) {
    // Parse logrus text format: time="2024-01-01T00:00:00+08:00" level=info msg="..."
    const timeMatch = line.match(/time="([^"]+)"/);
    const levelMatch = line.match(/level=(\w+)/);
    const msgMatch = line.match(/msg="([^"]*)"/);

    return {
      time: timeMatch ? timeMatch[1] : new Date().toISOString(),
      level: levelMatch ? levelMatch[1] : 'info',
      message: msgMatch ? msgMatch[1] : line,
      raw: line,
      source: filename
    };
  }

  getRecentLogs(count = 200) {
    const logs = [];
    try {
      const files = fs.readdirSync(this.logsDir)
        .filter(f => f.endsWith('.log'))
        .sort()
        .slice(-2); // Last 2 files

      for (const file of files) {
        const filePath = path.join(this.logsDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n').filter(l => l.trim());
          for (const line of lines.slice(-100)) {
            const parsed = this._parseLine(line, file);
            if (parsed) logs.push(parsed);
          }
        } catch (e) {}
      }
    } catch (e) {}
    return logs.slice(-count);
  }

  stop() {
    this.isWatching = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    for (const watcher of this.watchers.values()) {
      if (watcher.close) watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = LogWatcher;
