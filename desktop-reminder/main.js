const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, onValue, onDisconnect, update, set, get } = require('firebase/database');

const TASK_ROOT = 'taskReminder';
const DEVICE_STALE_MS = 90000;
const REMINDER_POPUP_MS = 15 * 60 * 1000;
const firebaseConfig = {
  apiKey: 'AIzaSyAolG3b4LGGu_ra74QmtAeszDfSntdazjM',
  authDomain: 'giaoviec-5ac66.firebaseapp.com',
  databaseURL: 'https://giaoviec-5ac66-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'giaoviec-5ac66',
  storageBucket: 'giaoviec-5ac66.firebasestorage.app',
  messagingSenderId: '454020086133',
  appId: '1:454020086133:web:36c0b520b25cd75b3a3b3c'
};

let db;
let tray;
let popup;
let currentTask = null;
let employees = [];
let tasksUnsub = null;
let currentDay = todayStr();
let heartbeatTimer = null;

const configPath = () => path.join(app.getPath('userData'), 'config.json');
const safeHost = () => (os.hostname() || 'WINDOWS').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 24) || 'WINDOWS';

function readConfig(){
  try {
    const saved = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    if (!saved.deviceId) saved.deviceId = `DESKTOP-${crypto.randomUUID()}`;
    if (!saved.name) saved.name = `App-${safeHost()}`;
    saveConfig(saved);
    return saved;
  } catch {
    const cfg = { deviceId: `DESKTOP-${crypto.randomUUID()}`, name: `App-${safeHost()}` };
    fs.mkdirSync(path.dirname(configPath()), { recursive:true });
    fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
    return cfg;
  }
}
function saveConfig(cfg){
  fs.mkdirSync(path.dirname(configPath()), { recursive:true });
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2));
}
let config = readConfig();

function z(n){ return String(n).padStart(2, '0'); }
function todayStr(d = new Date()){ return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
function arr(v){ return Array.isArray(v) ? v.filter(Boolean) : Object.entries(v || {}).map(([key, value]) => typeof value === 'object' ? Object.assign({ id: value.id || key }, value) : value); }
function listNames(v){ return arr(v).map(x => typeof x === 'string' ? x.trim() : String((x && (x.name || x.title)) || '').trim()).filter(Boolean); }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function logLine(action, actor, extra){ return { at: Date.now(), action, actor, detail: extra || '' }; }
function compactDuration(ms){
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h}h${r ? r + 'p' : ''}`;
}
function taskRef(...parts){ return ref(db, [TASK_ROOT].concat(parts).filter(Boolean).join('/')); }
function reminderExpired(task){
  const reminder = (task || {}).activeReminder || {};
  return !!reminder.expired || Date.now() - (reminder.createdAt || 0) > REMINDER_POPUP_MS;
}
function reminderDone(task){
  const reminder = task && task.activeReminder;
  const ackedAuto = task && task.reminderAcked && (!reminder || reminder.type !== 'manual');
  return !task || task.status === 'Đã xong' || ackedAuto || !reminder || reminder.acknowledged || reminder.expired || reminderExpired(task);
}

function createTray(){
  if (tray) tray.destroy();
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" rx="14" fill="#dc2626"/><text x="32" y="43" text-anchor="middle" font-size="34">🔔</text></svg>';
  const icon = nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Nhắc Việc Shop - App nhắc việc');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Máy: ${config.name}`, enabled: false },
    { label: 'Đổi tên máy', click: openSettings },
    { type: 'separator' },
    { label: 'Thoát', click: () => app.quit() }
  ]));
}

function openSettings(){
  const win = new BrowserWindow({
    width: 420,
    height: 250,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
  });
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`
    <!doctype html><meta charset="utf-8"><title>Cài đặt</title>
    <style>
      body{font-family:Arial,Tahoma,sans-serif;margin:0;background:#f3f6fb;color:#111827}
      .box{padding:20px}.row{display:grid;gap:8px;margin:12px 0}
      label{font-weight:900;color:#475569}input{height:42px;border:1px solid #cbd5e1;border-radius:10px;padding:0 12px;font-weight:800}
      .actions{display:flex;justify-content:flex-end;gap:10px;margin-top:18px}
      button{height:40px;border:0;border-radius:10px;padding:0 16px;font-weight:900;cursor:pointer}.blue{background:#2563eb;color:#fff}.gray{background:#e9eef5}
    </style>
    <div class="box">
      <h2>Thiết bị nhắc việc</h2>
      <div class="row"><label>Tên máy</label><input id="name" value="${esc(config.name)}"></div>
      <small>ID cố định: ${esc(config.deviceId)}</small>
      <div class="actions"><button class="gray" onclick="window.close()">Đóng</button><button class="blue" onclick="save()">Lưu</button></div>
    </div>
    <script>
      const { ipcRenderer } = require('electron');
      function save(){ ipcRenderer.send('save-settings', document.getElementById('name').value.trim()); window.close(); }
    </script>
  `));
}

async function registerClient(){
  const clientRef = taskRef('desktopClients', config.deviceId);
  const now = Date.now();
  let previous = {};
  try { previous = (await get(clientRef)).val() || {}; } catch {}
  const wasAway = !previous.lastSeen || now - previous.lastSeen > DEVICE_STALE_MS;
  await update(clientRef, {
    id: config.deviceId,
    name: config.name,
    host: safeHost(),
    lastSeen: now,
    onlineSince: wasAway ? now : (previous.onlineSince || now),
    online: true,
    app: 'desktop-reminder'
  });
  onDisconnect(clientRef).update({ online:false, lastSeen: Date.now(), offlineSince: Date.now() }).catch(() => {});
}
function heartbeat(){
  registerClient().catch(() => {});
  clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(() => registerClient().catch(() => {}), 15000);
}

function listenFirebase(){
  onValue(taskRef('employees'), snap => { employees = listNames(snap.val()); });
  listenTasksForDay(todayStr());
  setInterval(() => {
    const now = todayStr();
    if (now !== currentDay) listenTasksForDay(now);
  }, 15000);
}
function listenTasksForDay(day){
  if (tasksUnsub) tasksUnsub();
  currentDay = day;
  tasksUnsub = onValue(taskRef('tasks', day), snap => handleTasks(arr(snap.val()).map(x => Object.assign({ date: day }, x))));
}
function handleTasks(tasks){
  if (currentTask) {
    const fresh = tasks.find(t => t.id === currentTask.id);
    if (reminderDone(fresh)) closePopup();
  }
  const active = tasks.filter(t => {
    const r = t.activeReminder;
    return r && !r.acknowledged && !r.expired && (r.type === 'manual' || !t.reminderAcked) && t.status !== 'Đã xong' && !reminderExpired(t);
  }).sort((a,b) => ((b.activeReminder || {}).createdAt || 0) - ((a.activeReminder || {}).createdAt || 0))[0];
  if (!active) return;
  if (popup && currentTask && currentTask.activeReminder && active.activeReminder && currentTask.activeReminder.id === active.activeReminder.id) return;
  showReminder(active);
}

async function markDelivered(task){
  const r = task.activeReminder;
  if (!r) return;
  await set(taskRef('reminderDeliveries', task.date, r.id, config.deviceId), {
    taskId: task.id,
    date: task.date,
    reminderId: r.id,
    deviceId: config.deviceId,
    deviceName: config.name,
    shownAt: Date.now(),
    ok: true
  }).catch(() => {});
}
function showReminder(task){
  closePopup();
  currentTask = task;
  markDelivered(task);
  const reminderId = task.activeReminder && task.activeReminder.id;
  const win = new BrowserWindow({
    width: 760,
    height: 620,
    alwaysOnTop: true,
    resizable: true,
    frame: true,
    show: false,
    autoHideMenuBar: true,
    title: 'Nhắc việc',
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false }
  });
  popup = win;
  win.removeMenu();
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(reminderHtml(task)));
  win.once('ready-to-show', () => {
    if (popup === win && !win.isDestroyed()) {
      try { win.show(); win.focus(); win.moveTop(); } catch {}
    }
  });
  win.on('closed', () => {
    if (popup === win) popup = null;
    if (currentTask && currentTask.activeReminder && currentTask.activeReminder.id === reminderId) currentTask = null;
  });
  setTimeout(() => {
    if (popup === win && currentTask && currentTask.activeReminder && currentTask.activeReminder.id === reminderId) {
      expireReminder(task, reminderId).finally(closePopup);
    }
  }, REMINDER_POPUP_MS);
}
async function expireReminder(task, reminderId){
  if (!task || !reminderId) return;
  try {
    const snap = await get(taskRef('tasks', task.date, task.id));
    const fresh = snap.val() || {};
    const reminder = fresh.activeReminder || {};
    if (reminder.id !== reminderId || reminder.acknowledged || reminder.expired) return;
    await update(taskRef('tasks', task.date, task.id), {
      activeReminder: Object.assign({}, reminder, { expired:true, expiredAt:Date.now(), expiredDevice:config.deviceId })
    });
  } catch {}
}
function closePopup(){
  const win = popup;
  popup = null;
  currentTask = null;
  if (win && !win.isDestroyed()) {
    try { win.close(); } catch {}
  }
}
function reminderHtml(task){
  const names = (task.employees && task.employees.length ? task.employees : employees);
  const chips = names.map(n => `<button class="choice" onclick="ack('${esc(n).replace(/'/g, "\\'")}')">${esc(n)}</button>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Nhắc việc</title>
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;overflow:hidden}body{margin:0;font-family:Arial,Tahoma,sans-serif;background:#fff7ed;color:#111827;font-weight:800}
    .panel{height:100vh;border:5px solid #ef4444;background:#fff7ed;display:flex;flex-direction:column;overflow:hidden}
    .head{background:#dc2626;color:white;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex:0 0 auto}
    h1{margin:0;font-size:32px;font-weight:1000}.x{width:44px;height:44px;border:0;border-radius:12px;background:#f1f5f9;font-size:22px;font-weight:1000;cursor:pointer}
    .body{padding:16px 24px;display:grid;gap:12px;flex:1 1 auto;min-height:0;overflow:hidden}.title{font-size:26px;font-weight:1000;margin:0;line-height:1.2}
    .emp{border:2px solid #fb923c;border-radius:16px;background:#fff7ed;padding:12px;margin:0}.emp small{display:block;color:#9a3412;margin-bottom:8px}
    .empName{display:inline-flex;border:4px solid #f59e0b;border-radius:999px;background:#fff7ed;padding:7px 17px;font-size:28px;font-weight:1000}
    .note,.content{border-radius:14px;padding:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;overflow:auto}
    .content{border:1px dashed #cbd5e1;background:white;max-height:170px}
    .note{border:1px solid #dbe5f2;background:#f8fafc;max-height:92px}
    .foot{padding:12px 24px;background:white;border-top:1px solid #fed7aa;display:flex;justify-content:flex-end;gap:12px;flex-wrap:wrap;flex:0 0 auto}
    button{height:46px;border:0;border-radius:12px;padding:0 18px;font-weight:1000;font-size:15px;cursor:pointer}.gray{background:#e9eef5}.orange{background:#f59e0b;color:#111827}
    #choices{display:none;gap:8px;flex-wrap:wrap;width:100%;justify-content:flex-end}.choice{background:white;border:2px solid #f59e0b;color:#111827}
  </style>
  <div class="panel">
    <div class="head"><h1>🔔 NHẮC VIỆC</h1><button class="x" onclick="dismiss()">×</button></div>
    <div class="body">
      <div class="title">${esc(task.time)} - ${esc(task.title)}</div>
      <div class="emp"><small>Nhân viên bàn giao</small>${names.map(n=>`<span class="empName">${esc(n)}</span>`).join(' ') || '<span class="empName">Chưa có</span>'}</div>
      <div class="content"><b>Nội dung</b><br>${esc(task.content || 'Không có')}</div>
      <div class="note"><b>Ghi chú admin</b><br>${esc(task.adminNote || 'Không có')}</div>
    </div>
    <div class="foot">
      <div id="choices">${chips}</div>
      <button class="gray" onclick="dismiss()">Không phải tôi</button>
      <button class="orange" onclick="showChoices()">Đã nhận nhắc</button>
    </div>
  </div>
  <script>
    const { ipcRenderer } = require('electron');
    let audioCtx, stopAt = Date.now() + 10000;
    function beep(){
      if (Date.now() > stopAt) return;
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = 880; g.gain.value = 0.12; o.connect(g); g.connect(audioCtx.destination); o.start(); setTimeout(()=>o.stop(),180);
      setTimeout(beep, 520);
    }
    function dismiss(){ ipcRenderer.send('dismiss-reminder'); }
    function showChoices(){ document.getElementById('choices').style.display='flex'; }
    function ack(actor){ ipcRenderer.send('ack-reminder', actor); }
    beep();
  </script>`;
}

ipcMain.on('dismiss-reminder', closePopup);
ipcMain.on('save-settings', (_ev, name) => {
  config = Object.assign({}, config, { name: name || config.name });
  saveConfig(config);
  registerClient().catch(() => {});
  createTray();
});
ipcMain.on('ack-reminder', async (_ev, actor) => {
  const task = currentTask;
  if (!task || !task.activeReminder) return closePopup();
  const reminder = Object.assign({}, task.activeReminder, {
    acknowledged: true,
    acknowledgedBy: actor,
    acknowledgedAt: Date.now(),
    acknowledgedDevice: config.deviceId
  });
  const logs = Array.isArray(task.logs) ? task.logs.slice() : [];
  logs.push(logLine('Đã nhận nhắc', actor, `App Windows: ${config.name}`));
  await update(taskRef('tasks', task.date, task.id), { activeReminder: reminder, reminderAcked: true, logs }).catch(() => {});
  await update(taskRef('reminderDeliveries', task.date, reminder.id, config.deviceId), {
    acknowledged: true,
    acknowledgedBy: actor,
    acknowledgedAt: Date.now()
  }).catch(() => {});
  closePopup();
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
  }
  initializeApp(firebaseConfig);
  db = getDatabase();
  createTray();
  heartbeat();
  listenFirebase();
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  if (db) update(taskRef('desktopClients', config.deviceId), { online:false, lastSeen: Date.now(), offlineSince: Date.now() }).catch(() => {});
});
