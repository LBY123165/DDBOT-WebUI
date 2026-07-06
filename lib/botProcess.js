const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

class BotProcess {
  constructor(botDir, configPath) {
    this.botDir = botDir;
    this.configPath = configPath || path.join(path.dirname(process.execPath), 'config.json');
    this.process = null;
    this.status = 'stopped'; // stopped | running | error
    this.pid = null;
    this.startTime = null;
    this.exitCode = null;
    this.logs = [];
    this.maxLogs = 500;
    this.restartCount = 0;
    this.maxRestarts = 3;
    this.customExePath = null;
    this._stopping = false; // Flag: user-initiated stop

    // Load custom exe path from config
    this._loadConfig();
  }

  _loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
        this.customExePath = cfg.executablePath || null;
      }
    } catch (e) {}
  }

  _saveConfig() {
    try {
      let cfg = {};
      if (fs.existsSync(this.configPath)) {
        cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      }
      cfg.executablePath = this.customExePath;
      fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch (e) {}
  }

  setExecutablePath(p) {
    this.customExePath = p;
    this._saveConfig();
  }

  getExecutablePath() {
    // Use custom path if set
    if (this.customExePath && fs.existsSync(this.customExePath)) {
      return this.customExePath;
    }

    const platform = os.platform();
    const isWin = platform === 'win32';
    const exeNames = isWin
      ? ['DDBOT-WSa.exe', 'DDBOT.exe', 'ddbot-wsa.exe', 'ddbot.exe']
      : ['DDBOT-WSa', 'DDBOT', 'ddbot-wsa', 'ddbot'];

    // Search locations: botDir, botDir/build, botDir/dist, botDir/../
    const searchDirs = [
      this.botDir,
      path.join(this.botDir, 'build'),
      path.join(this.botDir, 'dist'),
      path.join(this.botDir, 'DDBOT-WSa-next-dev'),
    ];

    for (const dir of searchDirs) {
      for (const name of exeNames) {
        const p = path.join(dir, name);
        if (fs.existsSync(p)) return p;
      }
    }

    // Dynamic search: any file starting with "ddbot" that's an executable
    try {
      const files = fs.readdirSync(this.botDir);
      for (const f of files) {
        if (f.toLowerCase().startsWith('ddbot') && (f.endsWith('.exe') || (!f.includes('.')))) {
          return path.join(this.botDir, f);
        }
      }
    } catch (e) {}

    // Default: try to build from source
    const goMod = path.join(this.botDir, 'go.mod');
    if (fs.existsSync(goMod)) {
      return 'BUILD_FROM_SOURCE';
    }

    return path.join(this.botDir, exeNames[0]);
  }

  // The working directory for the bot process.
  // DDBOT creates application.yaml, .lsp.db, logs/, etc. relative to cwd,
  // so cwd must be the directory containing the executable.
  getWorkingDir() {
    const exePath = this.getExecutablePath();
    if (exePath === 'BUILD_FROM_SOURCE') return this.botDir;
    return path.dirname(exePath);
  }

  // Ensure admin API is enabled in application.yaml before starting
  ensureAdminEnabled() {
    const yaml = require('js-yaml');
    const configPath = path.join(this.getWorkingDir(), 'application.yaml');
    try {
      let config = {};
      let raw = '';
      if (fs.existsSync(configPath)) {
        raw = fs.readFileSync(configPath, 'utf-8');
        config = yaml.load(raw) || {};
      }

      if (!config.admin) config.admin = {};
      const needsUpdate = !config.admin.enable || config.admin.addr === undefined;

      if (needsUpdate) {
        config.admin.enable = true;
        if (!config.admin.addr) config.admin.addr = '127.0.0.1:15631';

        // Write back preserving structure by replacing admin section
        let newRaw;
        if (raw.includes('admin:')) {
          // Replace existing admin block
          newRaw = raw.replace(
            /admin:[\s\S]*?(?=\n\w|\n#|\n$|$)/,
            `admin:\n  enable: true\n  addr: "${config.admin.addr}"\n  token: ""\n`
          );
        } else {
          // Append admin block
          newRaw = raw.trimEnd() + `\n\nadmin:\n  enable: true\n  addr: "${config.admin.addr}"\n  token: ""\n`;
        }
        fs.writeFileSync(configPath, newRaw, 'utf-8');
        return { updated: true, addr: config.admin.addr };
      }
      return { updated: false, addr: config.admin.addr || '127.0.0.1:15631' };
    } catch (e) {
      return { updated: false, error: e.message };
    }
  }

  start() {
    if (this.process) {
      return { success: false, message: '进程已在运行中' };
    }

    let exePath = this.getExecutablePath();

    // If no binary found, try to build from source
    if (exePath === 'BUILD_FROM_SOURCE' || !fs.existsSync(exePath)) {
      if (exePath === 'BUILD_FROM_SOURCE') {
        return { success: false, message: '未找到编译后的可执行文件，请先手动编译或在设置中指定路径。编译命令: go build -o DDBOT ./cmd' };
      }
      return { success: false, message: `找不到可执行文件: ${exePath}\n请在设置页面配置正确的可执行文件路径` };
    }

    // Auto-enable admin API
    const adminResult = this.ensureAdminEnabled();
    if (adminResult.updated) {
      const entry = { time: new Date().toISOString(), type: 'system', message: '已自动开启管理后台 (admin.enable: true)' };
      this.logs.push(entry);
      if (this._onLog) this._onLog(entry);
    }

    try {
      this.process = spawn(exePath, [], {
        cwd: this.getWorkingDir(),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: { ...process.env }
      });

      this.pid = this.process.pid;
      this.status = 'running';
      this.startTime = new Date();

      const addLog = (type, data) => {
        const lines = data.toString().split('\n').filter(l => l.trim());
        for (const line of lines) {
          const entry = { time: new Date().toISOString(), type, message: line };
          this.logs.push(entry);
          if (this.logs.length > this.maxLogs) this.logs.shift();
          if (this._onLog) this._onLog(entry);
        }
      };

      this.process.stdout.on('data', (data) => addLog('stdout', data));
      this.process.stderr.on('data', (data) => addLog('stderr', data));

      this.process.on('close', (code) => {
        // If user explicitly stopped, always treat as 'stopped' regardless of exit code
        this.status = this._stopping ? 'stopped' : (code === 0 ? 'stopped' : 'error');
        this.exitCode = code;
        this._stopping = false;
        this.process = null;
        this.pid = null;
        const entry = { time: new Date().toISOString(), type: 'system', message: `进程退出，退出码: ${code}` };
        this.logs.push(entry);
        if (this._onLog) this._onLog(entry);
        if (this._onStatusChange) this._onStatusChange(this.status);
      });

      this.process.on('error', (err) => {
        this.status = 'error';
        this.exitCode = -1;
        this.process = null;
        this.pid = null;
        const entry = { time: new Date().toISOString(), type: 'error', message: `进程错误: ${err.message}` };
        this.logs.push(entry);
        if (this._onLog) this._onLog(entry);
        if (this._onStatusChange) this._onStatusChange(this.status);
      });

      if (this._onStatusChange) this._onStatusChange(this.status);
      return { success: true, message: '进程已启动', pid: this.pid };
    } catch (err) {
      return { success: false, message: `启动失败: ${err.message}` };
    }
  }

  stop() {
    if (!this.process) {
      return { success: false, message: '进程未在运行' };
    }

    try {
      this._stopping = true;
      if (os.platform() === 'win32') {
        spawn('taskkill', ['/pid', this.pid, '/T', '/F'], { windowsHide: true });
      } else {
        this.process.kill('SIGTERM');
      }
      this.status = 'stopped';
      return { success: true, message: '已发送停止信号' };
    } catch (err) {
      this._stopping = false;
      return { success: false, message: `停止失败: ${err.message}` };
    }
  }

  restart() {
    this.stop();
    return new Promise(resolve => {
      setTimeout(() => {
        resolve(this.start());
      }, 2000);
    });
  }

  getStatus() {
    return {
      status: this.status,
      pid: this.pid,
      startTime: this.startTime,
      exitCode: this.exitCode,
      uptime: this.startTime ? Date.now() - this.startTime.getTime() : 0,
      executable: this.getExecutablePath(),
      workingDir: this.getWorkingDir(),
      botDir: this.botDir,
      logCount: this.logs.length
    };
  }

  getRecentLogs(count = 100) {
    return this.logs.slice(-count);
  }

  onLog(callback) { this._onLog = callback; }
  onStatusChange(callback) { this._onStatusChange = callback; }
}

module.exports = BotProcess;
