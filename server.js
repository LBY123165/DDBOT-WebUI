const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

const BotProcess = require('./lib/botProcess');
const LogWatcher = require('./lib/logWatcher');
const AutoStartManager = require('./lib/autoStart');

// === Config ===
const WEB_PORT = process.env.WEBUI_PORT || 9630;

const isCaxa = __dirname.includes('caxa') && __dirname.includes('applications');
const EXE_DIR = isCaxa ? process.cwd() : path.dirname(process.execPath);

// 目录结构：
// 根目录/
//   webui.exe        ← EXE_DIR
//   config.json      ← WebUI 配置
//   log/             ← WebUI 运行日志
//   data/            ← Bot 可执行文件 + Bot 数据 (application.yaml, .lsp.db, logs/...)

const CONFIG_FILE = path.join(EXE_DIR, 'config.json');
const LOG_DIR = path.join(EXE_DIR, 'log');
const DATA_DIR = path.join(EXE_DIR, 'data');
const SUBS_PATH = path.join(DATA_DIR, 'subscriptions.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

// Bot 目录：环境变量 > data/ 目录
function detectBotDir() {
  if (process.env.DDBOT_DIR) return process.env.DDBOT_DIR;
  return DATA_DIR;
}
const BOT_DIR = detectBotDir();
const PUBLIC_DIR = path.join(__dirname, 'public');

// === Instances ===
const bot = new BotProcess(BOT_DIR, CONFIG_FILE);
const autoStart = new AutoStartManager('DDBOT-WSa-WebUI', process.argv[0]);

// Dynamic paths — follow the bot's working directory (where the exe lives)
function getConfigPath() { return path.join(bot.getWorkingDir(), 'application.yaml'); }
function getLogsDir() { return path.join(bot.getWorkingDir(), 'logs'); }

const logWatcher = new LogWatcher(getLogsDir());

// === Express App ===
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// === API: Bot Process ===
app.get('/api/bot/status', (req, res) => {
  res.json(bot.getStatus());
});

app.post('/api/bot/start', (req, res) => {
  const result = bot.start();
  res.json(result);
});

app.post('/api/bot/stop', (req, res) => {
  const result = bot.stop();
  res.json(result);
});

app.post('/api/bot/restart', async (req, res) => {
  const result = await bot.restart();
  res.json(result);
});

// === API: Logs ===
app.get('/api/logs', (req, res) => {
  const count = parseInt(req.query.count) || 200;
  const botLogs = bot.getRecentLogs(count);
  const fileLogs = logWatcher.getRecentLogs(count);
  const all = [...fileLogs, ...botLogs].sort((a, b) =>
    new Date(a.time) - new Date(b.time)
  ).slice(-count);
  res.json(all);
});

app.get('/api/logs/files', (req, res) => {
  try {
    if (!fs.existsSync(getLogsDir())) return res.json([]);
    const files = fs.readdirSync(getLogsDir())
      .filter(f => f.endsWith('.log'))
      .sort()
      .reverse();
    res.json(files);
  } catch (e) {
    res.json([]);
  }
});

// POST to bot admin API
async function botAdminPost(endpoint, data) {
  const http = require('http');
  let config = {};
  if (fs.existsSync(getConfigPath())) {
    try { config = yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')) || {}; } catch {}
  }
  const adminConfig = config.admin || {};
  if (!adminConfig.enable) return null;

  const addr = adminConfig.addr || '127.0.0.1:15631';
  const token = adminConfig.token || '';

  return new Promise((resolve) => {
    const postData = JSON.stringify(data);
    const r = http.request(`http://${addr}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      },
      timeout: 5000
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { resolve(body); }
      });
    });
    r.on('error', (e) => { console.error(`[AdminAPI] ${endpoint} error:`, e.message); resolve(null); });
    r.on('timeout', () => { r.destroy(); resolve(null); });
    r.write(postData);
    r.end();
  });
}

// === API: Subscriptions (via Bot Admin API) ===
app.get('/api/subscriptions', async (req, res) => {
  // Primary: query bot's admin API
  const botSubs = await queryBotAdminAPI('/api/v1/subs/list');
  if (botSubs !== null) {
    return res.json({ source: 'bot', data: botSubs });
  }
  // Fallback: local JSON file
  try {
    if (fs.existsSync(SUBS_PATH)) {
      res.json({ source: 'local', data: JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8')) });
    } else {
      res.json({ source: 'local', data: [] });
    }
  } catch (e) {
    res.json({ source: 'local', data: [] });
  }
});

app.get('/api/subscriptions/summary', async (req, res) => {
  const summary = await queryBotAdminAPI('/api/v1/subs/summary');
  if (summary !== null) {
    return res.json({ source: 'bot', ...summary });
  }
  // Fallback: compute from local file
  try {
    const subs = fs.existsSync(SUBS_PATH) ? JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8')) : [];
    const bySite = {};
    for (const s of subs) { bySite[s.site] = (bySite[s.site] || 0) + 1; }
    res.json({ source: 'local', total: subs.length, bySite });
  } catch (e) {
    res.json({ source: 'local', total: 0, bySite: {} });
  }
});

app.post('/api/subscriptions', async (req, res) => {
  const { site, id, type, groupCode } = req.body;
  if (!site || !id || !type) {
    return res.status(400).json({ success: false, message: '缺少必要参数: site, id, type' });
  }

  // Try bot admin API
  const addResult = await botAdminPost('/api/v1/subs/add', {
    site, id, type: Array.isArray(type) ? type[0] : type,
    groupCode: parseInt(groupCode) || 0
  });

  if (addResult !== null) {
    return res.json({ success: true, source: 'bot' });
  }

  // Fallback: save to local JSON
  try {
    let subs = [];
    if (fs.existsSync(SUBS_PATH)) {
      subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8'));
    }
    const sub = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      site, userId: id, types: Array.isArray(type) ? type : [type],
      group: String(groupCode || ''),
      name: req.body.name || '',
      createdAt: new Date().toISOString()
    };
    subs.push(sub);
    fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf-8');
    res.json({ success: true, source: 'local', data: sub });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// === API: Update Subscription Config ===
app.post('/api/subscriptions/:id/config', async (req, res) => {
  const { site, groupCode, types } = req.body;
  const id = req.params.id;

  // Try bot admin API: GET current config, then POST updated config
  const currentConfig = await queryBotAdminAPI(
    `/api/admin/sub/config?site=${site}&id=${id}&groupCode=${groupCode || 0}`
  );

  if (currentConfig !== null) {
    const newConfig = currentConfig || {};
    if (!newConfig.types) newConfig.types = {};
    for (const t of ['live', 'news', 'dynamic']) {
      newConfig.types[t] = types.includes(t);
    }

    const updateResult = await botAdminPost('/api/admin/sub/config', {
      site, id, groupCode: parseInt(groupCode) || 0, config: newConfig
    });

    if (updateResult !== null) {
      return res.json({ success: true, source: 'bot' });
    }
    return res.json({ success: false, source: 'bot', message: '更新失败' });
  }

  // Fallback: update local JSON
  try {
    const subs = fs.existsSync(SUBS_PATH) ? JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8')) : [];
    const sub = subs.find(s => String(s.id) === String(id));
    if (sub) {
      sub.types = types;
      fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf-8');
      return res.json({ success: true, source: 'local' });
    }
    return res.status(404).json({ success: false, message: '未找到' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

app.delete('/api/subscriptions/:id', async (req, res) => {
  const id = req.params.id;

  // Try bot admin API — check if admin is enabled first
  let config = {};
  if (fs.existsSync(getConfigPath())) {
    try { config = yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')) || {}; } catch {}
  }
  const adminConfig = config.admin || {};

  if (adminConfig.enable) {
    // Get list (might be null/empty array)
    const botSubs = await queryBotAdminAPI('/api/v1/subs/list');

    if (botSubs === null) {
      // API returned null — could mean empty list OR API error
      // Try removing directly with the ID from the URL
      const result = await botAdminPost('/api/v1/subs/remove', {
        id: parseInt(id) || id, site: req.query.site || '', type: req.query.type || '', groupCode: 0
      });
      if (result !== null) {
        return res.json({ success: true, source: 'bot' });
      }
      return res.json({ success: false, source: 'bot', message: '删除失败，Bot API 无响应' });
    }

    if (Array.isArray(botSubs)) {
      const sub = botSubs.find(s => String(s.id) === String(id));
      if (!sub) {
        return res.json({ success: false, source: 'bot', message: `未找到 ID=${id} 的订阅` });
      }

      const result = await botAdminPost('/api/v1/subs/remove', {
        site: sub.site, id: sub.id, type: sub.type, groupCode: sub.groupCode
      });

      if (result !== null) {
        return res.json({ success: true, source: 'bot' });
      }
      return res.json({ success: false, source: 'bot', message: 'Bot API 删除请求失败' });
    }
  }

  // Fallback: local JSON
  try {
    let subs = fs.existsSync(SUBS_PATH) ? JSON.parse(fs.readFileSync(SUBS_PATH, 'utf-8')) : [];
    const before = subs.length;
    subs = subs.filter(s => s.id !== id);
    if (subs.length === before) {
      return res.json({ success: false, source: 'local', message: '未找到该订阅' });
    }
    fs.writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2), 'utf-8');
    res.json({ success: true, source: 'local' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// === API: Config ===
app.get('/api/config', (req, res) => {
  try {
    if (!fs.existsSync(getConfigPath())) {
      return res.json({ exists: false, content: '', parsed: {} });
    }
    const content = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed = yaml.load(content) || {};
    res.json({ exists: true, content, parsed });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/config', (req, res) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ success: false, message: '内容不能为空' });
    // Validate YAML
    yaml.load(content);
    // Backup (keep latest 3)
    if (fs.existsSync(getConfigPath())) {
      const configDir = path.dirname(getConfigPath());
      const configBase = path.basename(getConfigPath());
      const backup = getConfigPath() + '.bak.' + Date.now();
      fs.copyFileSync(getConfigPath(), backup);
      // Clean old backups
      const backups = fs.readdirSync(configDir)
        .filter(f => f.startsWith(configBase + '.bak.'))
        .sort()
        .reverse();
      for (const old of backups.slice(3)) {
        try { fs.unlinkSync(path.join(configDir, old)); } catch {}
      }
    }
    fs.writeFileSync(getConfigPath(), content, 'utf-8');
    res.json({ success: true, message: '配置已保存' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// === OneBot Connection State ===
// Primary source: bot's admin API at /api/v1/onebot/status
// Fallback: log pattern matching
let onebotConnected = false;
let onebotConnectedSince = null;

function updateOnebotStateFromLog(message) {
  const msg = (message || '').toLowerCase();
  const connectPatterns = [
    'ws connected', 'websocket connected', 'onebot connected',
    'client connected', 'new connection', 'connection established',
    'ws client connected', 'forward websocket connected',
    'reverse websocket connected', 'adapter connected',
    'connect success', 'login success', 'bot online'
  ];
  const disconnectPatterns = [
    'ws disconnected', 'websocket disconnected', 'onebot disconnected',
    'client disconnected', 'connection closed', 'connection lost',
    'ws client disconnected', 'forward websocket disconnected',
    'reverse websocket disconnected', 'adapter disconnected',
    'connect fail', 'connection refused', 'bot offline'
  ];

  if (connectPatterns.some(p => msg.includes(p))) {
    onebotConnected = true;
    onebotConnectedSince = new Date();
  }
  if (disconnectPatterns.some(p => msg.includes(p))) {
    onebotConnected = false;
    onebotConnectedSince = null;
  }
  if (msg.includes('进程退出') || msg.includes('process exit')) {
    onebotConnected = false;
    onebotConnectedSince = null;
  }
}

// Query bot's built-in admin API for real-time status
async function queryBotAdminAPI(endpoint) {
  try {
    let config = {};
    if (fs.existsSync(getConfigPath())) {
      config = yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')) || {};
    }
    const adminConfig = config.admin || {};
    if (!adminConfig.enable) return null;

    const addr = adminConfig.addr || '127.0.0.1:15631';
    const token = adminConfig.token || '';

    const http = require('http');
    return new Promise((resolve) => {
      const req = http.get(`http://${addr}${endpoint}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        timeout: 2000
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve(parsed);
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch { return null; }
}

// === API: OneBot Status ===
app.get('/api/onebot/status', async (req, res) => {
  try {
    let config = {};
    if (fs.existsSync(getConfigPath())) {
      config = yaml.load(fs.readFileSync(getConfigPath(), 'utf-8')) || {};
    }

    const wsConfig = config.websocket || {};
    const adapterConfig = config.adapter || {};
    const adminConfig = config.admin || {};

    const status = {
      mode: adapterConfig.mode || 'onebot-v11',
      wsMode: wsConfig.mode || 'ws-server',
      wsAddr: wsConfig.mode === 'ws-reverse'
        ? (wsConfig['ws-reverse'] || 'ws://localhost:3001')
        : (wsConfig['ws-server'] || '0.0.0.0:15630'),
      connected: false,
      connectedSince: null,
      token: wsConfig.token ? '***' : null,
      adminEnabled: adminConfig.enable || false,
      adminAddr: adminConfig.addr || '127.0.0.1:15631'
    };

    // Primary: query bot's admin API for real connection status
    if (bot.status === 'running' && adminConfig.enable) {
      const obStatus = await queryBotAdminAPI('/api/v1/onebot/status');
      if (obStatus && obStatus.online) {
        status.connected = true;
        status.connectedSince = onebotConnectedSince;
      }
    }

    // Fallback: log pattern matching
    if (!status.connected && bot.status === 'running' && onebotConnected) {
      status.connected = true;
      status.connectedSince = onebotConnectedSince;
    }

    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// === API: Bot Subscriptions (from admin API) ===
app.get('/api/bot/subscriptions', async (req, res) => {
  const data = await queryBotAdminAPI('/api/v1/subs/list');
  if (data === null) {
    return res.json({ available: false, data: [], message: '管理后台未启用，请在设置中开启 admin.enable' });
  }
  res.json({ available: true, data });
});

app.get('/api/bot/subscriptions/summary', async (req, res) => {
  const data = await queryBotAdminAPI('/api/v1/subs/summary');
  if (data === null) {
    return res.json({ available: false });
  }
  res.json({ available: true, ...data });
});

// === API: Bot Executable Path ===
app.get('/api/bot/executable', (req, res) => {
  res.json({
    current: bot.getExecutablePath(),
    custom: bot.customExePath,
    botDir: BOT_DIR
  });
});

app.post('/api/bot/executable', (req, res) => {
  const { path: exePath } = req.body;
  if (!exePath) return res.status(400).json({ success: false, message: '路径不能为空' });
  bot.setExecutablePath(exePath);
  res.json({ success: true, message: '可执行文件路径已更新' });
});

// === API: WebUI Settings ===
app.get('/api/webui/config', (req, res) => {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      res.json(JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')));
    } else {
      res.json({ executablePath: null, botDir: BOT_DIR });
    }
  } catch (e) {
    res.json({ executablePath: null, botDir: BOT_DIR });
  }
});

app.post('/api/webui/config', (req, res) => {
  try {
    let cfg = {};
    if (fs.existsSync(CONFIG_FILE)) {
      cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
    Object.assign(cfg, req.body);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
    if (req.body.executablePath !== undefined) {
      bot.setExecutablePath(req.body.executablePath);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// === API: AutoStart ===
app.get('/api/autostart', (req, res) => {
  res.json(autoStart.getStatus());
});

app.post('/api/autostart', (req, res) => {
  res.json(autoStart.toggle());
});

// === API: System Info ===
app.get('/api/system', (req, res) => {
  const os = require('os');
  res.json({
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname(),
    cpus: os.cpus().length,
    totalMemory: os.totalmem(),
    freeMemory: os.freemem(),
    uptime: os.uptime(),
    nodeVersion: process.version,
    botDir: BOT_DIR,
    workingDir: bot.getWorkingDir(),
    configExists: fs.existsSync(getConfigPath()),
    logsDirExists: fs.existsSync(getLogsDir()),
    webuiVersion: '1.0.0'
  });
});

// === Socket.IO ===
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  // Send initial state
  socket.emit('bot:status', bot.getStatus());
  socket.emit('logs:recent', bot.getRecentLogs(100));

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// Bot event hooks — emit to Socket.IO clients AND track OneBot state
bot.onLog((entry) => {
  updateOnebotStateFromLog(entry.message);
  io.emit('logs:new', entry);
});

bot.onStatusChange((status) => {
  if (status !== 'running') {
    onebotConnected = false;
    onebotConnectedSince = null;
  }
  io.emit('bot:status', bot.getStatus());
});

logWatcher.on('log', (entry) => {
  io.emit('logs:new', entry);
});

// === Auto-poll Bot Admin API for real-time status ===
let adminPollTimer = null;

function startAdminPolling() {
  if (adminPollTimer) return;
  adminPollTimer = setInterval(async () => {
    if (bot.status !== 'running') return;

    // Poll OneBot status
    const obStatus = await queryBotAdminAPI('/api/v1/onebot/status');
    if (obStatus) {
      const wasConnected = onebotConnected;
      onebotConnected = !!obStatus.online;
      if (onebotConnected && !wasConnected) {
        onebotConnectedSince = new Date();
      } else if (!onebotConnected) {
        onebotConnectedSince = null;
      }
      // Broadcast if state changed
      if (wasConnected !== onebotConnected) {
        io.emit('bot:status', bot.getStatus());
        io.emit('onebot:status', { connected: onebotConnected });
      }
    }

    // Poll subscription summary
    const subSummary = await queryBotAdminAPI('/api/v1/subs/summary');
    if (subSummary) {
      io.emit('subs:summary', subSummary);
    }
  }, 5000); // every 5 seconds
}

function stopAdminPolling() {
  if (adminPollTimer) {
    clearInterval(adminPollTimer);
    adminPollTimer = null;
  }
}

// Start/stop polling with bot lifecycle
bot.onStatusChange((status) => {
  if (status === 'running') {
    // Give bot a few seconds to start, then begin polling
    setTimeout(() => startAdminPolling(), 5000);
  } else {
    stopAdminPolling();
  }
});

// === Start ===
logWatcher.start();

server.listen(WEB_PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════╗
║   DDBOT-WSa WebUI 已启动                     ║
║   地址: http://localhost:${WEB_PORT}              ║
║   根目录: ${EXE_DIR}
║   配置文件: ${CONFIG_FILE}
║   数据目录: ${DATA_DIR}
║   日志目录: ${LOG_DIR}
║   Bot目录: ${BOT_DIR}
╚══════════════════════════════════════════════╝
  `);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n正在关闭...');
  logWatcher.stop();
  bot.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logWatcher.stop();
  bot.stop();
  process.exit(0);
});
