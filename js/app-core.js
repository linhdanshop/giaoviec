(function(){
  'use strict';

  const TASK_ROOT = 'taskReminder';
  const STOCK_ROOT = 'tonKho';
  const ADMIN_PASS = '@An12345678';
  const ADMIN_MINUTES = 240;
  const ACTOR_MINUTES = 60;
  const DEVICE_STALE_MS = 90000;
  const $ = id => document.getElementById(id);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  const firebaseConfig = {
    apiKey: 'AIzaSyAolG3b4LGGu_ra74QmtAeszDfSntdazjM',
    authDomain: 'giaoviec-5ac66.firebaseapp.com',
    databaseURL: 'https://giaoviec-5ac66-default-rtdb.asia-southeast1.firebasedatabase.app',
    projectId: 'giaoviec-5ac66',
    storageBucket: 'giaoviec-5ac66.firebasestorage.app',
    messagingSenderId: '454020086133',
    appId: '1:454020086133:web:36c0b520b25cd75b3a3b3c'
  };

  if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
  const db = firebase.database();
  const storage = firebase.storage ? firebase.storage() : null;
  window.db = db;
  window.storage = storage;

  const state = {
    tab: 'today',
    date: todayStr(),
    metric: 'total',
    empFilter: 'Tất cả',
    employees: [],
    masters: [],
    dailyTemplates: [],
    tasks: [],
    devices: {},
    system: {},
    currentTaskRef: null,
    currentTaskCb: null,
    formMode: 'task',
    gallery: { images: [], idx: 0 },
    pendingActor: null,
    attention: null,
    dismissedReminders: new Set(),
    reminderTimer: null,
    soundStopper: null,
    adminNotifyOn: localStorage.getItem('giaoviec.adminNotify') === '1'
  };

  const auth = {
    session: loadJson('giaoviec.session') || null,
    actor: loadJson('giaoviec.actor') || null
  };
  let modalZ = 6000;

  window.APP_ROOTS = Object.assign(window.APP_ROOTS || {}, {
    taskReminder: TASK_ROOT,
    tonKho: STOCK_ROOT
  });
  window.rootRef = (...parts) => db.ref(parts.filter(Boolean).join('/'));
  window.roleAdmin = () => auth.session && auth.session.mode === 'admin' && auth.session.until > Date.now();
  window.showToast = showToast;
  window.openModal = openModal;
  window.closeModal = closeModal;
  window.withActor = withActor;

  function taskRef(...parts){ return window.rootRef(TASK_ROOT, ...parts); }
  function stockRef(...parts){ return window.rootRef(STOCK_ROOT, ...parts); }
  function esc(v){ return String(v ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function id(){ return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
  function z(n){ return String(n).padStart(2,'0'); }
  function todayStr(d = new Date()){ return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`; }
  function monthStr(d = new Date()){ return `${d.getFullYear()}-${z(d.getMonth()+1)}`; }
  function yesterdayStr(){ const d = new Date(); d.setDate(d.getDate()-1); return todayStr(d); }
  function dateLabel(v){ const p = String(v||'').split('-'); return p.length === 3 ? `${p[2]}/${p[1]}` : ''; }
  function nowIso(){ return new Date().toISOString(); }
  function minutes(ms){ return Math.max(0, Math.floor(ms / 60000)); }
  function money(n){ return Number(n||0).toLocaleString('vi-VN'); }
  function loadJson(key){ try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } }
  function saveJson(key, val){ if (val == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); }
  function arr(v){ return Array.isArray(v) ? v.filter(Boolean) : Object.entries(v || {}).map(([key, value]) => typeof value === 'object' ? Object.assign({ id: value.id || key }, value) : value); }
  function listNames(v){ return arr(v).map(x => typeof x === 'string' ? x.trim() : String(x?.name || x?.title || '').trim()).filter(Boolean); }
  function empColor(name){
    const names = state.employees.length ? state.employees : ['Huyền','Nguyệt','Thủy','An','Su'];
    const idx = Math.max(0, names.indexOf(name));
    const colors = ['#a78bfa','#f472b6','#34d399','#64748b','#f59e0b','#60a5fa','#ef4444','#14b8a6'];
    return colors[idx % colors.length];
  }
  function showToast(msg){
    const el = $('toast');
    if (!el) return alert(msg);
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 2200);
  }
  function openModal(id){
    const el = $(id);
    if (!el) return;
    el.style.setProperty('z-index', String(++modalZ), 'important');
    el.classList.add('open');
  }
  function closeModal(id){
    const el = $(id);
    if (el) {
      el.classList.remove('open');
      el.style.removeProperty('z-index');
    }
    if (id === 'attentionModal') stopSound();
  }
  function logLine(action, actor, extra){
    return { at: Date.now(), actor: actor || currentActorName(), action, detail: extra || '' };
  }
  function logText(logs){
    return (logs || []).slice(-80).reverse().map(l => `${new Date(l.at || Date.now()).toLocaleString('vi-VN')} - ${l.actor || '-'} - ${l.action || ''}${l.detail ? ': ' + l.detail : ''}`).join('\n') || 'Chưa có lịch sử';
  }

  function cleanSession(){
    if (auth.session && auth.session.until && auth.session.until <= Date.now()) auth.session = null;
    if (auth.actor && auth.actor.until && auth.actor.until <= Date.now()) auth.actor = null;
    saveJson('giaoviec.session', auth.session);
    saveJson('giaoviec.actor', auth.actor);
  }
  function isLogged(){
    cleanSession();
    return auth.session && (auth.session.mode === 'admin' || auth.session.mode === 'employee');
  }
  function currentActorName(){
    cleanSession();
    if (window.roleAdmin()) return 'Admin';
    return auth.actor && auth.actor.until > Date.now() ? auth.actor.name : '';
  }
  function sessionRemainText(){
    cleanSession();
    if (!auth.session) return 'Chưa đăng nhập';
    if (auth.session.mode === 'admin') return `Admin: Admin đang thao tác • Còn ${minutes(auth.session.until - Date.now())}p`;
    if (auth.actor && auth.actor.until > Date.now()) return `Nhân viên: ${auth.actor.name} đang thao tác • Còn ${minutes(auth.actor.until - Date.now())}p`;
    return 'Nhân viên: Chưa chọn nhân viên thao tác';
  }
  function updateAuthUi(){
    const locked = !isLogged();
    document.body.classList.toggle('authLocked', locked);
    const bar = $('operatorBar');
    if (bar) bar.textContent = locked ? 'Chưa đăng nhập' : sessionRemainText();
    $$('.adminOnly').forEach(el => el.classList.toggle('hidden', !window.roleAdmin()));
    $$('.employeeOnly').forEach(el => el.classList.toggle('hidden', window.roleAdmin()));
    $$('.adminQuick').forEach(el => el.classList.toggle('hidden', !window.roleAdmin()));
    const test = $('adminTestNotify');
    if (test) {
      test.textContent = `🔔 Test nhắc: ${state.adminNotifyOn ? 'Bật' : 'Tắt'}`;
      test.classList.toggle('adminNotifyOn', state.adminNotifyOn);
    }
    Device.updateHeartbeat();
    renderLoginChoices();
  }
  function renderLoginChoices(){
    const box = $('loginChoices');
    if (!box) return;
    box.innerHTML = `
      <button type="button" class="loginChoice" onclick="loginAsAdmin()">Admin</button>
      <button type="button" class="loginChoice" onclick="loginAsEmployeeMode()">Nhân viên</button>`;
  }
  window.loginAsAdmin = function(){
    const pass = prompt('Mật khẩu Admin');
    if (pass !== ADMIN_PASS) return showToast('Sai mật khẩu Admin');
    auth.session = { mode:'admin', until: Date.now() + ADMIN_MINUTES * 60000 };
    auth.actor = null;
    saveJson('giaoviec.session', auth.session);
    saveJson('giaoviec.actor', auth.actor);
    closeModal('loginModal');
    updateAuthUi();
    renderAll();
  };
  window.loginAsEmployeeMode = function(){
    auth.session = { mode:'employee', until: Date.now() + 365 * 24 * 60 * 60000 };
    auth.actor = null;
    saveJson('giaoviec.session', auth.session);
    saveJson('giaoviec.actor', auth.actor);
    closeModal('loginModal');
    updateAuthUi();
    renderAll();
  };
  window.loginConfirm = function(){};
  window.logoutUser = function(){
    auth.session = null;
    auth.actor = null;
    saveJson('giaoviec.session', null);
    saveJson('giaoviec.actor', null);
    updateAuthUi();
    openModal('loginModal');
  };
  window.confirmActor = function(){};
  function withActor(cb){
    cleanSession();
    if (window.roleAdmin()) return cb('Admin');
    if (auth.actor && auth.actor.until > Date.now()) return cb(auth.actor.name);
    state.pendingActor = cb;
    const select = $('actorSelect');
    if (select) select.parentElement.innerHTML = `<label>Chọn người thao tác</label><div class="actorChoiceGrid">${state.employees.map(n => `<button type="button" class="actorChoiceBtn" onclick="pickActor('${esc(n)}')">${esc(n)}</button>`).join('') || '<b>Chưa có nhân viên. Admin cần tạo nhân viên trước.</b>'}</div>`;
    openModal('actorModal');
  }
  window.pickActor = function(name){
    auth.actor = { name, until: Date.now() + ACTOR_MINUTES * 60000 };
    saveJson('giaoviec.actor', auth.actor);
    closeModal('actorModal');
    updateAuthUi();
    const cb = state.pendingActor;
    state.pendingActor = null;
    if (cb) cb(name);
  };
  function requireAdmin(){
    if (!window.roleAdmin()) {
      showToast('Chỉ Admin được thao tác phần này');
      return false;
    }
    return true;
  }
  window.toggleAdminNotifyTest = function(){
    state.adminNotifyOn = !state.adminNotifyOn;
    localStorage.setItem('giaoviec.adminNotify', state.adminNotifyOn ? '1' : '0');
    updateAuthUi();
  };

  const Device = {
    id: localStorage.getItem('giaoviec.deviceId') || ('PC-' + Math.random().toString(36).slice(2,6).toUpperCase()),
    selected: '',
    loaded: false,
    bind(){
      localStorage.setItem('giaoviec.deviceId', this.id);
      const idEl = $('deviceId'); if (idEl) idEl.textContent = this.id;
      const d1 = $('d1'); if (d1) d1.textContent = this.id;
      taskRef('devices').on('value', snap => {
        state.devices = snap.val() || {};
        this.loaded = true;
        const current = state.devices[this.id] || {};
        if (!current.id || Date.now() - (current.lastSeen || 0) > 15000) this.updateHeartbeat(true);
        this.render();
      });
      setInterval(() => this.updateHeartbeat(), 25000);
    },
    current(){
      const saved = state.devices[this.id] || {};
      const local = loadJson('giaoviec.deviceProfile') || {};
      return {
        id: this.id,
        name: local.name || saved.name || this.id,
        ip: local.ip || saved.ip || '',
        user: window.roleAdmin() ? 'Admin' : (auth.actor?.name || 'Nhân viên'),
        allowed: saved.allowed !== false,
        lastSeen: Date.now(),
        online: true,
        logs: saved.logs || []
      };
    },
    updateHeartbeat(force){
      if (!this.loaded && !force) return;
      const saved = state.devices[this.id] || {};
      const data = this.current();
      const wasAway = !saved.lastSeen || Date.now() - (saved.lastSeen || 0) > DEVICE_STALE_MS;
      const logs = Array.isArray(saved.logs) ? saved.logs.slice(-80) : [];
      if (wasAway) logs.push(logLine('Online', data.user, data.name || data.id));
      data.logs = logs.slice(-100);
      taskRef('devices', this.id).update(data).catch(()=>{});
    },
    render(){
      if ((document.activeElement?.id || '').startsWith('deviceEdit')) return;
      const tbody = $('devUser');
      if (tbody) tbody.textContent = window.roleAdmin() ? 'Admin' : (auth.actor?.name || 'Nhân viên');
      const nameInput = $('devName');
      const ipInput = $('devIp');
      const cur = state.devices[this.id] || {};
      if (nameInput && document.activeElement !== nameInput) nameInput.value = cur.name || '';
      if (ipInput && document.activeElement !== ipInput) ipInput.value = cur.ip || '';
      if (state.tab !== 'devices') return;
      const tab = $('devicesTab');
      if (!tab) return;
      if (!window.roleAdmin()) {
        tab.innerHTML = `<div class="section-title"><h2>🟢 Thiết bị online</h2></div><div class="card masterbox"><div id="deviceRows">${this.deviceRowsHtml()}</div></div>`;
        return;
      }
        tab.innerHTML = `
        <div class="section-title"><h2>🟢 Thiết bị online</h2><span class="hint">Admin bấm một máy để sửa tên hoặc cho phép/chặn truy cập nhân viên</span><button class="btn gray deviceHistoryBtn" onclick="openDeviceTotalHistory()">Lịch sử tổng</button></div>
        <div class="card masterbox">
          <div class="deviceEditor">
            <div><label>Máy đang sửa</label><b>${esc(this.selected || this.id)}</b></div>
            <div><label>Tên máy</label><input id="deviceEditName" value="${esc((state.devices[this.selected || this.id] || {}).name || '')}" placeholder="VD: Máy gói đơn"></div>
            <div><label>Ghi chú/IP</label><input id="deviceEditIp" value="${esc((state.devices[this.selected || this.id] || {}).ip || '')}" placeholder="VD: Quầy 1"></div>
            <button class="btn blue" onclick="saveSelectedDevice()">Lưu</button>
          </div>
          <div id="deviceRows" class="deviceRows">${this.deviceRowsHtml()}</div>
        </div>`;
    },
    deviceRowsHtml(){
      return Object.values(state.devices || {}).sort((a,b)=>(b.lastSeen||0)-(a.lastSeen||0)).map(d => {
        const online = Date.now() - (d.lastSeen || 0) < DEVICE_STALE_MS;
        return `<div class="row ${d.id===this.selected?'active':''}" onclick="selectDevice('${esc(d.id)}')">
          <b>${esc(d.id)}</b>
          <span class="${online?'deviceNameOnline':''}">${esc(d.name || 'Máy đang mở')}</span>
          <span>${esc(d.user || '-')}</span>
          <b class="${online?'devOnline':'devAway'}">${online?'Online':'Vắng'}</b>
          <span>${d.allowed===false?'Bị chặn':'Được phép'}</span>
          ${window.roleAdmin()?`<button class="btn ${d.allowed===false?'green':'gray'}" onclick="event.stopPropagation();toggleDeviceAccess('${esc(d.id)}')">${d.allowed===false?'Cho phép':'Chặn'}</button>`:''}
          <button class="btn gray deviceHistoryBtn" onclick="event.stopPropagation();openDeviceHistory('${esc(d.id)}')">LS</button>
        </div>`;
      }).join('');
    }
  };
  window.selectDevice = id => { Device.selected = id; Device.render(); };
  window.saveSelectedDevice = function(){
    if (!requireAdmin()) return;
    const id = Device.selected || Device.id;
    const cur = state.devices[id] || {};
    const name = $('deviceEditName')?.value.trim() || id;
    const ip = $('deviceEditIp')?.value.trim() || '';
    const logs = [...(cur.logs || []), logLine('Đổi tên máy', 'Admin', `${cur.name || ''} -> ${name}`)].slice(-100);
    if (id === Device.id) saveJson('giaoviec.deviceProfile', { name, ip });
    taskRef('devices', id).update({ name, ip, logs });
    showToast('Đã lưu tên máy');
  };
  window.toggleDeviceAccess = function(id){
    if (!requireAdmin()) return;
    const cur = state.devices[id] || {};
    const next = cur.allowed === false;
    const logs = [...(cur.logs || []), logLine(next ? 'Cho phép truy cập' : 'Chặn truy cập', 'Admin')].slice(-100);
    taskRef('devices', id).update({ allowed: next, logs });
  };
  window.openDeviceHistory = function(id){
    const d = state.devices[id] || {};
    $('detailTitle').textContent = `Lịch sử thiết bị - ${id}`;
    $('detailBody').innerHTML = `<pre class="copyBox">${esc(logText(d.logs || []))}</pre>`;
    openModal('detailModal');
  };
  window.openDeviceTotalHistory = function(){
    const logs = Object.values(state.devices || {}).flatMap(d => (d.logs || []).map(l => Object.assign({ deviceId:d.id, deviceName:d.name || d.id }, l)));
    logs.sort((a,b)=>(b.at||0)-(a.at||0));
    const text = logs.map(l => `${new Date(l.at || Date.now()).toLocaleString('vi-VN')} - ${l.deviceName || l.deviceId || '-'} - ${l.actor || '-'} - ${l.action || ''}${l.detail ? ': ' + l.detail : ''}`).join('\n') || 'Chưa có lịch sử thiết bị';
    $('detailTitle').textContent = 'Lịch sử tổng thiết bị';
    $('detailBody').innerHTML = `<pre class="copyBox">${esc(text)}</pre>`;
    openModal('detailModal');
  };
  window.saveDeviceInfo = function(){};

  const Tasks = {
    init(){
      state.date = $('fDate')?.value || todayStr();
      if ($('fDate')) $('fDate').value = state.date;
      taskRef('employees').on('value', snap => { state.employees = listNames(snap.val()); renderAll(); });
      taskRef('masters').on('value', snap => { state.masters = arr(snap.val()).map(this.normMaster); renderAll(); });
      taskRef('dailyTemplates').on('value', snap => { state.dailyTemplates = arr(snap.val()).map(this.normDaily); renderAll(); });
      taskRef('system').on('value', snap => { state.system = snap.val() || {}; });
      this.listenDate(state.date);
      setInterval(() => updateAuthUi(), 15000);
      setInterval(() => this.midnightCheck(), 15000);
      setInterval(() => this.reminderTick(), 3000);
    },
    normTask(x){
      return Object.assign({
        id: id(), date: state.date, time: '08:00', title: '', content: '', employees: [],
        type: 'Phát sinh', status: 'Chưa làm', adminNote: '', report: '', images: [], adminImages: [],
        reportImages: [], remindPlan: '', logs: [], sourceTemplateId: ''
      }, x || {});
    },
    normDaily(x){
      const t = Tasks.normTask(x);
      t.active = x?.active !== false;
      t.type = 'Hằng ngày';
      return t;
    },
    normMaster(x){
      return Object.assign({ id:id(), title:'', content:'', emp:'', time:'08:00', note:'', isDefault:false }, x || {});
    },
    listenDate(date){
      if (state.currentTaskRef && state.currentTaskCb) state.currentTaskRef.off('value', state.currentTaskCb);
      state.date = date;
      if ($('fDate')) $('fDate').value = date;
      state.currentTaskRef = taskRef('tasks', date);
      state.currentTaskCb = snap => {
        state.tasks = arr(snap.val()).map(x => Tasks.normTask(Object.assign({ date }, x)));
        renderAll();
        Tasks.handleActiveReminder();
      };
      state.currentTaskRef.on('value', state.currentTaskCb);
    },
    saveTaskObj(date, task){
      return taskRef('tasks', date, task.id).set(task);
    },
    removeTask(date, taskId){
      return taskRef('tasks', date, taskId).remove();
    },
    startDate(t){
      return new Date(`${t.date || state.date}T${t.time || '00:00'}:00`);
    },
    nextDate(t){
      const list = state.tasks.filter(x => x.id !== t.id && x.date === t.date).sort((a,b)=>(a.time||'').localeCompare(b.time||''));
      const next = list.find(x => (x.time || '') > (t.time || ''));
      if (next) return this.startDate(next);
      const d = this.startDate(t); d.setHours(d.getHours()+1); return d;
    },
    lateMins(t){
      const end = t.doneAt ? new Date(t.doneAt) : new Date();
      return Math.max(0, minutes(end - this.nextDate(t)));
    },
    duration(t){
      const end = t.doneAt ? new Date(t.doneAt) : new Date();
      const total = minutes(end - this.startDate(t));
      const h = Math.floor(total / 60), m = total % 60;
      return (h ? `${h}h` : '') + `${m}p`;
    },
    durationHtml(t){
      const label = t.status === 'Đã xong' ? 'Xong' : 'Đang';
      const late = this.lateMins(t);
      return `<span class="durationBadge">${label} ${this.duration(t)}${late ? `<span class="lateLine">Trễ ${late}p</span>` : ''}</span>`;
    },
    sort(list){
      return list.slice().sort((a,b) => {
        const da = a.status === 'Đã xong', db = b.status === 'Đã xong';
        if (da !== db) return da ? 1 : -1;
        return (a.time || '').localeCompare(b.time || '');
      });
    },
    filtered(){
      const search = ($('fSearch')?.value || '').toLowerCase().trim();
      let list = state.tasks.filter(t => t.date === state.date);
      if (state.empFilter !== 'Tất cả') list = list.filter(t => (t.employees || []).includes(state.empFilter));
      if (search) list = list.filter(t => [t.title,t.content,t.adminNote,t.report].some(v => String(v||'').toLowerCase().includes(search)));
      if (state.metric !== 'total') {
        if (state.metric === 'Quá giờ') list = list.filter(t => this.lateMins(t) > 0);
        else if (state.metric === 'Hằng ngày') list = list.filter(t => t.type === 'Hằng ngày');
        else if (state.metric === 'Phát sinh') list = list.filter(t => t.type !== 'Hằng ngày');
        else list = list.filter(t => t.status === state.metric);
      }
      return this.sort(list);
    },
    renderStats(base){
      const late = base.filter(t => this.lateMins(t) > 0).length;
      const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
      set('stTotal', base.length);
      set('stTodo', base.filter(t => t.status !== 'Đã xong').length);
      set('stLate', late);
      set('stDone', base.filter(t => t.status === 'Đã xong').length);
      set('stDaily', base.filter(t => t.type === 'Hằng ngày').length);
      set('stOnce', base.filter(t => t.type !== 'Hằng ngày').length);
      $$('#statsRow .stat').forEach(x => x.classList.toggle('active', x.dataset.metric === state.metric));
    },
    render(){
      const base = state.tasks.filter(t => t.date === state.date);
      this.renderStats(base);
      const body = $('taskBody');
      const mobile = ensureMobileCards();
      if (!body) return;
      const rows = this.filtered();
      body.innerHTML = rows.map(t => this.row(t)).join('');
      if (mobile) mobile.innerHTML = rows.map(t => this.mobileCard(t)).join('');
      setupColumnResizers();
    },
    row(t){
      const color = empColor((t.employees||[])[0]);
      const late = this.lateMins(t) > 0;
      const done = t.status === 'Đã xong';
      return `<tr class="${done?'done':''} ${late?'overdue':''}">
        <td><div class="timeStack"><b>${esc(t.time)}</b><small>${dateLabel(t.date)}</small></div></td>
        <td><div class="titlepill" style="--empColor:${color}" onclick="openTaskDetail('${esc(t.id)}')">${esc(t.title)}</div><span class="badge ${t.type==='Hằng ngày'?'daily':'once'}">${esc(t.type)}</span></td>
        <td><div class="contentText clip">${esc(t.content)}</div></td>
        <td>${this.empChips(t.employees)}</td>
        <td>${this.imgBadge(t.images,'ảnh')}</td>
        <td>${this.noteStack(t.adminNote, 'Admin ghi chú...', `openAdminNote('${esc(t.id)}')`, t.adminImages, 'ảnh ghi chú')}</td>
        <td>${this.noteStack(t.report, 'Bấm để nhập báo cáo...', `openReport('${esc(t.id)}')`, t.reportImages, 'ảnh báo cáo')}</td>
        <td><div class="statusStack"><span class="status ${done?'done':'todo'}">${esc(t.status)}</span>${late?'<span class="status late second">Quá giờ</span>':''}</div></td>
        <td>${this.durationHtml(t)}</td>
        <td>${window.roleAdmin()?`<div class="remindBox"><button class="remindBtn" onclick="manualRemind('${esc(t.id)}')">🔔 Nhắc</button><input class="remindMini" value="${esc(t.remindPlan||'')}" onchange="saveQuickNote('${esc(t.id)}','remindPlan',this.value)" placeholder="08:10 10 3"></div>`:''}</td>
        <td><button class="more" onclick="openTaskHistory('${esc(t.id)}')">${(t.logs||[]).length} dòng</button></td>
        <td class="action"><button class="dotbtn" onclick="toggleMenu(event,this)">⋮</button><div class="menu">${window.roleAdmin()?`<button onclick="openTaskDetail('${esc(t.id)}')">Chi tiết</button><button onclick="openTaskForm('${esc(t.id)}')">Sửa</button><button onclick="setTaskDone('${esc(t.id)}')">Đã xong</button><button class="danger" onclick="deleteTask('${esc(t.id)}')">Xóa</button>`:`<button onclick="openTaskDetail('${esc(t.id)}')">Chi tiết</button><button onclick="setTaskDone('${esc(t.id)}')">Đã xong</button>`}</div></td>
      </tr>`;
    },
    mobileCard(t){
      const color = empColor((t.employees||[])[0]);
      const done = t.status === 'Đã xong', late = this.lateMins(t) > 0;
      return `<div class="mobileTask ${done?'done':''} ${late?'overdue':''}">
        <div class="mtop"><div><div class="mtime">${esc(t.time)}</div><div class="mdate">${dateLabel(t.date)}</div></div><div class="titlepill" style="--empColor:${color}" onclick="openTaskDetail('${esc(t.id)}')">${esc(t.title)}</div><div class="statusStack"><span class="status ${done?'done':'todo'}">${esc(t.status)}</span>${late?'<span class="status late second">Quá giờ</span>':''}</div></div>
        <div class="mcontent">${esc(t.content)}</div>
        <div class="mrow">${this.empChips(t.employees)}<span class="badge ${t.type==='Hằng ngày'?'daily':'once'}">${esc(t.type)}</span>${this.imgBadge(t.images,'ảnh')} ${this.durationHtml(t)}</div>
        <div class="mactions"><button class="btn blue" onclick="openTaskDetail('${esc(t.id)}')">Chi tiết</button><button class="btn gray" onclick="openReport('${esc(t.id)}')">Báo cáo</button><button class="btn green" onclick="setTaskDone('${esc(t.id)}')">Đã xong</button></div>
      </div>`;
    },
    imgBadge(images, label){
      const count = Array.isArray(images) ? images.length : 0;
      return count ? `<button class="imgbadge" onclick="openImages(${JSON.stringify(images).replace(/"/g,'&quot;')},'${esc(label)}')">📷 ${count} ảnh</button>` : '';
    },
    noteStack(text, empty, click, images, imgLabel){
      return `<div class="cellNoteStack"><button class="noteview ${text?'':'empty'}" onclick="${click}">${esc(text||empty)}</button>${this.imgBadge(images,imgLabel)}</div>`;
    },
    empChips(names){
      return `<div class="empchips">${(names||[]).map(n => `<span class="empchip" style="--empColor:${empColor(n)}">${esc(n)}</span>`).join('')}</div>`;
    },
    renderEmployees(){
      const chips = $('empChips');
      if (chips) chips.innerHTML = ['Tất cả', ...state.employees].map(n => `<button class="filterChip ${state.empFilter===n?'active':''}" onclick="setEmpFilter('${esc(n)}')">${esc(n)}</button>`).join('');
      const f = $('fEmp');
      if (f) f.innerHTML = ['Tất cả', ...state.employees].map(n => `<option>${esc(n)}</option>`).join('');
      const groups = $('mEmpGroup');
      if (groups) groups.innerHTML = state.employees.length ? state.employees.map(n => `<label><input type="checkbox" value="${esc(n)}"> ${esc(n)}</label>`).join('') : '<b>Chưa có nhân viên. Tạo nhân viên trước.</b>';
      const ms = $('msEmp');
      if (ms) ms.innerHTML = [''].concat(state.employees).map(n => `<option>${esc(n)}</option>`).join('');
      const masterPick = $('mMaster');
      if (masterPick) masterPick.innerHTML = `<option value="">-- Không chọn mẫu --</option>` + state.masters.map(m => `<option value="${esc(m.id)}">${esc(m.title)}</option>`).join('');
      const empBody = $('empManageBody');
      if (empBody) {
        const chips = state.employees.map(n => `<span class="employeeInlineItem"><b>${esc(n)}</b>${window.roleAdmin()?`<button type="button" onclick="deleteEmployee('${esc(n)}')">×</button>`:''}</span>`).join('');
        empBody.innerHTML = `<tr><td colspan="2"><div class="employeeInlineList">${chips || '<span class="muted">Chưa có nhân viên</span>'}</div></td></tr>`;
      }
    },
    renderDaily(){
      ensureDailyApplyAllButton();
      const body = $('dailyBody');
      if (!body) return;
      body.innerHTML = this.sort(state.dailyTemplates).map(t => {
        const color = empColor((t.employees||[])[0]);
        const statusHtml = window.roleAdmin()
          ? `<button class="statusToggle ${t.active?'on':'off'}" onclick="event.stopPropagation();toggleDailyActive('${esc(t.id)}')">${t.active?'Đang bật':'Tắt'}</button>`
          : `<span class="statusToggle ${t.active?'on':'off'}">${t.active?'Đang bật':'Tắt'}</span>`;
        return `<tr class="dailyRowView" onclick="openDailyDetail('${esc(t.id)}')">
          <td data-label="Giờ">${esc(t.time)}</td>
          <td data-label="Tên CV"><span class="dailyTitlePill" style="--empColor:${color}">${esc(t.title)}</span></td>
          <td data-label="Nhân viên">${this.empChips(t.employees)}</td>
          <td data-label="Nội dung"><div class="dailyTextClip contentText">${esc(t.content)}</div>${this.imgBadge(t.images,'ảnh')}</td>
          <td data-label="Ghi chú admin"><div class="dailyTextClip">${esc(t.adminNote || '')}</div></td>
          <td data-label="Trạng thái">${statusHtml}</td>
          <td data-label="Áp dụng" class="adminOnly"><button class="btn green dailyApplyBtn" onclick="event.stopPropagation();applyDailyTemplate('${esc(t.id)}')">Áp dụng</button></td>
          <td data-label="Thao tác" class="adminOnly"><div class="dailyTinyActions"><button class="btn gray" onclick="event.stopPropagation();openDailyTemplateForm('${esc(t.id)}')">Sửa</button><button class="btn red" onclick="event.stopPropagation();deleteDailyTemplate('${esc(t.id)}')">Xóa</button></div></td>
        </tr>`;
      }).join('');
    },
    renderMasters(){
      const body = $('masterBody');
      if (body) body.innerHTML = state.masters.map(m => `<tr>
        <td><label class="defaultPick"><input type="radio" name="defaultMaster" ${m.isDefault?'checked':''} ${window.roleAdmin()?'':'disabled'} onchange="setDefaultMaster('${esc(m.id)}')"><span>${m.isDefault?'Đang chọn':'Chọn'}</span></label></td>
        <td><b>${esc(m.title)}</b><div class="masterHint">${esc(m.time||'')}</div></td>
        <td><div class="subMobileText">${esc(m.content)}</div></td>
        <td>${esc(m.emp||'')}</td>
        <td><div class="subMobileText">${esc(m.note||'')}</div></td>
        <td class="adminOnly"><button class="btn gray" onclick="openMasterForm('${esc(m.id)}')">Sửa</button> <button class="btn blue" onclick="createFromMaster('${esc(m.id)}')">Tạo việc</button> <button class="btn red" onclick="deleteMaster('${esc(m.id)}')">Xóa</button></td>
      </tr>`).join('');
    },
    readForm(){
      const employees = $$('#mEmpGroup input:checked').map(x => x.value);
      return {
        id: $('editId')?.value || id(),
        date: $('mDate')?.value || state.date,
        time: $('mTime')?.value || '08:00',
        title: $('mTitle')?.value.trim() || '',
        content: $('mContent')?.value.trim() || '',
        employees,
        type: $('mType')?.value || 'Phát sinh',
        remindPlan: $('mRemind')?.value.trim() || '',
        adminNote: $('mAdminNote')?.value.trim() || '',
        images: [($('mImg')?.value || '').trim(), ...getPreviewImages('taskPreview')].filter(Boolean),
        status: 'Chưa làm',
        logs: []
      };
    },
    fillForm(t, mode){
      state.formMode = mode;
      $('editId').value = t?.id || '';
      $('mDate').value = t?.date || state.date;
      $('mTime').value = t?.time || '08:00';
      $('mTitle').value = t?.title || '';
      $('mContent').value = t?.content || '';
      $('mType').value = mode === 'daily' ? 'Hằng ngày' : (t?.type || 'Phát sinh');
      $('mRemind').value = t?.remindPlan || '';
      $('mAdminNote').value = t?.adminNote || '';
      setPreviewImages('taskPreview', t?.images || []);
      $$('#mEmpGroup input').forEach(ch => ch.checked = (t?.employees || []).includes(ch.value));
      const title = $('taskModalTitle');
      if (title) title.textContent = mode === 'daily' ? (t ? 'Sửa việc hằng ngày' : 'Tạo việc hằng ngày') : (t ? 'Sửa việc' : 'Thêm việc');
      openModal('taskModal');
    },
    async saveForm(){
      if (!requireAdmin()) return;
      const t = this.readForm();
      if (!t.title || !t.content) return showToast('Nhập đủ tên CV và nội dung');
      if (!t.employees.length) return showToast('Phải tích chọn nhân viên mới được lưu');
      if (state.formMode === 'daily') {
        const old = state.dailyTemplates.find(x => x.id === t.id) || {};
        const item = Object.assign({}, old, t, { type:'Hằng ngày', active: old.active !== false, logs:[...(old.logs||[]), logLine(old.id?'Sửa mẫu hằng ngày':'Tạo mẫu hằng ngày','Admin')] });
        await taskRef('dailyTemplates', item.id).set(item);
        closeModal('taskModal');
        showToast('Đã lưu mẫu hằng ngày');
        return;
      }
      const old = state.tasks.find(x => x.id === t.id) || {};
      const item = Object.assign({}, old, t, { logs:[...(old.logs||[]), logLine(old.id?'Sửa việc':'Tạo việc','Admin')] });
      await this.saveTaskObj(item.date, item);
      closeModal('taskModal');
      showToast('Đã lưu việc');
    },
    async applyTemplate(templateId, actor='Admin'){
      if (!requireAdmin()) return;
      const tpl = state.dailyTemplates.find(x => x.id === templateId);
      if (!tpl) return;
      const date = state.date;
      const exists = state.tasks.find(t => t.sourceTemplateId === tpl.id && t.date === date);
      if (exists) return showToast('Việc này đã được áp dụng trong ngày');
      const task = this.fromTemplate(tpl, date, actor);
      await this.saveTaskObj(date, task);
      showToast('Đã áp dụng vào danh sách công việc');
    },
    fromTemplate(tpl, date, actor){
      return Object.assign({}, tpl, {
        id: id(),
        date,
        type: 'Hằng ngày',
        status: 'Chưa làm',
        sourceTemplateId: tpl.id,
        doneAt: null,
        activeReminder: null,
        logs: [logLine('Áp dụng từ việc hằng ngày', actor, `Mẫu: ${tpl.title}`)]
      });
    },
    async applyAll(date = state.date, actor='Admin'){
      const active = state.dailyTemplates.filter(t => t.active !== false);
      const existing = arr((await taskRef('tasks', date).once('value')).val()).map(x => this.normTask(Object.assign({date},x)));
      const updates = {};
      active.forEach(tpl => {
        if (!existing.some(t => t.sourceTemplateId === tpl.id)) {
          const task = this.fromTemplate(tpl, date, actor);
          updates[`tasks/${date}/${task.id}`] = task;
        }
      });
      updates[`system/dailyGenerated/${date}`] = true;
      await taskRef().update(updates);
      showToast(`Đã áp dụng ${active.length} việc hằng ngày`);
    },
    midnightCheck(){
      const now = todayStr();
      if (now !== state.date && new Date().getHours() === 0) {
        state.date = now;
        this.listenDate(now);
        this.applyAll(now, 'Hệ thống 00:00');
      }
    },
    reminderPlan(t){
      const raw = String(t.remindPlan || '').trim();
      const m = raw.match(/(\d{1,2})\s*[:hH]\s*(\d{1,2})/);
      if (!m) return null;
      const hour = Math.max(0, Math.min(23, parseInt(m[1], 10)));
      const minute = Math.max(0, Math.min(59, parseInt(m[2], 10)));
      const nums = raw.replace(m[0], ' ').match(/\d+/g)?.map(n => parseInt(n, 10)).filter(n => n > 0) || [];
      return { hour, minute, interval: nums[0] || 0, count: Math.max(1, nums[1] || 1) };
    },
    reminderSlot(t, plan, now){
      const start = new Date(`${t.date}T${z(plan.hour)}:${z(plan.minute)}:00`);
      if (Number.isNaN(start.getTime()) || now < start) return 0;
      if (!plan.interval) return 1;
      const slot = Math.floor(minutes(now - start) / plan.interval) + 1;
      return slot <= plan.count ? slot : 0;
    },
    async reminderTick(){
      const now = new Date();
      for (const t of state.tasks) {
        if (t.date !== todayStr() || t.status === 'Đã xong' || t.reminderAcked) continue;
        const plan = this.reminderPlan(t);
        if (!plan) continue;
        const slot = this.reminderSlot(t, plan, now);
        if (!slot) continue;
        if (slot <= (t.lastAutoReminderSlot || 0)) continue;
        const reminder = { id:`${t.id}-auto-${slot}`, taskId:t.id, date:t.date, type:'auto', slot, createdAt:Date.now(), acknowledged:false };
        await taskRef('tasks', t.date, t.id).update({ lastAutoReminderSlot:slot, activeReminder:reminder });
      }
    },
    handleActiveReminder(){
      const active = state.tasks.find(t => t.activeReminder && !t.activeReminder.acknowledged);
      if (!active) return closeAttentionIfAny();
      const rid = active.activeReminder.id;
      if (state.dismissedReminders.has(rid)) return;
      if (window.roleAdmin() && !state.adminNotifyOn) return;
      showAttention(active);
    }
  };

  function ensureMobileCards(){
    let el = $('mobileCards');
    if (!el) {
      const box = document.querySelector('#todayTab .tablebox');
      if (!box) return null;
      el = document.createElement('div');
      el.id = 'mobileCards';
      el.className = 'mobileCards';
      box.parentElement.insertBefore(el, box.nextSibling);
    }
    return el;
  }
  function setupColumnResizers(){
    const table = $('taskTable');
    if (!table || table.dataset.resizable === '1') return;
    const cols = Array.from(table.querySelectorAll('colgroup col'));
    table.querySelectorAll('thead th').forEach((th, i) => {
      if (!cols[i]) return;
      const grip = document.createElement('span');
      grip.className = 'colResizer';
      th.appendChild(grip);
      grip.addEventListener('mousedown', ev => {
        ev.preventDefault();
        const startX = ev.clientX;
        const startW = cols[i].getBoundingClientRect().width || th.getBoundingClientRect().width;
        const move = e => {
          const width = Math.max(56, Math.round(startW + e.clientX - startX));
          cols[i].style.width = width + 'px';
        };
        const up = () => {
          document.removeEventListener('mousemove', move);
          document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
      });
    });
    table.dataset.resizable = '1';
  }
  function ensureDailyApplyAllButton(){
    const title = document.querySelector('#dailyTab .section-title');
    if (!title || $('applyAllDailyBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'applyAllDailyBtn';
    btn.className = 'btn green adminOnly';
    btn.textContent = 'Áp dụng tất cả';
    btn.onclick = () => Tasks.applyAll(state.date, 'Admin');
    title.insertBefore(btn, title.lastElementChild);
  }
  function renderAll(){
    updateAuthUi();
    Tasks.renderEmployees();
    Tasks.render();
    Tasks.renderDaily();
    Tasks.renderMasters();
    Stock.render();
    Device.render();
    applyMobileLabels();
    updateAuthUi();
  }
  function applyMobileLabels(){
    $$('.miniTable tbody tr').forEach(tr => {
      const headers = Array.from(tr.closest('table')?.querySelectorAll('thead th') || []).map(th => th.textContent.trim());
      Array.from(tr.children).forEach((td,i) => td.setAttribute('data-label', td.getAttribute('data-label') || headers[i] || ''));
    });
  }
  window.setEmpFilter = function(emp){ state.empFilter = emp; renderAll(); };
  window.setMetricFilter = function(metric){ state.metric = metric; renderAll(); };
  function setDateButtonActive(label){ $$('#todayTab .filters .btn.gray').forEach(b => b.classList.toggle('active', b.textContent.trim() === label)); }
  window.today = function(){ state.metric='total'; state.date = todayStr(); setDateButtonActive('Hôm nay'); Tasks.listenDate(state.date); };
  window.yesterday = function(){ state.metric='total'; state.date = yesterdayStr(); setDateButtonActive('Hôm qua'); Tasks.listenDate(state.date); };
  window.render = function(){ const d = $('fDate')?.value || state.date; if (d !== state.date) Tasks.listenDate(d); else renderAll(); };
  window.switchTab = function(tab){
    state.tab = tab;
    ['today','daily','master','devices','dongKiem','tonKho'].forEach(t => {
      const el = $(t + 'Tab');
      if (el) el.classList.toggle('hidden', t !== tab);
    });
    $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    if (tab === 'devices') Device.render();
    if (tab === 'tonKho') Stock.render();
  };
  window.toggleMenu = function(ev, btn){
    ev.stopPropagation();
    const menu = btn.nextElementSibling;
    $$('.menu.open').forEach(m => {
      if (m !== menu) {
        m.classList.remove('open');
        m.style.position = '';
        m.style.left = '';
        m.style.top = '';
      }
    });
    if (!menu) return;
    const willOpen = !menu.classList.contains('open');
    menu.classList.toggle('open', willOpen);
    if (willOpen) {
      const r = btn.getBoundingClientRect();
      menu.style.position = 'fixed';
      menu.style.left = Math.max(8, r.right - 150) + 'px';
      requestAnimationFrame(() => {
        const h = menu.offsetHeight || 180;
        const openDownTop = r.bottom + 6;
        const openUpTop = r.top - h - 6;
        const top = openDownTop + h > window.innerHeight - 8 ? Math.max(8, openUpTop) : openDownTop;
        menu.style.top = top + 'px';
      });
    }
  };
  document.addEventListener('click', () => $$('.menu.open').forEach(m => { m.classList.remove('open'); m.style.position=''; m.style.left=''; m.style.top=''; }));

  window.openTaskForm = function(taskId){
    if (!requireAdmin()) return;
    const def = !taskId ? state.masters.find(m => m.isDefault) : null;
    const seed = def ? { title:def.title, content:def.content, adminNote:def.note, time:def.time, employees:def.emp?[def.emp]:[], type:'Phát sinh', date:state.date } : null;
    Tasks.fillForm(taskId ? state.tasks.find(t => t.id === taskId) : seed, 'task');
    if (def && $('mMaster')) $('mMaster').value = def.id;
  };
  window.openDailyTemplateForm = function(templateId){
    if (!requireAdmin()) return;
    Tasks.fillForm(state.dailyTemplates.find(t => t.id === templateId), 'daily');
  };
  window.saveTask = () => Tasks.saveForm();
  window.applyDailyTemplate = id => Tasks.applyTemplate(id);
  window.toggleDailyActive = function(templateId){
    if (!requireAdmin()) return;
    const t = state.dailyTemplates.find(x => x.id === templateId);
    if (t) taskRef('dailyTemplates', templateId).update({ active: t.active === false });
  };
  window.deleteDailyTemplate = function(templateId){
    if (!requireAdmin()) return;
    if (confirm('Xóa việc hằng ngày này?')) taskRef('dailyTemplates', templateId).remove();
  };
  window.openDailyDetail = function(id){
    const t = state.dailyTemplates.find(x => x.id === id);
    if (!t) return;
    $('detailTitle').textContent = `${t.time} - ${t.title}`;
    $('detailBody').innerHTML = `<div class="detailWrap"><div class="detailTop"><div class="info">Nhân viên: ${esc((t.employees||[]).join(', '))}</div><div class="info">Trạng thái: ${t.active!==false?'Đang bật':'Tắt'}</div></div><div class="detailMain"><div class="detailSection"><h4>Nội dung</h4><div class="bigcontent">${esc(t.content)}</div>${Tasks.imgBadge(t.images,'ảnh')}</div><div class="detailSection"><h4>Admin ghi chú</h4>${esc(t.adminNote||'')}</div></div></div>`;
    openModal('detailModal');
  };
  window.deleteTask = function(taskId){
    if (!requireAdmin()) return;
    const t = state.tasks.find(x => x.id === taskId);
    if (t && confirm('Xóa công việc này?')) Tasks.removeTask(t.date, t.id);
  };
  window.setTaskDone = function(taskId){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    withActor(actor => {
      const logs = [...(t.logs||[]), logLine('Đánh dấu đã xong', actor)];
      taskRef('tasks', t.date, t.id).update({ status:'Đã xong', doneAt: nowIso(), logs, activeReminder:null, reminderAcked:true });
    });
  };
  window.saveQuickNote = function(taskId, field, value){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    if (field === 'remindPlan' && !window.roleAdmin()) return showToast('Nhân viên không được nhắc việc');
    const apply = actor => {
      const logs = [...(t.logs||[]), logLine(`Sửa ${field}`, actor, `${t[field]||''} -> ${value||''}`)];
      const data = { [field]: value, logs };
      if (field === 'remindPlan') Object.assign(data, { lastAutoReminderSlot:0, reminderAcked:false, activeReminder:null });
      taskRef('tasks', t.date, t.id).update(data);
    };
    window.roleAdmin() ? apply('Admin') : withActor(apply);
  };
  window.openReport = function(taskId){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    withActor(() => {
      $('rId').value = taskId;
      $('rText').value = t.report || '';
      setPreviewImages('reportPreview', t.reportImages || []);
      openModal('reportModal');
    });
  };
  window.saveReport = function(){
    const taskId = $('rId').value;
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    withActor(actor => {
      const text = $('rText').value.trim();
      const logs = [...(t.logs||[]), logLine('Sửa báo cáo nhân viên', actor, `${t.report||''} -> ${text}`)];
      taskRef('tasks', t.date, t.id).update({ report:text, reportImages:getPreviewImages('reportPreview'), logs });
      closeModal('reportModal');
    });
  };
  window.openAdminNote = function(taskId){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    if (!window.roleAdmin()) {
      $('detailTitle').textContent = `Admin ghi chú - ${t.title}`;
      $('detailBody').innerHTML = `<div class="detailSection adminBox"><div>${esc(t.adminNote||'Không có ghi chú')}</div>${Tasks.imgBadge(t.adminImages,'ảnh ghi chú')}</div>`;
      openModal('detailModal');
      return;
    }
    $('aId').value = taskId;
    $('aText').value = t.adminNote || '';
    setPreviewImages('adminPreview', t.adminImages || []);
    openModal('adminNoteModal');
  };
  window.saveAdminNote = function(){
    if (!requireAdmin()) return;
    const taskId = $('aId').value;
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    const text = $('aText').value.trim();
    const logs = [...(t.logs||[]), logLine('Sửa admin ghi chú', 'Admin', `${t.adminNote||''} -> ${text}`)];
    taskRef('tasks', t.date, t.id).update({ adminNote:text, adminImages:getPreviewImages('adminPreview'), logs });
    closeModal('adminNoteModal');
  };
  window.openTaskHistory = function(taskId){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    $('detailTitle').textContent = `Lịch sử - ${t.title}`;
    $('detailBody').innerHTML = `<pre class="copyBox">${esc(logText(t.logs))}</pre>`;
    openModal('detailModal');
  };
  window.openTaskDetail = function(taskId){
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    $('detailTitle').textContent = `${t.time} - ${t.title}`;
    $('detailBody').innerHTML = `<div class="detailWrap">
      <div class="detailTop"><div class="info">Nhân viên: ${esc((t.employees||[]).join(', '))}</div><div class="info">Loại: ${esc(t.type)}</div><div class="info">Trạng thái: ${esc(t.status)}</div><div class="info">Lịch sử: ${(t.logs||[]).length} dòng</div></div>
      <div class="detailActions">${window.roleAdmin()?`<button class="btn green" onclick="setTaskDone('${esc(t.id)}')">Đánh dấu xong</button><button class="btn gray" onclick="openTaskForm('${esc(t.id)}')">Sửa việc</button><button class="btn red" onclick="deleteTask('${esc(t.id)}')">Xóa</button>`:`<button class="btn green" onclick="setTaskDone('${esc(t.id)}')">Đánh dấu xong</button>`}</div>
      <div class="detailMain"><div class="detailCore"><div><b>Giờ</b><div class="bigtime">${esc(t.time)}</div></div><div><b>Tên công việc</b><div class="bigtitle titlepill" style="--empColor:${empColor((t.employees||[])[0])}">${esc(t.title)}</div></div><div class="detailContentFull"><b>Nội dung</b><div class="bigcontent">${esc(t.content)}</div></div></div>
      <div class="detailSection"><h4>Ảnh công việc</h4>${Tasks.imgBadge(t.images,'ảnh công việc')}</div>
      <div class="detailEditGrid"><div class="detailSection adminBox"><h4>Admin ghi chú</h4><div>${esc(t.adminNote||'')}</div>${Tasks.imgBadge(t.adminImages,'ảnh ghi chú')}</div><div class="detailSection reportBox"><h4>Báo cáo nhân viên</h4><div>${esc(t.report||'')}</div>${Tasks.imgBadge(t.reportImages,'ảnh báo cáo')}</div></div></div></div>`;
    openModal('detailModal');
  };
  window.manualRemind = function(taskId){
    if (!requireAdmin()) return;
    const t = state.tasks.find(x => x.id === taskId);
    if (!t) return;
    const reminder = { id:`${t.id}-manual-${Date.now()}`, taskId:t.id, date:t.date, type:'manual', createdAt:Date.now(), acknowledged:false };
    taskRef('tasks', t.date, t.id).update({ activeReminder:reminder, reminderAcked:false });
  };
  function showAttention(t){
    const r = t.activeReminder;
    if (!r || state.attention?.id === r.id) return;
    state.attention = { id:r.id, taskId:t.id, date:t.date };
    $('attentionBody').innerHTML = `<h2>${esc(t.time)} - ${esc(t.title)}</h2>
      <div class="attentionEmpBig"><small>Nhân viên bàn giao</small><div class="attentionEmpChipWrap">${(t.employees||[]).map(n=>`<span class="attentionEmpChip" style="--empColor:${empColor(n)}">${esc(n)}</span>`).join('')}</div></div>
      <div class="attentionAdminNote"><b>Ghi chú admin</b>${esc(t.adminNote || 'Không có')}</div>
      <div class="copyBox">${esc(t.content)}</div>`;
    const foot = document.querySelector('#attentionModal .attentionFoot');
    if (foot) foot.innerHTML = `<button class="btn gray" onclick="closeAttention()">Không phải tôi</button><button class="btn orange" onclick="attentionAck()">Đã nhận nhắc</button>`;
    openModal('attentionModal');
    playSound10s();
  }
  function closeAttentionIfAny(){ if (state.attention) { closeModal('attentionModal'); state.attention = null; } }
  window.closeAttention = function(){
    if (state.attention?.id) state.dismissedReminders.add(state.attention.id);
    state.attention = null;
    stopSound();
    closeModal('attentionModal');
  };
  window.attentionAck = function(){
    if (!state.attention) return;
    const a = state.attention;
    withActor(actor => {
      const t = state.tasks.find(x => x.id === a.taskId);
      const logs = [...(t?.logs||[]), logLine('Đã nhận nhắc', actor)];
      taskRef('tasks', a.date, a.taskId).update({ activeReminder: Object.assign({}, t?.activeReminder || {}, { acknowledged:true, acknowledgedBy:actor, acknowledgedAt:Date.now() }), reminderAcked:true, logs });
      closeAttentionIfAny();
    });
  };
  function playSound10s(){
    stopSound();
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      let stopped = false;
      const beep = () => {
        if (stopped) return;
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = 880; g.gain.value = 0.06;
        o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.22);
      };
      beep();
      const timer = setInterval(beep, 900);
      state.soundStopper = () => { stopped = true; clearInterval(timer); ctx.close().catch(()=>{}); };
      setTimeout(stopSound, 10000);
    } catch {}
  }
  function stopSound(){ if (state.soundStopper) { state.soundStopper(); state.soundStopper = null; } }
  window.openImages = function(images, title){
    state.gallery.images = images || [];
    state.gallery.idx = 0;
    $('imageTitle').textContent = title || 'Xem ảnh';
    renderImage();
    openModal('imageModal');
  };
  window.prevImage = () => { if (state.gallery.images.length) { state.gallery.idx = (state.gallery.idx - 1 + state.gallery.images.length) % state.gallery.images.length; renderImage(); } };
  window.nextImage = () => { if (state.gallery.images.length) { state.gallery.idx = (state.gallery.idx + 1) % state.gallery.images.length; renderImage(); } };
  function renderImage(){
    const img = $('bigImage');
    if (img) img.src = state.gallery.images[state.gallery.idx] || '';
    const c = $('imageCounter');
    if (c) c.textContent = `${state.gallery.idx+1}/${state.gallery.images.length || 1}`;
  }
  function getPreviewImages(id){ return Array.from(($(id)?.querySelectorAll('img') || [])).map(img => img.src).filter(Boolean); }
  function setPreviewImages(id, images){
    const el = $(id);
    if (el) el.innerHTML = (images||[]).map(src => `<img src="${esc(src)}"><button type="button" class="btn red" onclick="this.previousElementSibling.remove();this.remove()">×</button>`).join('');
  }
  document.addEventListener('paste', e => {
    const modal = document.querySelector('.modal.open');
    const preview = modal?.querySelector('.previewImgs');
    if (!preview) return;
    const files = Array.from(e.clipboardData?.files || []).filter(f => f.type.startsWith('image/'));
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => preview.insertAdjacentHTML('beforeend', `<img src="${reader.result}"><button type="button" class="btn red" onclick="this.previousElementSibling.remove();this.remove()">×</button>`);
      reader.readAsDataURL(file);
    });
  });
  window.fillFromMaster = function(){
    const m = state.masters.find(x => x.id === $('mMaster')?.value);
    if (!m) return;
    $('mTitle').value = m.title || '';
    $('mContent').value = m.content || '';
    $('mAdminNote').value = m.note || '';
    $('mTime').value = m.time || $('mTime').value || '08:00';
    $$('#mEmpGroup input').forEach(ch => ch.checked = m.emp ? ch.value === m.emp : ch.checked);
  };
  window.createFromMaster = function(masterId){
    if (!requireAdmin()) return;
    const m = state.masters.find(x => x.id === masterId);
    if (!m) return;
    Tasks.fillForm({ title:m.title, content:m.content, adminNote:m.note, time:m.time, employees:m.emp?[m.emp]:[], type:'Phát sinh', date:state.date }, 'task');
    if ($('mMaster')) $('mMaster').value = m.id;
  };
  window.setDefaultMaster = function(masterId){
    if (!requireAdmin()) return;
    const updates = {};
    state.masters.forEach(m => { updates[`${m.id}/isDefault`] = m.id === masterId; });
    taskRef('masters').update(updates);
  };
  window.openMasterForm = function(masterId){
    if (!requireAdmin()) return;
    const m = state.masters.find(x => x.id === masterId) || {};
    $('msId').value = m.id || '';
    $('msTitle').value = m.title || '';
    $('msEmp').value = m.emp || '';
    $('msTime').value = m.time || '08:00';
    $('msContent').value = m.content || '';
    $('msNote').value = m.note || '';
    openModal('masterModal');
  };
  window.saveMaster = function(){
    if (!requireAdmin()) return;
    const old = state.masters.find(x => x.id === $('msId').value) || {};
    const item = { id:$('msId').value || id(), title:$('msTitle').value.trim(), emp:$('msEmp').value, time:$('msTime').value, content:$('msContent').value.trim(), note:$('msNote').value.trim(), isDefault: !!old.isDefault };
    if (!item.title || !item.content || !item.emp) return showToast('Mẫu CV phải có tên, nội dung và nhân viên');
    taskRef('masters', item.id).set(item);
    closeModal('masterModal');
  };
  window.deleteMaster = function(masterId){
    if (!requireAdmin()) return;
    if (confirm('Xóa mẫu CV này?')) taskRef('masters', masterId).remove();
  };
  window.addEmployee = function(){
    if (!requireAdmin()) return;
    const name = $('newEmpName')?.value.trim();
    if (!name) return;
    const next = Array.from(new Set([...state.employees, name]));
    taskRef('employees').set(next);
    $('newEmpName').value = '';
  };
  window.deleteEmployee = function(name){
    if (!requireAdmin()) return;
    if (confirm(`Xóa nhân viên ${name}?`)) taskRef('employees').set(state.employees.filter(x => x !== name));
  };

  const Stock = {
    month: monthStr(),
    data: { diff:{}, friend:{}, customer:{} },
    friends: [],
    filter: {},
    expanded: {},
    monthRef: null,
    monthCb: null,
    friendsRef: null,
    friendsCb: null,
    init(){
      ensureStockTab();
      this.bind();
    },
    bind(){
      this.month = $('stockMonth')?.value || this.month;
      if (this.monthRef && this.monthCb) this.monthRef.off('value', this.monthCb);
      this.monthRef = stockRef('months', this.month);
      this.monthCb = snap => { this.data = Object.assign({ diff:{}, friend:{}, customer:{} }, snap.val() || {}); this.render(); };
      this.monthRef.on('value', this.monthCb);
      if (!this.friendsRef) {
        this.friendsRef = stockRef('friends');
        this.friendsCb = snap => { this.friends = listNames(snap.val()); this.render(); };
        this.friendsRef.on('value', this.friendsCb);
      }
    },
    sections(){
      return [
        { id:'diff', title:'Thống kê thiếu/dư', type:'diff' },
        { id:'friend', title:'Thống kê Bán người quen', type:'friend' },
        { id:'customer', title:'Thống kê Bán Khách mua', type:'customer' }
      ];
    },
    rows(sec){ return arr(this.data[sec] || {}).map(r => Object.assign({ id:id(), createdAt:Date.now(), code:'', qty:0, price:0, note:'', payment:'Chưa thanh toán', cut:'Chưa cắt tồn', logs:[] }, r)); },
    calc(row, sec){
      const amount = Math.abs(Number(row.qty||0)) * Number(row.price||0);
      return sec === 'diff' && row.stockType === 'Thiếu' ? -amount : amount;
    },
    render(){
      if (!$('tonKhoTab')) ensureStockTab();
      if (state.tab !== 'tonKho') return;
      const host = $('stockSections');
      if (!host) return;
      host.innerHTML = this.sections().map(sec => this.sectionHtml(sec)).join('');
    },
    sectionHtml(sec){
      const rows = this.filteredRows(sec.id);
      const shown = this.expanded[sec.id] ? rows : rows.slice(0,10);
      return `<div class="tkSection"><div class="tkHead"><h3>${esc(sec.title)}</h3><div><button class="btn blue" onclick="stockOpenForm('${sec.id}')">+ Thêm mới</button>${sec.id==='friend'?'<button class="btn gray" onclick="stockOpenFriends()">Danh sách người quen</button>':''}</div></div>${this.statsHtml(sec.id)}<div class="tkTableWrap"><table class="tkTable">${this.headHtml(sec.id)}<tbody>${shown.map(r=>this.rowHtml(sec.id,r)).join('') || '<tr><td colspan="12" class="dkNoRows">Không có</td></tr>'}</tbody></table></div>${rows.length>10?`<button class="more" onclick="stockToggleExpand('${sec.id}')">${this.expanded[sec.id]?'Thu gọn':'Xem thêm'}</button>`:''}</div>`;
    },
    headHtml(sec){
      const common = '<th>STT</th><th>Ngày lập</th><th>Mã SP</th><th>SL</th><th>Giá bán</th>';
      if (sec === 'diff') return `<thead><tr>${common}<th>Tồn kho</th><th>Thành tiền</th><th>Ghi chú</th><th>Trạng thái</th><th>Lịch sử</th><th>Thao tác</th></tr></thead>`;
      if (sec === 'friend') return `<thead><tr>${common}<th>Người quen</th><th>Thành tiền</th><th>Thanh toán</th><th>Ghi chú</th><th>Trạng thái</th><th>Lịch sử</th><th>Thao tác</th></tr></thead>`;
      return `<thead><tr>${common}<th>Khách mua</th><th>SĐT</th><th>Thành tiền</th><th>Thanh toán</th><th>Ghi chú</th><th>Trạng thái</th><th>Lịch sử</th><th>Thao tác</th></tr></thead>`;
    },
    rowHtml(sec,r){
      const stt = this.rows(sec).findIndex(x => x.id === r.id) + 1;
      const amt = this.calc(r, sec);
      const note = `<button class="tkNoteBtn" onclick="stockOpenNote('${sec}','${r.id}')">${esc(r.note || 'Ghi chú...')}</button>`;
      const status = `<span class="status ${r.cut==='Đã cắt tồn'?'done':'todo'}">${esc(r.cut)}</span>`;
      const canEdit = window.roleAdmin() || r.cut !== 'Đã cắt tồn';
      const menu = `<div class="action"><button class="dotbtn" onclick="toggleMenu(event,this)">⋮</button><div class="menu">
        ${canEdit?`<button onclick="stockOpenForm('${sec}','${r.id}')">Sửa</button>`:''}
        ${window.roleAdmin()?`<button class="danger" onclick="stockDeleteRow('${sec}','${r.id}')">Xóa</button>`:''}
        ${window.roleAdmin()?`<button onclick="stockToggleCut('${sec}','${r.id}')">${r.cut==='Đã cắt tồn'?'Chưa cắt tồn':'Đã cắt tồn'}</button>`:''}
        ${sec!=='diff'?`<button onclick="stockTogglePaid('${sec}','${r.id}')">${r.payment==='Đã thanh toán'?'Chưa thanh toán':'Đã thanh toán'}</button>${window.roleAdmin()?`<button onclick="stockPayAll('${sec}','${r.id}')">Thanh toán toàn bộ</button>`:''}`:''}
      </div></div>`;
      const td = (label, html, cls='') => `<td data-label="${esc(label)}" class="${cls}">${html}</td>`;
      const amountHtml = `<span class="${amt<0?'tkNeg':'tkPos'}">${money(amt)}</span>`;
      const base = `${td('STT',stt)}${td('Ngày lập',new Date(r.createdAt||Date.now()).toLocaleDateString('vi-VN'))}${td('Mã SP',`<span class="tkCode">${esc(r.code)}</span>`)}${td('SL',esc(r.qty))}${td('Giá bán',money(r.price))}`;
      if (sec === 'diff') return `<tr>${base}${td('Tồn kho',esc(r.stockType||'Thiếu'))}${td('Thành tiền',amountHtml)}${td('Ghi chú',note)}${td('Trạng thái',status)}${td('Lịch sử',`<button class="more" onclick="stockHistory('${sec}','${r.id}')">${(r.logs||[]).length} dòng</button>`)}${td('Thao tác',menu)}</tr>`;
      if (sec === 'friend') return `<tr>${base}${td('Người quen',esc(r.friend||''))}${td('Thành tiền',amountHtml)}${td('Thanh toán',esc(r.payment))}${td('Ghi chú',note)}${td('Trạng thái',status)}${td('Lịch sử',`<button class="more" onclick="stockHistory('${sec}','${r.id}')">${(r.logs||[]).length} dòng</button>`)}${td('Thao tác',menu)}</tr>`;
      return `<tr>${base}${td('Khách mua',esc(r.customer||''))}${td('SĐT',esc(r.phone||''))}${td('Thành tiền',amountHtml)}${td('Thanh toán',esc(r.payment))}${td('Ghi chú',note)}${td('Trạng thái',status)}${td('Lịch sử',`<button class="more" onclick="stockHistory('${sec}','${r.id}')">${(r.logs||[]).length} dòng</button>`)}${td('Thao tác',menu)}</tr>`;
    },
    statsHtml(sec){
      const rows = this.rows(sec);
      const filt = this.filter[sec] || 'all';
      const btn = (key,label,count,cls='') => `<button class="tkStat ${cls} ${filt===key?'active':''}" onclick="stockSetFilter('${sec}','${key}')"><b>${count}</b><span>${label}</span></button>`;
      if (sec === 'diff') {
        const sum = rows.reduce((s,r)=>s+this.calc(r,'diff'),0);
        return `<div class="tkStats">${btn('all','Tổng',rows.length)}${btn('Thiếu','Thiếu',rows.filter(r=>r.stockType==='Thiếu').length,'warn')}${btn('Dư','Dư',rows.filter(r=>r.stockType==='Dư').length,'ok')}${btn('Chưa cắt tồn','Chưa cắt',rows.filter(r=>r.cut!=='Đã cắt tồn').length)}${btn('Đã cắt tồn','Đã cắt',rows.filter(r=>r.cut==='Đã cắt tồn').length)}<div class="tkStat money ${sum<0?'neg':'pos'}"><b>${money(sum)}</b><span>Chênh lệch</span></div></div>`;
      }
      const friendStats = sec==='friend' ? this.friendStats(rows).map(s => `<button class="tkStat friendStat ${(filt==='friend:'+s.name)?'active':''}" onclick="stockSetFilter('${sec}','friend:${esc(s.name)}')"><b>${s.count}</b><span><strong>${esc(s.name)} (${s.count})</strong><em>TT ${money(s.total)}</em></span></button>`).join('') : '';
      return `<div class="tkStats">${btn('all','Tổng',rows.length)}${btn('Chưa thanh toán','Chưa TT',rows.filter(r=>r.payment!=='Đã thanh toán').length,'warn')}${btn('Đã thanh toán','Đã TT',rows.filter(r=>r.payment==='Đã thanh toán').length,'ok')}${btn('Chưa cắt tồn','Chưa cắt',rows.filter(r=>r.cut!=='Đã cắt tồn').length)}${btn('Đã cắt tồn','Đã cắt',rows.filter(r=>r.cut==='Đã cắt tồn').length)}<div class="tkStat money"><b>${money(rows.reduce((s,r)=>s+this.calc(r,sec),0))}</b><span>Tổng tiền</span></div>${friendStats}</div>`;
    },
    friendStats(rows){
      const map = {};
      rows.forEach(r => { const n = r.friend || 'Khác'; map[n] = map[n] || { name:n,count:0,total:0 }; map[n].count++; map[n].total += Math.abs(Number(r.qty||0)) * Number(r.price||0); });
      return Object.values(map);
    },
    filteredRows(sec){
      const f = this.filter[sec] || 'all';
      let rows = this.rows(sec).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
      if (f === 'all') return rows;
      if (f.startsWith('friend:')) return rows.filter(r => r.friend === f.slice(7));
      if (f === 'Thiếu' || f === 'Dư') return rows.filter(r => r.stockType === f);
      if (f === 'Chưa thanh toán' || f === 'Đã thanh toán') return rows.filter(r => r.payment === f);
      if (f === 'Chưa cắt tồn' || f === 'Đã cắt tồn') return rows.filter(r => r.cut === f);
      return rows;
    }
  };
  function ensureStockTab(){
    if (!$('tonKhoTab')) {
      const tab = document.createElement('button');
      tab.className = 'tab';
      tab.dataset.tab = 'tonKho';
      tab.textContent = 'Tồn Kho';
      tab.onclick = () => switchTab('tonKho');
      const dk = document.querySelector('.tab[data-tab="dongKiem"]');
      dk ? dk.insertAdjacentElement('afterend', tab) : document.querySelector('.tabs')?.appendChild(tab);
      const div = document.createElement('div');
      div.id = 'tonKhoTab';
      div.className = 'hidden';
      div.innerHTML = `<div class="section-title"><h2>📦 Tồn Kho</h2><span class="hint">Dữ liệu tách riêng theo tháng trong /tonKho</span></div><div class="card tkToolbar"><label class="stockMonthBox"><span>Tháng</span><input id="stockMonth" type="month" value="${Stock.month}" onchange="stockChangeMonth(this.value)"></label><button class="btn gray" onclick="stockTotalHistory()">Lịch sử tổng</button></div><div id="stockSections" class="tkGrid"></div>`;
      document.querySelector('.wrap')?.appendChild(div);
    }
    if (!$('tkStyleCore')) {
      document.head.insertAdjacentHTML('beforeend', `<style id="tkStyleCore">.tkToolbar{padding:12px;display:flex;gap:10px;align-items:center}.stockMonthBox{display:inline-flex;align-items:center;gap:8px;border:1px solid #dbe5f2;background:#fff;border-radius:12px;padding:7px 10px;font-weight:900}.stockMonthBox span{color:#64748b;font-size:12px;text-transform:uppercase}.stockMonthBox input{height:32px;border:0;font-weight:900;background:transparent}.tkGrid{display:grid;gap:14px}.tkSection{background:#fff;border:1px solid var(--line);border-radius:14px;padding:12px;box-shadow:0 10px 28px #0f172a10;overflow:visible}.tkHead{display:flex;justify-content:space-between;gap:10px;align-items:center}.tkHead h3{margin:0}.tkStats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:10px 0}.tkStat{border:1px solid #dbe5f2;border-radius:10px;background:#f8fafc;padding:9px;text-align:left;font-weight:900;cursor:pointer}.tkStat b{display:block;font-size:20px}.tkStat span{color:#64748b;font-size:12px}.tkStat.active{outline:2px solid #2563eb;background:#eff6ff}.tkStat.ok{background:#ecfdf3}.tkStat.warn{background:#fff7ed}.tkStat.money{background:#f5f3ff}.tkTableWrap{overflow-x:auto;overflow-y:visible}.tkTable{width:100%;min-width:1180px;border-collapse:collapse}.tkTable th{background:#eef4fb;text-align:left;padding:9px;border-bottom:1px solid #cbd5e1}.tkTable td{padding:8px;border-bottom:1px solid #e7edf5;vertical-align:middle}.tkCode{font-weight:900}.tkNeg{color:#dc2626;font-weight:900}.tkPos{color:#15803d;font-weight:900}.tkNoteBtn{max-width:220px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid #dbe5f2;background:#fff;border-radius:8px;padding:7px 9px;font-weight:800;cursor:pointer}.tkFriendItem{display:grid;grid-template-columns:1fr 80px;gap:8px;margin:8px 0}@media(max-width:760px){.tkToolbar{justify-content:space-between}.tkStats{grid-template-columns:repeat(2,minmax(0,1fr))}.tkHead{align-items:flex-start;flex-direction:column}.tkHead>div{display:flex;gap:8px;flex-wrap:wrap}.tkSection{padding:9px}.tkTableWrap{overflow:visible}.tkTable{display:block;min-width:0;border:0}.tkTable thead{display:none}.tkTable tbody{display:block}.tkTable tr{display:block;background:#fff;border:1px solid #dbe5f2;border-radius:14px;margin:10px 0;padding:10px}.tkTable td{display:grid;grid-template-columns:92px minmax(0,1fr);gap:10px;align-items:center;border:0;padding:6px 0}.tkTable td:before{content:attr(data-label);font-weight:900;color:#64748b;font-size:12px;text-transform:uppercase}}</style>`);
    }
  }
  window.stockChangeMonth = function(m){ Stock.month = m; Stock.filter = {}; Stock.bind(); };
  window.stockSetFilter = function(sec,key){ Stock.filter[sec] = key; Stock.render(); };
  window.stockToggleExpand = function(sec){ Stock.expanded[sec] = !Stock.expanded[sec]; Stock.render(); };
  window.stockOpenForm = function(sec,rowId){
    const row = Stock.rows(sec).find(r => r.id === rowId) || { id:'', code:'', qty:1, price:0, stockType:'Thiếu', friend:'', customer:'', phone:'', note:'', payment:'Chưa thanh toán', cut:'Chưa cắt tồn' };
    if (rowId && !window.roleAdmin() && row.cut === 'Đã cắt tồn') return showToast('Dòng đã cắt tồn, nhân viên chỉ được xem');
    const friendOptions = Stock.friends.map(n => `<option ${row.friend===n?'selected':''}>${esc(n)}</option>`).join('');
    $('detailTitle').textContent = rowId ? 'Sửa dòng tồn kho' : 'Thêm dòng tồn kho';
    $('detailBody').innerHTML = `<div class="form"><input id="stkId" type="hidden" value="${esc(row.id)}"><div><label>Mã sản phẩm</label><input id="stkCode" value="${esc(row.code)}" oninput="this.value=this.value.toUpperCase()"></div><div><label>Số lượng</label><input id="stkQty" type="number" value="${esc(row.qty)}"></div><div><label>Giá bán</label><input id="stkPrice" type="number" value="${esc(row.price)}"></div>${sec==='diff'?`<div><label>Tồn kho</label><select id="stkStock"><option ${row.stockType==='Thiếu'?'selected':''}>Thiếu</option><option ${row.stockType==='Dư'?'selected':''}>Dư</option></select></div>`:''}${sec==='friend'?`<div><label>Người quen</label><select id="stkFriend">${friendOptions}</select></div>`:''}${sec==='customer'?`<div><label>Khách mua</label><input id="stkCustomer" value="${esc(row.customer)}"></div><div><label>SĐT</label><input id="stkPhone" value="${esc(row.phone)}"></div>`:''}</div><div class="panelfoot"><button class="btn gray" onclick="closeModal('detailModal')">Đóng</button><button class="btn blue" onclick="stockSaveForm('${sec}')">Lưu</button></div>`;
    openModal('detailModal');
  };
  window.stockSaveForm = function(sec){
    withActor(actor => {
      const oldId = $('stkId').value || id();
      const old = Stock.rows(sec).find(r => r.id === oldId) || {};
      if (old.id && !window.roleAdmin() && old.cut === 'Đã cắt tồn') return showToast('Dòng đã cắt tồn, nhân viên không được sửa');
      const item = Object.assign({}, old, {
        id: oldId,
        createdAt: old.createdAt || Date.now(),
        code: $('stkCode').value.trim().toUpperCase(),
        qty: Number($('stkQty').value || 0),
        price: Number($('stkPrice').value || 0),
        stockType: $('stkStock')?.value || old.stockType || 'Thiếu',
        friend: $('stkFriend')?.value || old.friend || '',
        customer: $('stkCustomer')?.value || old.customer || '',
        phone: $('stkPhone')?.value || old.phone || '',
        payment: old.payment || 'Chưa thanh toán',
        cut: old.cut || 'Chưa cắt tồn',
        logs: [...(old.logs||[]), logLine(old.id?'Sửa dòng':'Tạo dòng', actor)]
      });
      if (!item.code) return showToast('Nhập mã sản phẩm');
      stockRef('months', Stock.month, sec, item.id).set(item);
      closeModal('detailModal');
    });
  };
  window.stockOpenNote = function(sec,rowId){
    const row = Stock.rows(sec).find(r => r.id === rowId);
    if (!row) return;
    $('detailTitle').textContent = 'Ghi chú tồn kho';
    $('detailBody').innerHTML = `<div class="form"><div class="full"><textarea id="stockNoteText" style="min-height:160px">${esc(row.note||'')}</textarea></div></div><div class="panelfoot"><button class="btn blue" onclick="stockSaveNote('${sec}','${rowId}')">Lưu</button></div>`;
    openModal('detailModal');
  };
  window.stockSaveNote = function(sec,rowId){
    withActor(actor => {
      const row = Stock.rows(sec).find(r => r.id === rowId);
      const note = $('stockNoteText').value;
      stockRef('months', Stock.month, sec, rowId).update({ note, logs:[...(row.logs||[]), logLine('Sửa ghi chú', actor, `${row.note||''} -> ${note}`)] });
      closeModal('detailModal');
    });
  };
  window.stockDeleteRow = function(sec,rowId){ if (requireAdmin() && confirm('Xóa dòng này?')) stockRef('months', Stock.month, sec, rowId).remove(); };
  window.stockToggleCut = function(sec,rowId){
    if (!requireAdmin()) return;
    const row = Stock.rows(sec).find(r => r.id === rowId);
    stockRef('months', Stock.month, sec, rowId).update({ cut: row.cut==='Đã cắt tồn'?'Chưa cắt tồn':'Đã cắt tồn', logs:[...(row.logs||[]), logLine('Đổi trạng thái cắt tồn','Admin')] });
  };
  window.stockTogglePaid = function(sec,rowId){
    if (sec === 'diff') return;
    withActor(actor => {
      const row = Stock.rows(sec).find(r => r.id === rowId);
      stockRef('months', Stock.month, sec, rowId).update({ payment: row.payment==='Đã thanh toán'?'Chưa thanh toán':'Đã thanh toán', logs:[...(row.logs||[]), logLine('Đổi thanh toán',actor)] });
    });
  };
  window.stockPayAll = function(sec,rowId){
    if (sec === 'diff') return;
    if (!requireAdmin()) return;
    withActor(actor => {
      const row = Stock.rows(sec).find(r => r.id === rowId);
      stockRef('months', Stock.month, sec, rowId).update({ payment:'Đã thanh toán', logs:[...(row.logs||[]), logLine('Thanh toán toàn bộ',actor)] });
    });
  };
  window.stockHistory = function(sec,rowId){
    const row = Stock.rows(sec).find(r => r.id === rowId);
    $('detailTitle').textContent = 'Lịch sử tồn kho';
    $('detailBody').innerHTML = `<pre class="copyBox">${esc(logText(row?.logs||[]))}</pre>`;
    openModal('detailModal');
  };
  window.stockTotalHistory = function(){
    const logs = Stock.sections().flatMap(sec => Stock.rows(sec.id).flatMap(r => (r.logs || []).map(l => Object.assign({ section:sec.title, code:r.code }, l))));
    logs.sort((a,b)=>(b.at||0)-(a.at||0));
    const text = logs.map(l => `${new Date(l.at || Date.now()).toLocaleString('vi-VN')} - ${l.section || '-'} - ${l.code || '-'} - ${l.actor || '-'} - ${l.action || ''}${l.detail ? ': ' + l.detail : ''}`).join('\n') || 'Chưa có lịch sử tồn kho';
    $('detailTitle').textContent = 'Lịch sử tổng tồn kho';
    $('detailBody').innerHTML = `<pre class="copyBox">${esc(text)}</pre>`;
    openModal('detailModal');
  };
  window.stockOpenFriends = function(){
    $('detailTitle').textContent = 'Danh sách người quen';
    $('detailBody').innerHTML = `<div class="form">${window.roleAdmin()?`<div class="full"><input id="friendNew" placeholder="Tên người quen"><button class="btn blue" onclick="stockAddFriend()">+ Thêm</button></div>`:''}<div class="full">${Stock.friends.map(n=>`<div class="tkFriendItem"><input value="${esc(n)}" ${window.roleAdmin()?'':'disabled'} onchange="stockRenameFriend('${esc(n)}',this.value)">${window.roleAdmin()?`<button class="btn red" onclick="stockDeleteFriend('${esc(n)}')">Xóa</button>`:''}</div>`).join('') || '<b>Chưa có người quen</b>'}</div></div>`;
    openModal('detailModal');
  };
  window.stockAddFriend = function(){ if (!requireAdmin()) return; const n = $('friendNew').value.trim(); if (n) { Stock.friends = Array.from(new Set([...Stock.friends,n])); stockRef('friends').set(Stock.friends).then(()=>stockOpenFriends()); } };
  window.stockRenameFriend = function(oldName,newName){ if (!requireAdmin()) return; Stock.friends = Stock.friends.map(n => n===oldName ? newName.trim() : n).filter(Boolean); stockRef('friends').set(Stock.friends).then(()=>stockOpenFriends()); };
  window.stockDeleteFriend = function(n){ if (requireAdmin()) { Stock.friends = Stock.friends.filter(x => x!==n); stockRef('friends').set(Stock.friends).then(()=>stockOpenFriends()); } };

  function ensureHeaderTools(){
    ensurePolishStyle();
    if (!$('headerToggleBtn')) {
      const btn = document.createElement('button');
      btn.id = 'headerToggleBtn';
      btn.textContent = 'Ẩn';
      btn.onclick = () => {
        document.body.classList.toggle('headerHidden');
        btn.textContent = document.body.classList.contains('headerHidden') ? 'Hiện' : 'Ẩn';
      };
      document.body.appendChild(btn);
    }
    if (!$('quickLinks')) {
      const links = document.createElement('div');
      links.id = 'quickLinks';
      links.style.display = 'flex';
      links.style.gap = '6px';
      links.innerHTML = `<button class="topMiniBtn" onclick="window.open('https://linhdanshop.github.io/xulydon/','_blank')">Gọi</button><button class="topMiniBtn adminQuick" onclick="window.open('https://linhdanshop.github.io/quetbill/','_blank')">Quét</button><button class="topMiniBtn" onclick="window.open('https://linhdanshop.github.io/vandon/','_blank')">XLD</button>`;
      document.querySelector('.topright')?.prepend(links);
    }
  }
  function ensurePolishStyle(){
    if ($('appPolishStyle')) return;
    document.head.insertAdjacentHTML('beforeend', `<style id="appPolishStyle">
      #adminTestNotify.adminNotifyOn{background:#fde68a!important;color:#7c2d12!important}
      .cellNoteStack{display:flex;flex-direction:column;align-items:flex-start;gap:6px;min-width:0}
      .cellNoteStack .noteview{width:100%;text-align:left}
      .cellNoteStack .imgbadge{margin-top:0}
      .menu.open{z-index:7000!important}
      .colResizer{position:absolute;top:0;right:0;width:9px;height:100%;cursor:col-resize;user-select:none}
      .colResizer:hover{background:#bfdbfe}
      .employeeInlineList{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
      .employeeInlineItem{display:inline-flex;align-items:center;gap:8px;border:1px solid #dbe5f2;background:#f8fafc;border-radius:999px;padding:7px 10px;font-weight:900}
      .employeeInlineItem button{border:0;background:#fee2e2;color:#dc2626;border-radius:999px;width:24px;height:24px;font-weight:1000;cursor:pointer}
      .defaultPick{display:inline-flex;align-items:center;gap:6px;font-weight:900}
      .defaultPick input{width:auto;height:auto}
      .tkCode{display:inline-block;background:transparent!important;color:#dc2626!important;border-radius:0!important;padding:0!important;font-size:17px;font-weight:1000}
      .tkStat.money.neg b,.tkNeg{color:#dc2626!important;font-weight:1000}
      .tkStat.money.pos b,.tkPos{color:#15803d!important;font-weight:1000}
      .tkStat.friendStat{background:#fff!important;color:#7f1d1d!important;border-color:#fecaca!important}
      .tkStat.friendStat b{color:#7f1d1d!important}
      .tkStat.friendStat span{display:block;color:#7f1d1d!important;font-weight:900}
      .tkStat.friendStat strong,.tkStat.friendStat em{display:block;color:#991b1b!important;font-style:normal;font-size:14px;line-height:1.2}
      .deviceNameOnline{color:#dc2626!important;font-weight:1000}
      .deviceHistoryBtn{height:32px!important;padding:0 10px!important;border-radius:8px!important;min-width:0!important}
      .dkCodeHot span,.dkHotCode{color:#dc2626!important;font-weight:1000}
      .remindMini{width:86px!important}
      .dkNoteBtn{width:100%;border:1px solid #dbe5f2;background:#fff;border-radius:8px;padding:7px 9px;text-align:left;font-weight:800;cursor:pointer;min-height:34px}
      .dkNoteBtn.empty{color:#94a3b8}
      @media(max-width:760px){
        .tkTableWrap{overflow:visible!important}
        .tkTable{display:block!important;min-width:0!important;border:0!important}
        .tkTable thead{display:none!important}
        .tkTable tbody{display:block!important}
        .tkTable tr{display:block!important;background:#fff!important;border:1px solid #dbe5f2!important;border-radius:14px!important;margin:10px 0!important;padding:10px!important}
        .tkTable td{display:grid!important;grid-template-columns:92px minmax(0,1fr)!important;gap:10px!important;align-items:center!important;border:0!important;padding:6px 0!important}
        .tkTable td:before{content:attr(data-label);font-weight:900;color:#64748b;font-size:12px;text-transform:uppercase}
        .tkTable .action{justify-self:start}
        .tkStats{grid-template-columns:repeat(2,minmax(0,1fr))!important}
        .tkHead>div{display:flex;gap:8px;flex-wrap:wrap}
        #dailyTab .miniTable td[data-label="Nội dung"],#dailyTab .miniTable td[data-label="Ghi chú admin"]{align-items:start!important}
        #dailyTab .miniTable td[data-label="Tên CV"]{grid-template-columns:74px minmax(0,1fr)!important}
        #dailyTab .dailyTitlePill{min-width:0!important;width:100%!important;white-space:normal!important;word-break:break-word}
        #dailyTab .empchips{max-width:none!important;flex-direction:row!important;flex-wrap:wrap!important}
        #dailyTab .dailyTinyActions{flex-direction:row!important;flex-wrap:wrap!important}
      }
    </style>`);
  }

  function init(){
    ensureHeaderTools();
    Device.bind();
    Tasks.init();
    Stock.init();
    if (!isLogged()) openModal('loginModal');
    setDateButtonActive('Hôm nay');
    updateAuthUi();
    renderAll();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
