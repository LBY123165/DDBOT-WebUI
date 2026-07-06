// === DDBOT-WSa WebUI Frontend ===

// Theme toggle (must run before DOM render)
(function() {
  const saved = localStorage.getItem('theme') || 'dark';
  if (saved === 'light') document.documentElement.setAttribute('data-theme', 'light');
})();

const socket = io();
let currentPage = 'dashboard';
let autoScroll = true;
let allLogs = [];
let allSubs = [];
let configParsed = {};

// === Socket.IO Events ===
socket.on('connect', () => {
  console.log('[WS] Connected');
  updateSidebarStatus('online', '已连接');
  toast('success', '已连接到 WebUI 服务');
});

socket.on('disconnect', () => {
  console.log('[WS] Disconnected');
  updateSidebarStatus('offline', '连接断开');
  toast('error', '与 WebUI 服务断开连接');
});

socket.on('bot:status', (data) => {
  updateBotStatus(data);
});

socket.on('logs:new', (entry) => {
  allLogs.push(entry);
  if (allLogs.length > 2000) allLogs = allLogs.slice(-1500);
  appendLogEntry(entry);
});

socket.on('logs:recent', (logs) => {
  allLogs = logs;
  renderDashboardLogs();
  renderLogTerminal();
});

// Real-time OneBot status from admin API polling
socket.on('onebot:status', (data) => {
  if (currentPage === 'adapter') {
    const badge = document.getElementById('adapterConnBadge');
    if (data.connected) {
      badge.textContent = '已连接';
      badge.className = 'status-badge connected';
    } else {
      badge.textContent = '未连接';
      badge.className = 'status-badge stopped';
    }
    updateAdapterStatus({ connected: data.connected });
  }
  // Update dashboard card
  const obBadge = document.getElementById('onebotStatusBadge');
  if (obBadge) {
    obBadge.textContent = data.connected ? '已连接' : '未连接';
    obBadge.className = 'status-badge ' + (data.connected ? 'connected' : 'stopped');
  }
});

// Real-time subscription summary from admin API
socket.on('subs:summary', (data) => {
  if (data && data.bySite) {
    const el = document.getElementById('subTotal');
    if (el) el.textContent = data.total || 0;
    const bl = document.getElementById('subBilibili');
    if (bl) bl.textContent = data.bySite.bilibili || 0;
    const dy = document.getElementById('subDouyu');
    if (dy) dy.textContent = data.bySite.douyu || 0;
    const yt = document.getElementById('subYoutube');
    if (yt) yt.textContent = data.bySite.youtube || 0;
    const known = (data.bySite.bilibili||0) + (data.bySite.douyu||0) + (data.bySite.youtube||0);
    const ot = document.getElementById('subOther');
    if (ot) ot.textContent = (data.total || 0) - known;
  }
});

// === Theme Toggle ===
function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  if (isLight) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'dark');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  }
  updateThemeUI();
}

function updateThemeUI() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const icon = document.getElementById('themeIcon');
  const label = document.getElementById('themeLabel');
  if (icon) icon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
  if (label) label.textContent = isLight ? '亮色' : '暗色';
}

// === Page Navigation ===
function navigateTo(page) {
  currentPage = page;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });

  // Update pages
  document.querySelectorAll('.page').forEach(el => {
    el.classList.toggle('active', el.id === `page-${page}`);
  });

  // Load page data
  switch (page) {
    case 'dashboard': refreshStatus(); break;
    case 'adapter': loadAdapterConfig(); break;
    case 'logs': renderLogTerminal(); break;
    case 'subscriptions': loadSubscriptions(); break;
    case 'settings': loadAllSettings(); break;
  }
}

document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', (e) => {
    e.preventDefault();
    navigateTo(el.dataset.page);
  });
});

// === Bot Process Control ===
async function startBot() {
  const btn = document.getElementById('btnStart');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 启动中...';
  try {
    const res = await fetch('/api/bot/start', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast('success', data.message);
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '请求失败: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-play"></i> 启动';
}

async function stopBot() {
  const btn = document.getElementById('btnStop');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 停止中...';
  try {
    const res = await fetch('/api/bot/stop', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast('success', data.message);
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '请求失败: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-stop"></i> 停止';
}

async function restartBot() {
  const btn = document.getElementById('btnRestart');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 重启中...';
  try {
    const res = await fetch('/api/bot/restart', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast('success', data.message);
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '请求失败: ' + e.message);
  }
  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-rotate-right"></i> 重启';
}

function updateBotStatus(data) {
  const badge = document.getElementById('botStatusBadge');
  const pidEl = document.getElementById('botPid');
  const uptimeEl = document.getElementById('botUptime');
  const exeEl = document.getElementById('botExe');
  const workDirEl = document.getElementById('botWorkDir');
  const btnStart = document.getElementById('btnStart');
  const btnStop = document.getElementById('btnStop');
  const btnRestart = document.getElementById('btnRestart');
  const sidebarDot = document.getElementById('sidebarStatusDot');
  const sidebarText = document.getElementById('sidebarStatusText');

  const statusText = {
    running: '运行中',
    stopped: '已停止',
    error: '异常',
    unknown: '未知'
  };

  badge.textContent = statusText[data.status] || data.status;
  badge.className = 'status-badge ' + data.status;

  pidEl.textContent = data.pid ? `PID: ${data.pid}` : '';
  uptimeEl.textContent = data.uptime > 0 ? formatUptime(data.uptime) : '-';
  exeEl.textContent = data.executable || '-';
  if (workDirEl) workDirEl.textContent = data.workingDir || data.botDir || '-';

  btnStart.disabled = data.status === 'running';
  btnStop.disabled = data.status !== 'running';
  btnRestart.disabled = data.status !== 'running';

  // Sidebar status
  if (data.status === 'running') {
    sidebarDot.className = 'status-dot running';
    sidebarText.textContent = `运行中 (PID: ${data.pid})`;
  } else if (data.status === 'error') {
    sidebarDot.className = 'status-dot offline';
    sidebarText.textContent = '异常退出';
  } else {
    sidebarDot.className = 'status-dot';
    sidebarText.textContent = '已停止';
  }
}

async function refreshStatus() {
  try {
    const [botRes, obRes, sysRes, autoRes] = await Promise.all([
      fetch('/api/bot/status'),
      fetch('/api/onebot/status'),
      fetch('/api/system'),
      fetch('/api/autostart')
    ]);

    const botData = await botRes.json();
    const obData = await obRes.json();
    const sysData = await sysRes.json();
    const autoData = await autoRes.json();

    updateBotStatus(botData);
    updateOneBotStatus(obData);
    updateSystemInfo(sysData);
    updateAutoStartStatus(autoData);

    // Also update adapter page if visible
    if (currentPage === 'adapter') {
      updateAdapterStatus(obData);
      updateAdapterDetails(obData);
    }
  } catch (e) {
    console.error('Refresh failed:', e);
  }
}

function updateOneBotStatus(data) {
  const badge = document.getElementById('onebotStatusBadge');
  const proto = document.getElementById('obProtocol');
  const mode = document.getElementById('obMode');
  const addr = document.getElementById('obAddr');

  if (data.connected) {
    badge.textContent = '已连接';
    badge.className = 'status-badge connected';
  } else {
    badge.textContent = '未连接';
    badge.className = 'status-badge stopped';
  }

  proto.textContent = data.mode || '-';
  mode.textContent = data.wsMode || '-';
  addr.textContent = data.wsAddr || '-';
}

function updateSystemInfo(data) {
  document.getElementById('sysPlatform').textContent = `${data.platform} ${data.arch}`;
  document.getElementById('sysCpu').textContent = `${data.cpus} 核心`;
  document.getElementById('sysMemory').textContent = formatBytes(data.freeMemory) + ' / ' + formatBytes(data.totalMemory);
  document.getElementById('sysNode').textContent = data.nodeVersion || '-';
  document.getElementById('configPath').textContent = data.botDir || '-';
}

function updateAutoStartStatus(data) {
  const badge = document.getElementById('autoStartBadge');
  const status = document.getElementById('autoStartStatus');

  if (data.registered) {
    badge.textContent = '已启用';
    badge.className = 'status-badge enabled';
    status.textContent = '开机自动启动';
  } else {
    badge.textContent = '未启用';
    badge.className = 'status-badge stopped';
    status.textContent = '手动启动';
  }
}

async function toggleAutoStart() {
  try {
    const res = await fetch('/api/autostart', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      toast('success', data.message);
      refreshStatus();
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '操作失败: ' + e.message);
  }
}

// === Logs ===
function appendLogEntry(entry) {
  // Dashboard preview
  if (currentPage === 'dashboard') {
    const container = document.getElementById('dashboardLogs');
    const empty = container.querySelector('.log-empty');
    if (empty) empty.remove();

    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `
      <span class="log-time">${formatLogTime(entry.time)}</span>
      <span class="log-level ${(entry.level || entry.type || 'info').toLowerCase()}">${entry.level || entry.type || 'info'}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;
    container.appendChild(div);
    while (container.children.length > 50) container.removeChild(container.firstChild);
    container.scrollTop = container.scrollHeight;
  }

  // Log terminal
  if (currentPage === 'logs') {
    const terminal = document.getElementById('logTerminal');
    const empty = terminal.querySelector('.log-empty');
    if (empty) empty.remove();

    const level = (entry.level || entry.type || 'info').toLowerCase();
    const filter = document.getElementById('logLevelFilter').value;
    if (filter !== 'all' && level !== filter) return;

    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.level = level;
    div.innerHTML = `
      <span class="log-time">${formatLogTime(entry.time)}</span>
      <span class="log-level ${level}">${entry.level || entry.type || 'info'}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;
    terminal.appendChild(div);
    while (terminal.children.length > 3000) terminal.removeChild(terminal.firstChild);
    if (autoScroll) terminal.scrollTop = terminal.scrollHeight;
  }
}

function renderDashboardLogs() {
  const container = document.getElementById('dashboardLogs');
  container.innerHTML = '';
  const recent = allLogs.slice(-50);
  if (recent.length === 0) {
    container.innerHTML = '<div class="log-empty">暂无日志</div>';
    return;
  }
  for (const entry of recent) {
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = `
      <span class="log-time">${formatLogTime(entry.time)}</span>
      <span class="log-level ${(entry.level || entry.type || 'info').toLowerCase()}">${entry.level || entry.type || 'info'}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;
    container.appendChild(div);
  }
  container.scrollTop = container.scrollHeight;
}

function renderLogTerminal() {
  const terminal = document.getElementById('logTerminal');
  terminal.innerHTML = '';
  if (allLogs.length === 0) {
    terminal.innerHTML = '<div class="log-empty">等待日志输出...</div>';
    return;
  }
  const filter = document.getElementById('logLevelFilter')?.value || 'all';
  for (const entry of allLogs) {
    const level = (entry.level || entry.type || 'info').toLowerCase();
    if (filter !== 'all' && level !== filter) continue;
    const div = document.createElement('div');
    div.className = 'log-line';
    div.dataset.level = level;
    div.innerHTML = `
      <span class="log-time">${formatLogTime(entry.time)}</span>
      <span class="log-level ${level}">${entry.level || entry.type || 'info'}</span>
      <span class="log-msg">${escapeHtml(entry.message)}</span>
    `;
    terminal.appendChild(div);
  }
  terminal.scrollTop = terminal.scrollHeight;
}

function filterLogs() {
  renderLogTerminal();
}

function clearLogs() {
  allLogs = [];
  const terminal = document.getElementById('logTerminal');
  terminal.innerHTML = '<div class="log-empty">日志已清空</div>';
  const preview = document.getElementById('dashboardLogs');
  preview.innerHTML = '<div class="log-empty">日志已清空</div>';
}

function toggleAutoScroll() {
  autoScroll = !autoScroll;
  const btn = document.getElementById('btnAutoScroll');
  btn.style.opacity = autoScroll ? '1' : '0.5';
  toast('info', autoScroll ? '已开启自动滚动' : '已关闭自动滚动');
}

// === Subscriptions ===
async function loadSubscriptions() {
  try {
    const res = await fetch('/api/subscriptions');
    const result = await res.json();
    // result: { source: 'bot'|'local', data: [...] }
    const data = result.data || result; // handle both old and new format
    allSubs = Array.isArray(data) ? data : [];
    renderSubscriptions();
  } catch (e) {
    toast('error', '加载订阅失败');
  }

  // Load summary from bot API
  try {
    const sumRes = await fetch('/api/subscriptions/summary');
    const sumData = await sumRes.json();
    if (sumData.total !== undefined) {
      document.getElementById('subTotal').textContent = sumData.total || 0;
      document.getElementById('subBilibili').textContent = (sumData.bySite && sumData.bySite.bilibili) || 0;
      document.getElementById('subDouyu').textContent = (sumData.bySite && sumData.bySite.douyu) || 0;
      document.getElementById('subYoutube').textContent = (sumData.bySite && sumData.bySite.youtube) || 0;
      const known = ((sumData.bySite && sumData.bySite.bilibili) || 0)
        + ((sumData.bySite && sumData.bySite.douyu) || 0)
        + ((sumData.bySite && sumData.bySite.youtube) || 0);
      document.getElementById('subOther').textContent = (sumData.total || 0) - known;
    }
  } catch (e) {}
}

function renderSubscriptions() {
  const tbody = document.getElementById('subTableBody');
  const search = document.getElementById('subSearch').value.toLowerCase();

  const filtered = allSubs.filter(s => {
    if (!search) return true;
    return (s.name || '').toLowerCase().includes(search) ||
           (s.id || '').toLowerCase().includes(search) ||
           (s.site || '').toLowerCase().includes(search) ||
           (s.userId || '').toLowerCase().includes(search);
  });

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr class="empty-row"><td colspan="7">暂无订阅</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(s => {
    // Bot API: {id, site, type, groupCode, name}
    // Local: {id, site, userId, types, group, name}
    const uid = s.userId || s.id || '-';
    const subName = s.name || '-';
    const subTypes = s.types || (s.type ? [s.type] : []);
    const group = s.group || s.groupCode || '-';
    return `
    <tr>
      <td><span class="site-badge ${s.site}">${getSiteName(s.site)}</span></td>
      <td class="mono">${escapeHtml(String(uid))}</td>
      <td>${escapeHtml(subName)}</td>
      <td>${subTypes.map(t => `<span class="type-tag ${t}">${getTypeName(t)}</span>`).join('')}</td>
      <td class="mono">${escapeHtml(String(group))}</td>
      <td><span class="sub-status-active">● 活跃</span></td>
      <td>
        <div class="sub-actions">
          <button class="btn btn-sm" onclick="editSubscription('${s.id}','${s.site}','${uid}','${subName}','${group}',${JSON.stringify(subTypes).replace(/"/g, '&quot;')})" title="编辑">
            <i class="fas fa-pen"></i>
          </button>
          <button class="btn btn-sm btn-danger" onclick="deleteSubscription('${s.id}')" title="删除">
            <i class="fas fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>
  `}).join('');
}

function updateSubStats() {
  document.getElementById('subTotal').textContent = allSubs.length;
  document.getElementById('subBilibili').textContent = allSubs.filter(s => s.site === 'bilibili').length;
  document.getElementById('subDouyu').textContent = allSubs.filter(s => s.site === 'douyu').length;
  document.getElementById('subYoutube').textContent = allSubs.filter(s => s.site === 'youtube').length;
  document.getElementById('subOther').textContent = allSubs.filter(s => !['bilibili', 'douyu', 'youtube'].includes(s.site)).length;
}

function filterSubs() {
  renderSubscriptions();
}

function showAddSubModal() {
  document.getElementById('addSubModal').classList.add('show');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('show');
}

async function addSubscription() {
  const site = document.getElementById('subSite').value;
  const id = document.getElementById('subId').value.trim();
  const name = document.getElementById('subName').value.trim();
  const group = document.getElementById('subGroup').value.trim();
  const types = Array.from(document.querySelectorAll('#subTypeCheckboxes input:checked')).map(el => el.value);

  if (!id) return toast('error', '请输入用户ID');
  if (!group) return toast('error', '请输入群号');
  if (types.length === 0) return toast('error', '请选择订阅类型');

  try {
    const res = await fetch('/api/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site,
        id,
        type: types[0],
        groupCode: parseInt(group) || 0,
        name
      })
    });
    const data = await res.json();
    if (data.success) {
      toast('success', data.source === 'bot' ? '订阅已添加 (Bot API)' : '订阅已添加');
      closeModal('addSubModal');
      document.getElementById('subId').value = '';
      document.getElementById('subName').value = '';
      document.getElementById('subGroup').value = '';
      loadSubscriptions();
    } else {
      toast('error', data.message || '添加失败');
    }
  } catch (e) {
    toast('error', '添加失败: ' + e.message);
  }
}

async function deleteSubscription(id) {
  if (!confirm('确定要删除这条订阅吗？')) return;
  // Find the sub data for site/type info
  const sub = allSubs.find(s => String(s.id) === String(id));
  const params = sub ? `?site=${sub.site || ''}&type=${sub.type || ''}` : '';
  try {
    const res = await fetch(`/api/subscriptions/${id}${params}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('success', data.source === 'bot' ? '已删除 (Bot API)' : '已删除');
      loadSubscriptions();
    } else {
      toast('error', data.message || '删除失败');
    }
  } catch (e) {
    toast('error', '删除失败');
  }
}

function editSubscription(id, site, uid, name, groupCode, types) {
  document.getElementById('editSubId').value = id;
  document.getElementById('editSubSite').value = site;
  document.getElementById('editSubGroupCode').value = groupCode;
  document.getElementById('editSubInfo').innerHTML =
    `<span class="site-badge ${site}">${getSiteName(site)}</span> ${escapeHtml(uid)} ${name ? '(' + escapeHtml(name) + ')' : ''}`;

  // Check the current types
  const checkboxes = document.querySelectorAll('#editSubTypeCheckboxes input[type="checkbox"]');
  const currentTypes = Array.isArray(types) ? types : (types ? [types] : []);
  checkboxes.forEach(cb => {
    cb.checked = currentTypes.includes(cb.value);
  });

  document.getElementById('editSubModal').classList.add('show');
}

async function saveEditSub() {
  const id = document.getElementById('editSubId').value;
  const site = document.getElementById('editSubSite').value;
  const groupCode = document.getElementById('editSubGroupCode').value;
  const newTypes = Array.from(document.querySelectorAll('#editSubTypeCheckboxes input:checked')).map(el => el.value);

  if (newTypes.length === 0) return toast('error', '请至少选择一种类型');

  try {
    const res = await fetch(`/api/subscriptions/${id}/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site, groupCode: parseInt(groupCode) || 0, types: newTypes })
    });
    const data = await res.json();
    if (data.success) {
      toast('success', '订阅类型已更新');
      closeModal('editSubModal');
      loadSubscriptions();
    } else {
      toast('error', data.message || '更新失败');
    }
  } catch (e) {
    toast('error', '更新失败: ' + e.message);
  }
}

// === Config / Settings ===
function switchSettingsTab(btn) {
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.settings-tab-content').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(btn.dataset.tab).classList.add('active');
}

// Get nested value by dot-path: getVal({a:{b:1}}, 'a.b') => 1
function getVal(obj, path) {
  const keys = path.split('.');
  let v = obj;
  for (const k of keys) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = v[k];
  }
  return v;
}

// Set nested value by dot-path
function setVal(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!o[keys[i]] || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

// Fill all settings form fields from config object
function fillSettingsFromConfig(config) {
  document.querySelectorAll('[data-path]').forEach(el => {
    const path = el.dataset.path;
    if (path === '__exePath') return; // handled separately
    const val = getVal(config, path);
    if (val === undefined) return;

    if (el.dataset.type === 'array' && Array.isArray(val)) {
      el.value = val.join('\n');
    } else if (el.tagName === 'SELECT') {
      el.value = String(val);
    } else if (el.type === 'number') {
      // emitInterval might be "5s" string
      const num = parseInt(String(val));
      if (!isNaN(num)) el.value = num;
    } else {
      el.value = typeof val === 'object' ? JSON.stringify(val) : val;
    }
  });
}

// Read all settings form fields into config object
function readSettingsFromForm(config) {
  document.querySelectorAll('[data-path]').forEach(el => {
    const path = el.dataset.path;
    if (path === '__exePath') return;

    let value;
    if (el.dataset.type === 'array') {
      value = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    } else if (el.tagName === 'SELECT') {
      if (el.value === 'true') value = true;
      else if (el.value === 'false') value = false;
      else value = el.value;
    } else if (el.type === 'number') {
      value = parseInt(el.value);
      if (isNaN(value)) return;
      // Append "s" suffix for emitInterval
      if (path === 'concern.emitInterval') value = value + 's';
    } else {
      value = el.value;
      if (value === '') return; // don't overwrite with empty
    }

    setVal(config, path, value);
  });
  return config;
}

async function loadAllSettings() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    configParsed = data.parsed || {};

    if (data.exists) {
      document.getElementById('configEditor').value = data.content;
    } else {
      document.getElementById('configEditor').value = '# application.yaml 不存在\n# 请先启动一次 Bot 生成默认配置';
    }

    fillSettingsFromConfig(configParsed);
  } catch (e) {
    toast('error', '加载配置失败');
  }
  loadExePath();
}

async function saveSettingsSection(tabId) {
  try {
    // Reload current config first
    const res = await fetch('/api/config');
    const data = await res.json();
    configParsed = data.parsed || {};

    // Read form values into config
    const section = document.getElementById(tabId);
    const fields = section.querySelectorAll('[data-path]');

    fields.forEach(el => {
      const path = el.dataset.path;
      if (path === '__exePath') return;

      let value;
      if (el.dataset.type === 'array') {
        value = el.value.split('\n').map(s => s.trim()).filter(Boolean);
      } else if (el.tagName === 'SELECT') {
        if (el.value === 'true') value = true;
        else if (el.value === 'false') value = false;
        else value = el.value;
      } else if (el.type === 'number') {
        value = parseInt(el.value);
        if (isNaN(value)) return;
        if (path === 'concern.emitInterval') value = value + 's';
      } else {
        value = el.value;
        if (value === '') return;
      }

      setVal(configParsed, path, value);
    });

    // Save
    const yamlContent = jsYamlDump(configParsed);
    const saveRes = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: yamlContent })
    });
    const saveData = await saveRes.json();

    if (saveData.success) {
      toast('success', '配置已保存，Bot 将自动热重载');
    } else {
      toast('error', saveData.message);
    }
  } catch (e) {
    toast('error', '保存失败: ' + e.message);
  }
}

async function saveRawConfig() {
  const content = document.getElementById('configEditor').value;
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (data.success) {
      toast('success', '配置已保存');
      // Reload settings forms
      try { configParsed = JSON.parse(content); } catch(e) { configParsed = {}; }
      fillSettingsFromConfig(configParsed);
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '保存失败: ' + e.message);
  }
}

// Keep old loadConfig as alias for compatibility
async function loadConfig() { await loadAllSettings(); }

// === Utility ===
function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}天 ${h % 24}时 ${m % 60}分`;
  if (h > 0) return `${h}时 ${m % 60}分`;
  if (m > 0) return `${m}分 ${s % 60}秒`;
  return `${s}秒`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function formatLogTime(time) {
  if (!time) return '--:--:--';
  try {
    const d = new Date(time);
    if (isNaN(d.getTime())) {
      // Try to extract time from logrus format
      const match = time.match(/T(\d{2}:\d{2}:\d{2})/);
      return match ? match[1] : time.slice(0, 8);
    }
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  } catch (e) {
    return time.slice(0, 8);
  }
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getSiteName(site) {
  const names = {
    bilibili: 'B站', douyu: '斗鱼', youtube: 'YouTube', huya: '虎牙',
    acfun: 'AcFun', weibo: '微博', twitter: 'Twitter', douyin: '抖音',
    twitch: 'Twitch', twitcasting: 'TwitCasting', xhs: '小红书', xhh: '小黑盒'
  };
  return names[site] || site;
}

function getTypeName(type) {
  const names = { live: '直播', news: '动态', dynamic: '动态' };
  return names[type] || type;
}

function updateSidebarStatus(type, text) {
  const dot = document.getElementById('sidebarStatusDot');
  const txt = document.getElementById('sidebarStatusText');
  dot.className = 'status-dot ' + type;
  txt.textContent = text;
}

function toast(type, message) {
  const container = document.getElementById('toastContainer');
  const icons = {
    success: 'fa-check-circle',
    error: 'fa-times-circle',
    warning: 'fa-exclamation-triangle',
    info: 'fa-info-circle'
  };

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `
    <i class="fas ${icons[type] || icons.info}"></i>
    <span class="toast-msg">${escapeHtml(message)}</span>
  `;
  container.appendChild(el);

  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 200);
  }, 3000);
}

// Simple YAML dump (basic implementation)
function jsYamlDump(obj, indent = 0) {
  let result = '';
  const prefix = '  '.repeat(indent);
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result += `${prefix}${key}:\n`;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      result += `${prefix}${key}:\n${jsYamlDump(value, indent + 1)}`;
    } else if (Array.isArray(value)) {
      result += `${prefix}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object') {
          result += `${prefix}  -\n${jsYamlDump(item, indent + 2)}`;
        } else {
          result += `${prefix}  - ${item}\n`;
        }
      }
    } else if (typeof value === 'string' && (value.includes(':') || value.includes('#') || value.includes("'"))) {
      result += `${prefix}${key}: "${value}"\n`;
    } else {
      result += `${prefix}${key}: ${value}\n`;
    }
  }
  return result;
}

// === Adapter Connection Management ===
let adapterEvents = [];

async function loadAdapterConfig() {
  try {
    const res = await fetch('/api/onebot/status');
    const data = await res.json();

    // Fill form fields
    document.getElementById('adapterProtocol').value = data.mode || 'onebot-v11';
    document.getElementById('adapterWsMode').value = data.wsMode || 'ws-server';
    document.getElementById('adapterWsServer').value = data.wsMode !== 'ws-reverse' ? (data.wsAddr || '0.0.0.0:15630') : '0.0.0.0:15630';
    document.getElementById('adapterWsReverse').value = data.wsMode === 'ws-reverse' ? (data.wsAddr || 'ws://localhost:3001') : 'ws://localhost:3001';
    document.getElementById('adapterToken').value = '';

    updateAdapterVisibility();
    updateAdapterStatus(data);
    updateAdapterDetails(data);
  } catch (e) {
    toast('error', '加载适配器配置失败');
  }

  // Load Telegram config
  try {
    const cfgRes = await fetch('/api/config');
    const cfgData = await cfgRes.json();
    const config = cfgData.parsed || {};
    const tg = config.telegram || {};

    document.getElementById('tgEnable').value = String(tg.enable || false);
    document.getElementById('tgToken').value = tg.token || '';
    document.getElementById('tgEndpoint').value = tg.endpoint || '';
    document.getElementById('tgProxyEnable').value = String(tg.proxy?.enable || false);
    document.getElementById('tgProxyUrl').value = tg.proxy?.url || '';

    const tgBadge = document.getElementById('tgStatusBadge');
    if (tg.enable && tg.token) {
      tgBadge.textContent = '已配置';
      tgBadge.className = 'status-badge enabled';
    } else {
      tgBadge.textContent = '未启用';
      tgBadge.className = 'status-badge stopped';
    }
  } catch (e) {}
}

function updateAdapterVisibility() {
  const mode = document.getElementById('adapterWsMode').value;
  document.getElementById('wsServerRow').style.display = mode === 'ws-server' ? '' : 'none';
  document.getElementById('wsReverseRow').style.display = mode === 'ws-reverse' ? '' : 'none';
}

function onAdapterChange() {
  updateAdapterVisibility();
}

function updateAdapterStatus(data) {
  const banner = document.getElementById('adapterBanner');
  const title = document.getElementById('adapterBannerTitle');
  const desc = document.getElementById('adapterBannerDesc');
  const badge = document.getElementById('adapterConnBadge');

  banner.className = 'adapter-status-banner';

  if (data.connected) {
    banner.classList.add('connected');
    title.textContent = '已连接';
    desc.textContent = `${data.mode} 协议 · ${data.wsMode} 模式 · ${data.wsAddr}`;
    badge.textContent = '已连接';
    badge.className = 'status-badge connected';
  } else {
    banner.classList.add('disconnected');
    title.textContent = '未连接';
    desc.textContent = `${data.mode} 协议 · ${data.wsMode} 模式 · 等待客户端连接`;
    badge.textContent = '未连接';
    badge.className = 'status-badge stopped';
  }
}

function updateAdapterDetails(data) {
  document.getElementById('adapterDetailProto').textContent = data.mode || '-';
  document.getElementById('adapterDetailMode').textContent = data.wsMode === 'ws-server' ? '正向 WS (Server)' : '反向 WS (Client)';
  document.getElementById('adapterDetailAddr').textContent = data.wsAddr || '-';
  document.getElementById('adapterDetailToken').textContent = data.token || '未设置';
}

async function testAdapterConnection() {
  const btn = document.getElementById('btnAdapterTest');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> 测试中...';

  addAdapterEvent('test', '开始测试连接...');

  try {
    const res = await fetch('/api/onebot/status');
    const data = await res.json();

    if (data.connected) {
      addAdapterEvent('connect', `连接成功 - ${data.wsAddr}`);
      toast('success', '连接测试通过');
    } else {
      // Try to connect to the address
      const addr = data.wsAddr || '0.0.0.0:15630';
      addAdapterEvent('info', `尝试连接 ${addr} ...`);

      // Use the server-side port check
      const testRes = await fetch('/api/onebot/status');
      const testData = await testRes.json();

      if (testData.connected) {
        addAdapterEvent('connect', `连接成功 - ${addr}`);
        toast('success', '连接测试通过');
      } else {
        addAdapterEvent('disconnect', `无法连接到 ${addr} - 请检查客户端是否已启动`);
        toast('warning', '未检测到连接，请检查 OneBot 客户端');
      }
    }

    updateAdapterStatus(data);
    updateAdapterDetails(data);
  } catch (e) {
    addAdapterEvent('error', `测试失败: ${e.message}`);
    toast('error', '连接测试失败');
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-satellite-dish"></i> 测试连接';
}

async function saveAdapterConfig() {
  try {
    // First load current config
    const cfgRes = await fetch('/api/config');
    const cfgData = await cfgRes.json();
    let config = cfgData.parsed || {};

    // Update adapter settings
    if (!config.adapter) config.adapter = {};
    if (!config.websocket) config.websocket = {};

    config.adapter.mode = document.getElementById('adapterProtocol').value;
    config.websocket.mode = document.getElementById('adapterWsMode').value;
    config.websocket['ws-server'] = document.getElementById('adapterWsServer').value || '0.0.0.0:15630';
    config.websocket['ws-reverse'] = document.getElementById('adapterWsReverse').value || 'ws://localhost:3001';

    const token = document.getElementById('adapterToken').value;
    if (token) config.websocket.token = token;

    // Convert to YAML and save
    const yamlContent = jsYamlDump(config);
    const saveRes = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: yamlContent })
    });
    const saveData = await saveRes.json();

    if (saveData.success) {
      toast('success', '适配器配置已保存');
      addAdapterEvent('info', '配置已更新');
      // Reload to reflect changes
      setTimeout(() => loadAdapterConfig(), 500);
    } else {
      toast('error', saveData.message);
    }
  } catch (e) {
    toast('error', '保存失败: ' + e.message);
  }
}

async function saveTelegramConfig() {
  try {
    const cfgRes = await fetch('/api/config');
    const cfgData = await cfgRes.json();
    let config = cfgData.parsed || {};

    if (!config.telegram) config.telegram = {};

    config.telegram.enable = document.getElementById('tgEnable').value === 'true';
    config.telegram.token = document.getElementById('tgToken').value;
    config.telegram.endpoint = document.getElementById('tgEndpoint').value;
    config.telegram.proxy = {
      enable: document.getElementById('tgProxyEnable').value === 'true',
      url: document.getElementById('tgProxyUrl').value
    };

    const yamlContent = jsYamlDump(config);
    const saveRes = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: yamlContent })
    });
    const saveData = await saveRes.json();

    if (saveData.success) {
      toast('success', 'Telegram 配置已保存');
      addAdapterEvent('info', 'Telegram 配置已更新');
      setTimeout(() => loadAdapterConfig(), 500);
    } else {
      toast('error', saveData.message);
    }
  } catch (e) {
    toast('error', '保存失败: ' + e.message);
  }
}

function addAdapterEvent(type, message) {
  const now = new Date();
  const time = now.toLocaleTimeString('zh-CN', { hour12: false });

  adapterEvents.unshift({ time, type, message });
  if (adapterEvents.length > 100) adapterEvents = adapterEvents.slice(0, 100);

  renderAdapterEvents();
}

function renderAdapterEvents() {
  const container = document.getElementById('adapterEvents');
  if (adapterEvents.length === 0) {
    container.innerHTML = '<div class="log-empty">暂无连接事件</div>';
    return;
  }

  container.innerHTML = adapterEvents.map(e => `
    <div class="adapter-event-item">
      <span class="adapter-event-time">${e.time}</span>
      <span class="adapter-event-type ${e.type}">${getEventTypeLabel(e.type)}</span>
      <span class="adapter-event-msg">${escapeHtml(e.message)}</span>
    </div>
  `).join('');
}

function getEventTypeLabel(type) {
  const labels = {
    connect: '连接',
    disconnect: '断开',
    error: '错误',
    info: '信息',
    test: '测试'
  };
  return labels[type] || type;
}

function clearAdapterEvents() {
  adapterEvents = [];
  renderAdapterEvents();
}

// Listen for bot logs that mention websocket/adapter events
socket.on('logs:new', (entry) => {
  const msg = (entry.message || '').toLowerCase();
  if (msg.includes('websocket') || msg.includes('ws') || msg.includes('onebot') || msg.includes('adapter') || msg.includes('connected') || msg.includes('disconnected')) {
    let type = 'info';
    if (msg.includes('connect') && !msg.includes('disconnect')) type = 'connect';
    if (msg.includes('disconnect')) type = 'disconnect';
    if (msg.includes('error') || msg.includes('fail')) type = 'error';
    addAdapterEvent(type, entry.message);
  }
});

// === Executable Path ===
async function loadExePath() {
  try {
    const res = await fetch('/api/bot/executable');
    const data = await res.json();
    document.getElementById('exePathInput').value = data.custom || '';
    document.getElementById('exePathCurrent').textContent = '当前: ' + (data.current || '自动检测');
  } catch (e) {}
}

async function saveExePath() {
  const p = document.getElementById('exePathInput').value.trim();
  try {
    const res = await fetch('/api/bot/executable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: p || null })
    });
    const data = await res.json();
    if (data.success) {
      toast('success', '路径已更新');
      loadExePath();
    } else {
      toast('error', data.message);
    }
  } catch (e) {
    toast('error', '保存失败');
  }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  updateThemeUI();
  refreshStatus();
  loadSubscriptions();
  loadExePath();
  loadAdapterConfig();

  // Keyboard shortcut for search
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      if (currentPage === 'subscriptions') {
        document.getElementById('subSearch').focus();
      }
    }
  });
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', (e) => {
    if (e.target === el) el.classList.remove('show');
  });
});
