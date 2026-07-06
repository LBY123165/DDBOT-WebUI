const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

class AutoStartManager {
  constructor(appName, appPath) {
    this.appName = appName || 'DDBOT-WSa WebUI';
    this.appPath = appPath || process.argv[0];
    this.platform = os.platform();
  }

  isSupported() {
    return ['win32', 'linux', 'darwin'].includes(this.platform);
  }

  // === Windows (Registry HKCU\Run) ===
  _winGetRegKey() {
    return 'DDBOTWSAWebUI';
  }

  _winIsRegistered() {
    try {
      const result = execSync(`reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this._winGetRegKey()}" 2>nul`, { encoding: 'utf-8' });
      return result.includes(this._winGetRegKey());
    } catch { return false; }
  }

  _winRegister() {
    try {
      const nodePath = process.execPath;
      const scriptPath = path.resolve(__dirname, '..', 'server.js');
      const cmd = `"${nodePath}" "${scriptPath}"`;
      execSync(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this._winGetRegKey()}" /t REG_SZ /d "${cmd}" /f`, { stdio: 'ignore' });
      return { success: true, message: '已注册 Windows 开机自启动 (注册表)' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  _winUnregister() {
    try {
      execSync(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${this._winGetRegKey()}" /f`, { stdio: 'ignore' });
      return { success: true, message: '已取消 Windows 开机自启动' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  // === Linux (systemd) ===
  _linuxGetPath() {
    return path.join(os.homedir(), '.config', 'systemd', 'user', `${this.appName}.service`);
  }

  _linuxIsRegistered() {
    try {
      return fs.existsSync(this._linuxGetPath());
    } catch { return false; }
  }

  _linuxRegister() {
    try {
      const p = this._linuxGetPath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const nodePath = process.execPath;
      const cwd = process.cwd();
      const service = `[Unit]
Description=${this.appName}
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${this.appPath}
WorkingDirectory=${cwd}
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target`;
      fs.writeFileSync(p, service, 'utf-8');

      try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch {}
      try { execSync(`systemctl --user enable ${this.appName}.service`, { stdio: 'ignore' }); } catch {}

      return { success: true, message: '已注册 Linux systemd 用户服务', path: p };
    } catch (e) { return { success: false, message: e.message }; }
  }

  _linuxUnregister() {
    try {
      const p = this._linuxGetPath();
      try { execSync(`systemctl --user disable ${this.appName}.service`, { stdio: 'ignore' }); } catch {}
      if (fs.existsSync(p)) fs.unlinkSync(p);
      try { execSync('systemctl --user daemon-reload', { stdio: 'ignore' }); } catch {}
      return { success: true, message: '已取消 Linux 开机自启动' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  // === macOS (launchd) ===
  _macGetPath() {
    return path.join(os.homedir(), 'Library', 'LaunchAgents', `com.${this.appName.replace(/\s+/g, '-').toLowerCase()}.plist`);
  }

  _macIsRegistered() {
    try { return fs.existsSync(this._macGetPath()); } catch { return false; }
  }

  _macRegister() {
    try {
      const p = this._macGetPath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const nodePath = process.execPath;
      const cwd = process.cwd();
      const label = `com.${this.appName.replace(/\s+/g, '-').toLowerCase()}`;
      const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${this.appPath}</string>
  </array>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>`;
      fs.writeFileSync(p, plist, 'utf-8');

      try { execSync(`launchctl load -w "${p}"`, { stdio: 'ignore' }); } catch {}

      return { success: true, message: '已注册 macOS LaunchAgent', path: p };
    } catch (e) { return { success: false, message: e.message }; }
  }

  _macUnregister() {
    try {
      const p = this._macGetPath();
      try { execSync(`launchctl unload -w "${p}"`, { stdio: 'ignore' }); } catch {}
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return { success: true, message: '已取消 macOS 开机自启动' };
    } catch (e) { return { success: false, message: e.message }; }
  }

  // === Unified API ===
  isRegistered() {
    switch (this.platform) {
      case 'win32': return this._winIsRegistered();
      case 'linux': return this._linuxIsRegistered();
      case 'darwin': return this._macIsRegistered();
      default: return false;
    }
  }

  register() {
    if (!this.isSupported()) return { success: false, message: `不支持的平台: ${this.platform}` };
    switch (this.platform) {
      case 'win32': return this._winRegister();
      case 'linux': return this._linuxRegister();
      case 'darwin': return this._macRegister();
    }
  }

  unregister() {
    if (!this.isSupported()) return { success: false, message: `不支持的平台: ${this.platform}` };
    switch (this.platform) {
      case 'win32': return this._winUnregister();
      case 'linux': return this._linuxUnregister();
      case 'darwin': return this._macUnregister();
    }
  }

  toggle() {
    return this.isRegistered() ? this.unregister() : this.register();
  }

  getStatus() {
    const method = { win32: '注册表 HKCU\\Run', linux: 'systemd 用户服务', darwin: 'LaunchAgent plist' };
    return {
      supported: this.isSupported(),
      registered: this.isRegistered(),
      platform: this.platform,
      method: method[this.platform] || '不支持'
    };
  }
}

module.exports = AutoStartManager;
