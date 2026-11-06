'use strict';
/* 星海边境 · ORBITAL FRONTIER v2 — client
 * Renders the authoritative fleet-strategy state and turns input into intents.
 * No game maths happens here: ships, fleets and worlds are drawn exactly as the server broadcasts them. */
(function () {
  var TAU = Math.PI * 2;
  var $ = function (sel) { return document.querySelector(sel); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function dist(ax, ay, bx, by) { var dx = ax - bx, dy = ay - by; return Math.sqrt(dx * dx + dy * dy); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function storeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function storeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function cleanName(raw) {
    var s = String(raw == null ? '' : raw).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    var a = Array.from(s); if (a.length > 12) s = a.slice(0, 12).join('');
    return s;
  }
  function pickName() {
    var n = ['北枢', '织女', '天狼', '心宿', '长河', '赤乌', '望舒', '烛龙'];
    return n[Math.floor(Math.random() * n.length)] + '-' + String(Math.floor(Math.random() * 90) + 10);
  }
  function rgba(hex, a) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return 'rgba(110,247,255,' + a + ')';
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function hsl(h, s, l) { return 'hsl(' + h + ',' + s + '%,' + l + '%)'; }
  function seeded(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  var canvas = $('#stage');
  var ctx = canvas.getContext('2d');
  var minimapCanvas = $('#minimap');
  var mctx = minimapCanvas ? minimapCanvas.getContext('2d') : null;

  var dom = {
    start: $('#startScreen'), chip: $('#serverChip'), chipText: $('#serverStatus'), chipCount: $('#onlineCount'),
    hud: $('#hud'), badge: $('#selfBadge'), selfName: $('#selfName'), selfTag: $('#selfTag'),
    statPlanets: $('#statPlanets'), statShips: $('#statShips'), statFleets: $('#statFleets'),
    energyText: $('#energyText'), energyBar: $('#energyBar'),
    minimap: minimapCanvas,
    minimapWrap: $('#minimapWrap'),
    planetList: $('#planetList'), myWorldsCount: $('#myWorldsCount'), factionList: $('#factionList'), factionCount: $('#factionCount'),
    tabPlanets: $('#tabPlanets'), tabFactions: $('#tabFactions'), planetsView: $('#planetsView'), factionsView: $('#factionsView'),
    orderPanel: $('#orderPanel'), opKicker: $('#opKicker'), opTitle: $('#opTitle'), opTags: $('#opTags'),
    opStats: $('#opStats'), opBars: $('#opBars'), sliderBlock: $('#sliderBlock'), slider: $('#countSlider'),
    sliderLabel: $('#sliderLabel'), sliderValue: $('#sliderValue'), opActions: $('#opActions'), opNote: $('#opNote'),
    opChevron: $('#opChevron'),
    opProgress: $('#opProgress'), opProgressText: $('#opProgressText'), opProgressBar: $('#opProgressBar'), opClose: $('#opClose'),
    hintStep: $('#hintStep'), hintText: $('#hintText'), modeTag: $('#modeTag'), mapCoords: $('#mapCoords'),
    feed: $('#eventFeed'), toast: $('#toast'), netBanner: $('#netBanner'),
    chatPanel: $('#chatPanel'), chatLog: $('#chatLog'), chatForm: $('#chatForm'), chatInput: $('#chatInput'),
    chatBtn: $('#chatBtn'), chatHead: $('#chatHead'), chatChannels: $('#chatChannels'),
    chatChGlobal: $('#chatChGlobal'), chatChAlly: $('#chatChAlly'), chatCool: $('#chatCool'),
    chatCollapse: $('#chatCollapse'), chatSend: $('#chatSend'),
    menuBtn: $('#menuBtn'), hudMenu: $('#hudMenu'), menuSoundState: $('#menuSoundState'),
    elimOverlay: $('#elimOverlay'), elimSeconds: $('#elimSeconds'),
    statusDialog: $('#statusDialog'), statusBody: $('#statusBody'), statusClose: $('#statusClose'), chatBadge: $('#chatBadge'), soundBtn: $('#soundBtn'), helpBtn: $('#helpBtn'),
    helpPanel: $('#helpPanel'), helpClose: $('#helpClose'),
    // ---- Stage 2 · Task B 元素 ----
    dispatchDock: $('#dispatchDock'), dispatchBar: $('#dispatchBar'), dispatchTrack: $('#dispatchTrack'),
    dispatchFill: $('#dispatchFill'), dispatchThumb: $('#dispatchThumb'), dispatchPctLabel: $('#dispatchPctLabel'),
    dispatchTicks: $('#dispatchTicks'), allyBars: $('#allyBars'),
    dispatchCountInput: $('#dispatchCountInput'),
    // ---- Stage 5.3/5.4 首页三态 / 远征沙盒 ----
    homeView: $('#homeView'), homeMainMenu: $('#homeMainMenu'), standbyPrompt: $('#standbyPrompt'),
    homeNoticeBtn: $('#homeNoticeBtn'), homeSwitch: $('#homeSwitch'), homeExpedition: $('#homeExpedition'),
    expeditionModal: $('#expeditionModal'), expeditionFileInput: $('#expeditionFileInput'),
    expeditionStartDefault: $('#expeditionStartDefault'), expeditionClose: $('#expeditionClose'),
    expeditionMsg: $('#expeditionMsg'), homeAnnounce: $('#homeAnnounce'),
    planetHexMenu: $('#planetHexMenu'), hexInfo: $('#hexInfo'), hexMid: $('#hexMid'), hexLast: $('#hexLast'),
    hexMidLabel: $('#hexMidLabel'), hexLastLabel: $('#hexLastLabel'),
    planetInfoPopup: $('#planetInfoPopup'), piKicker: $('#piKicker'), piTitle: $('#piTitle'),
    piRows: $('#piRows'), piFleets: $('#piFleets'), piClose: $('#piClose'),
    confirmModal: $('#confirmModal'), confirmKicker: $('#confirmKicker'), confirmTitle: $('#confirmTitle'),
    confirmBody: $('#confirmBody'), confirmOk: $('#confirmOk'), confirmCancel: $('#confirmCancel'),
    jointStatus: $('#jointStatus'), jointStatusBody: $('#jointStatusBody'),
    jointReqList: $('#jointReqList'),
    // ---- Stage 2 · Task C 元素 ----
    mailOrb: $('#mailOrb'), mailBadge: $('#mailBadge'), mailPanel: $('#mailPanel'), mailClose: $('#mailClose'), mailList: $('#mailList'),
    dealModal: $('#dealModal'), dealKicker: $('#dealKicker'), dealTitle: $('#dealTitle'), dealBody: $('#dealBody'), dealSubmit: $('#dealSubmit'), dealCancel: $('#dealCancel'),
    diploModal: $('#diploModal'), diploKicker: $('#diploKicker'), diploTitle: $('#diploTitle'), diploState: $('#diploState'), diploActions: $('#diploActions'), diploHint: $('#diploHint'), diploClose: $('#diploClose'),
    // ---- Stage 3 · Task E 元素 ----
    countdownBar: $('#countdownBar'), countdownText: $('#countdownText'),
    scoreBoard: $('#scoreBoard'), scoreBoardBody: $('#scoreBoardBody'), scoreBoardToggle: $('#scoreBoardToggle'),
    spectateBadge: $('#spectateBadge'),
    lobbyPanel: $('#lobbyPanel'), lobbyTitle: $('#lobbyTitle'), lobbyHost: $('#lobbyHost'), lobbyPlayers: $('#lobbyPlayers'),
    lobbyControls: $('#lobbyControls'), lobbyAddAI: $('#lobbyAddAI'), lobbyRemoveAI: $('#lobbyRemoveAI'), lobbyStart: $('#lobbyStart'), lobbyNote: $('#lobbyNote'),
    roomSettledModal: $('#roomSettledModal'), rsTitle: $('#rsTitle'), rsReason: $('#rsReason'), rsBody: $('#rsBody'), rsClose: $('#rsClose'),
    // ---- Stage 4 · H3 门户四视图 ----
    bootstrapView: $('#bootstrapView'), authView: $('#authView'), lobbyHallView: $('#lobbyHallView'),
    bootstrapForm: $('#bootstrapForm'), bootToken: $('#bootToken'), bootUser: $('#bootUser'), bootPass: $('#bootPass'), bootSubmit: $('#bootSubmit'), bootMsg: $('#bootMsg'),
    tabLogin: $('#tabLogin'), tabRegister: $('#tabRegister'), tabReset: $('#tabReset'),
    loginForm: $('#loginForm'), loginUser: $('#loginUser'), loginPass: $('#loginPass'),
    regForm: $('#regForm'), regUser: $('#regUser'), regPass: $('#regPass'),
    resetForm: $('#resetForm'), resetUser: $('#resetUser'), resetCode: $('#resetCode'), resetPass: $('#resetPass'), authMsg: $('#authMsg'),
    hallUser: $('#hallUser'), hallRole: $('#hallRole'), hallAvatar: $('#hallAvatar'), hallVersion: $('#hallVersion'), hallMods: $('#hallMods'),
    adminBtn: $('#adminBtn'), hallRefresh: $('#hallRefresh'), hallLogout: $('#hallLogout'),
    hallFilters: $('#hallFilters'), hallFilterAll: $('#hallFilterAll'), hallFilterNormal: $('#hallFilterNormal'), hallFilterElim: $('#hallFilterElim'), hallFilterEndless: $('#hallFilterEndless'),
    mcRoomList: $('#mcRoomList'), mcJoinSelected: $('#mcJoinSelected'), mcCreateElim: $('#mcCreateElim'), mcSpectate: $('#mcSpectate'), mcRefresh: $('#mcRefresh'), mcLogout: $('#mcLogout'),
    createElimForm: $('#createElimForm'), elimName: $('#elimName'), elimMax: $('#elimMax'), hallMsg: $('#hallMsg'), hallBackHome: $('#hallBackHome'),
    homeView: $('#homeView'), homeAvatar: $('#homeAvatar'), homeUser: $('#homeUser'), homeRole: $('#homeRole'), homeSwitch: $('#homeSwitch'), homeStatus: $('#homeStatus'), homeSound: $('#homeSound'), homeAnnounce: $('#homeAnnounce'),
    homeLobby: $('#homeLobby'), homeSettings: $('#homeSettings'),
    settingsModal: $('#settingsModal'), setVolume: $('#setVolume'), setUiSfx: $('#setUiSfx'), setQuality: $('#setQuality'), setNebula: $('#setNebula'), setShowFps: $('#setShowFps'), settingsClose: $('#settingsClose'), fpsBadge: $('#fpsBadge'),
    setRotPlanet: $('#setRotPlanet'), setNebulaFlow: $('#setNebulaFlow'),
    setParticles: $('#setParticles'), setEngineTrails: $('#setEngineTrails'),
    setPlanetRings: $('#setPlanetRings'),
    recoveryModal: $('#recoveryModal'), recoveryCode: $('#recoveryCode'), recoveryDone: $('#recoveryDone'), recoveryCopy: $('#recoveryCopy'), recoveryTemp: $('#recoveryTemp'),
    // Stage 5.3/5.4：管理台已迁至门户独立路由（默认 /qaqmin），前端不再持有 admin 元素引用
    rsLobby: $('#rsLobby')
  };

  var state = {
    mode: 'start',
    ws: null, connected: false, joined: false, everJoined: false, joining: false,
    token: storeGet('of.token') || '', name: storeGet('of.name') || '',
    selfId: 0, world: { w: 12400, h: 8800 }, rules: {},
    players: new Map(), planets: new Map(), fleets: new Map(), nodes: new Map(), outposts: new Map(),
    fleetShips: new Map(),
    pacts: [], coalitions: [], hudPlayers: new Map(),
    selPlanet: 0, selFleet: 0, orderSrc: 0, inspectPlanet: 0,
    sliderValue: 0,
    cam: { x: 6200, y: 4400, zoom: 0.28, tx: 6200, ty: 4400 },
    dpr: 1, t: 0, lastFrame: performance.now(),
    ping: 0, lastPingSent: 0, lastStateAt: 0,
    chatOpen: false, unread: 0, helpOpen: false, typing: false,
    chatChannel: 'global', chatCollapsed: false, lastChatAt: 0,   // Task D：双通道聊天
    settings: {
      volume: 60, uiSfx: true, quality: 'balanced', nebula: 100,
      planetRotate: true, nebulaFlow: true, particles: true,
      engineTrails: true, planetRings: true, showFps: false
    }, // Stage5.5：MC 式 10 字段
    fps: 0, _fpsFrames: 0, _fpsAcc: 0,
    muted: storeGet('of.muted') === '1',
    pointer: { down: false, moved: false, sx: 0, sy: 0, cx: 0, cy: 0, id: 0, type: 'mouse', x: 0, y: 0 },
    pointers: new Map(), pinch: null,
    lastClick: { id: '', t: 0 },
    stars: null,
    particles: [],
    rings: [],
    toastTimer: null, reconnectTimer: null, reconnectAttempt: 0, joinTimer: null,
    panelKey: '', hint: 0, feedCount: 0, orbs: [],
    tracers: [],
    // ---- Stage 2 · Task B 客户端状态 ----
    dispatchPct: 1,        // B1：派遣比例 0..1，默认 100%
    dispatchExactCount: null, // 5.4 §6.2：直接输入的精确派遣艘数（null=按百分比）
    heroStage: 'auth',     // 5.4 §2.1：首页三态 auth | standby | menu
    heroPan: 0,            // 5.4 §2.2：0=行星居中，1=镜头左移到位
    uiBursts: [],          // 5.4 §4.1：全局点击星芒粒子（屏幕空间）
    sandbox: false,        // 5.4 §3.2：本地远征沙盒模式
    allyPct: {},           // B3：盟友滑条 { ownerId: pct }
    hexDismissed: false,   // B2：点击空白后是否暂时收起六边形按钮
    infoPlanet: 0, infoSig: '',
    confirmCb: null,
    joints: {},            // B4：我发起的联合出兵集结 { id: {accepted,deadline} }
    jointReqs: {},         // B4：我收到的联合出兵请求 { id: msg }
    // ---- Stage 2 · Task C 客户端状态 ----
    dragOrder: null,       // C1：拖拽派遣 {srcId,x,y,active}
    dragHover: null,
    mail: [], mailUnread: 0, mailPos: null, mailOpen: false,   // C2：邮件球
    deal: null, diplo: null,                                   // C3/C4：对话框状态
    // ---- Stage 3 · Task E 房间/模式状态 ----
    roomId: '', roomMode: '', roomName: '', roomStatus: '', roomMaxPlayers: 8, roomHostId: 0,
    roomMods: [], spectating: false, noJoin: false, remainingMs: null, countdownSec: null,
    leaderboard: [], roomSettled: null, roomList: [],
    roomConnect: null, pendingSpectate: false,   // Stage 4：房间连接信息 / 观战标记
    hallPollTimer: null                          // Stage 4.1：大厅 5s 轮询
  };

  /* ---------------- helpers ---------------- */
  function selfPlayer() { return state.players.get(state.selfId) || null; }
  function planetArray() { return Array.from(state.planets.values()); }
  function isMine(pl) { return pl && pl.owner === state.selfId; }
  function ownerShielded(ownerId) {
    var op = state.players.get(ownerId);
    return !!(op && op.shielded);
  }
  function planetShielded(pl) { return !!pl && !!pl.owner && ownerShielded(pl.owner); }
  function isAlly(id) { var p = state.players.get(id); var me = selfPlayer(); return !!(p && me && p.coalition && p.coalition === me.coalition && id !== state.selfId); }
  function displayColor(id) {
    var p = state.players.get(id);
    if (!p) return '#7dd3fc';
    return p.color;
  }
  function myPlanets() { return planetArray().filter(function (p) { return p.owner === state.selfId; }); }
  function myFleets() { return Array.from(state.fleets.values()).filter(function (f) { return f.owner === state.selfId; }); }
  function factionName(id) { var p = state.players.get(id); return p ? p.name : '中立'; }

  // Viewport in CSS pixels. jsdom reports viewW() as 0, so fall back to the window.
  function viewW() { return canvas.clientWidth || window.innerWidth || 960; }
  function viewH() { return canvas.clientHeight || window.innerHeight || 640; }
  function screenToWorld(sx, sy) {
    var z = state.cam.zoom;
    return { x: (sx - viewW() / 2) / z + state.cam.x, y: (sy - viewH() / 2) / z + state.cam.y };
  }

  /* ---------------- audio ---------------- */
  var audio = { ctx: null, master: null, last: {} };
  function initAudio() {
    if (audio.ctx) { if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(function () {}); return; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      audio.ctx = new AC();
      audio.master = audio.ctx.createGain();
      audio.master.gain.value = state.muted ? 0 : 0.3;
      audio.master.connect(audio.ctx.destination);
    } catch (e) { audio.ctx = null; }
  }
  function sfx(name) {
    if (!audio.ctx || state.muted) return;
    var now = performance.now();
    if (now - (audio.last[name] || 0) < (name === 'hover' ? 60 : 40)) return;
    audio.last[name] = now;
    var c = audio.ctx, t = c.currentTime;
    var o = c.createOscillator(), g = c.createGain();
    var cfg = {
      click: ['sine', 720, 880, 0.05, 0.03],
      order: ['triangle', 320, 620, 0.14, 0.06],
      deny: ['square', 200, 150, 0.09, 0.03],
      capture: ['triangle', 440, 880, 0.22, 0.08],
      battle: ['sawtooth', 160, 90, 0.18, 0.03],
      pact: ['sine', 520, 1040, 0.25, 0.06],
      lost: ['sawtooth', 260, 80, 0.3, 0.07],
      hover: ['sine', 1600, 2100, 0.05, 0.02],
      tab: ['triangle', 900, 1300, 0.06, 0.02],
      modalOpen: ['sine', 300, 900, 0.18, 0.05],
      modalClose: ['sine', 900, 300, 0.16, 0.04],
      joinRoom: ['triangle', 260, 1040, 0.35, 0.08]
    }[name] || ['sine', 440, 440, 0.05, 0.02];
    o.type = cfg[0];
    o.frequency.setValueAtTime(cfg[1], t);
    o.frequency.exponentialRampToValueAtTime(Math.max(40, cfg[2]), t + cfg[3]);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(cfg[4], t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cfg[3]);
    o.connect(g); g.connect(audio.master);
    o.start(t); o.stop(t + cfg[3] + 0.02);
  }
  function syncSoundBtn() {
    if (dom.menuSoundState) dom.menuSoundState.textContent = state.muted ? '关' : '开';
    if (audio.master && audio.ctx) audio.master.gain.value = state.muted ? 0 : 0.3;
  }

  /* ---------------- toast / feed ---------------- */
  function toast(text, err) {
    clearTimeout(state.toastTimer);
    dom.toast.textContent = text;
    dom.toast.classList.toggle('err', !!err);
    dom.toast.classList.add('show');
    state.toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, 2600);
  }
  function feed(html, bad) {
    var item = document.createElement('div');
    item.className = 'feed-item' + (bad ? ' bad' : '');
    item.innerHTML = html;
    dom.feed.appendChild(item);
    state.feedCount++;
    while (dom.feed.children.length > 5) dom.feed.removeChild(dom.feed.firstChild);
    setTimeout(function () { if (item.parentNode) item.parentNode.removeChild(item); }, 7000);
  }

  /* ---------------- star backdrop ---------------- */
  function buildStars() {
    var rnd = seeded(4242);
    state.stars = [];
    for (var i = 0; i < 300; i++) {
      state.stars.push({ x: rnd() * state.world.w, y: rnd() * state.world.h, r: 0.6 + rnd() * 1.6, a: 0.15 + rnd() * 0.5, tw: rnd() * TAU });
    }
    // 12 bright stars: 7 cold white + 5 warm orange
    for (var b = 0; b < 12; b++) {
      state.stars.push({ x: rnd() * state.world.w, y: rnd() * state.world.h, r: 1.6 + rnd() * 1.4, a: 0.85, tw: rnd() * TAU, bright: true, color: b < 7 ? '#d8f3ff' : '#ff8c42' });
    }
    // baked nebula band on an offscreen canvas
    var W = 1024, H = 720;
    var off = document.createElement('canvas'); off.width = W; off.height = H;
    var g = off.getContext('2d');
    g.fillStyle = '#040711'; g.fillRect(0, 0, W, H);
    var pal = ['rgba(38,68,145,0.12)', 'rgba(72,45,128,0.09)', 'rgba(24,90,115,0.08)'];
    g.globalCompositeOperation = 'screen';
    for (var k = 0; k < 22; k++) {
      var t0 = k / 21;
      var cx = 150 + t0 * (880 - 150) + (rnd() - 0.5) * 220;
      var cy = 100 + t0 * (620 - 100) + (rnd() - 0.5) * 180;
      var rad = 120 + rnd() * 200;
      var gd = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gd.addColorStop(0, pal[k % 3]);
      gd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gd;
      g.beginPath(); g.ellipse(cx, cy, rad, rad * 0.72, 0.6, 0, TAU); g.fill();
    }
    // dust
    for (var d = 0; d < 400; d++) {
      var dx = 150 + rnd() * 730, dy = 100 + rnd() * 520;
      g.fillStyle = 'rgba(200,225,255,0.18)';
      g.fillRect(dx, dy, 0.5 + rnd() * 0.5, 0.5 + rnd() * 0.5);
    }
    g.globalCompositeOperation = 'source-over';
    state.nebulaCanvas = off;
  }

  /* ---------------- network ---------------- */
  function updateChip(ok, text, count) {
    if (dom.chip) dom.chip.classList.toggle('offline', !ok);
    if (dom.chipText) dom.chipText.textContent = text;
    if (typeof count === 'number' && dom.chipCount) dom.chipCount.textContent = count + ' 阵营';
  }
  function refreshStatus() {
    if (state.joined) return;
    fetch('/api/status', { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        updateChip(true, '星域链路正常', (d.players || []).length);
        if (dom.note) dom.note.innerHTML = '<span class="tiny-dot"></span>星域在线 · ' + (d.planets || 0) + ' 颗星球 · ' + (d.players || []).length + ' 个阵营';
      })
      .catch(function () {
        updateChip(false, '星域链路离线');
        if (dom.note) dom.note.innerHTML = '<span class="tiny-dot"></span>无法连接星域服务器';
      });
  }
  function setJoinBusy(busy, label) {
    state.joining = busy;
    if (!dom.joinBtn) return;
    dom.joinBtn.disabled = busy;
    var span = dom.joinBtn.querySelector('span');
    if (span) span.textContent = label || (busy ? '正在接入' : '进入星域');
  }
  function openSocket() {
    if (state.ws && wsOpen()) return;
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var sock = null;
    try { sock = typeof WebSocket === 'function' ? new WebSocket(proto + '//' + location.host + '/ws') : null; } catch (e) { sock = null; }
    if (!sock) { try { sock = WebSocket(proto + '//' + location.host + '/ws'); } catch (e) { sock = null; } }
    if (!sock) return;
    state.ws = sock;
    sock.onopen = function () {
      state.connected = true;
      updateChip(true, '星域链路正常');
      // a stored token means this tab already had a seat: rejoin automatically after a refresh
      var hasSeat = !!state.token;
      if (state.joining || state.everJoined || hasSeat) {
        state.joining = true;
        sock.send(JSON.stringify({ t: 'join', name: state.name || pickName(), token: state.token || null }));
      }
    };
    sock.onmessage = function (ev) {
      var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
    sock.onclose = function () {
      state.connected = false;
      try { ModSandbox.unloadAll(); } catch (e) {}   // Task G：断开时卸载 Mod
      if (state.everJoined) {
        dom.netBanner.hidden = false;
        scheduleReconnect();
      } else {
        setJoinBusy(false, '重新接入');
        updateChip(false, '星域链路离线');
      }
    };
    sock.onerror = function () {};
  }
  function scheduleReconnect() {
    if (state.reconnectTimer) return;
    state.reconnectAttempt = Math.min(state.reconnectAttempt + 1, 6);
    state.reconnectTimer = setTimeout(function () {
      state.reconnectTimer = null;
      if (state.ws && state.ws.readyState <= 1 && state.ws.readyState !== 3) return;
      reconnectRoom();
    }, Math.min(8000, 600 * Math.pow(1.7, state.reconnectAttempt)) + Math.random() * 400);
  }
  function join(ev) {
    if (ev) ev.preventDefault();
    if (!dom.name) return;   // H3：旧直连表单已移除，仅保留兼容
    if (state.joining || state.joined) return;
    try { ModSandbox.unloadAll(); } catch (e) {}   // Task G：进新房前卸载旧 Mod
    var name = cleanName(dom.name.value) || pickName();
    dom.name.value = name;
    state.name = name;
    storeSet('of.name', name);
    initAudio();
    setJoinBusy(true, '正在接入');
    clearTimeout(state.joinTimer);
    state.joinTimer = setTimeout(function () {
      if (!state.joined) { setJoinBusy(false, '重新接入'); toast('接入超时，请确认服务器在线', true); }
    }, 9000);
    openSocket();
    if (state.ws && wsOpen()) state.ws.send(JSON.stringify({ t: 'join', name, token: state.token || null }));
  }
  function wsOpen() {
    if (!state.ws) return false;
    var rs = state.ws.readyState;
    var open = (state.ws.OPEN === undefined ? 1 : state.ws.OPEN);
    return rs === 1 || rs === open;
  }
  function sendIntent(obj) {
    if (state.sandbox) return handleSandboxIntent(obj);
    if (!wsOpen() || !state.joined) { toast('链路未连接', true); return false; }
    state.ws.send(JSON.stringify(obj));
    return true;
  }
  function sendPing() {
    if (!wsOpen()) return;
    state.lastPingSent = performance.now();
    state.ws.send(JSON.stringify({ t: 'ping', c: state.lastPingSent }));
  }

  var bus = {
    _map: {},
    on: function (ev, fn) { (this._map[ev] = this._map[ev] || []).push(fn); },
    emit: function (ev, payload) {
      var list = this._map[ev];
      if (!list) return;
      for (var i = 0; i < list.length; i++) { try { list[i](payload); } catch (e) {} }
    }
  };

  function applyData(d) {
    var prevKey = state.dataKey;
    var prevPactKey = (state.pacts || []).map(function (x) { return x.a + ':' + x.b; }).join(',');
    var key = '';
    if (Array.isArray(d.players)) { key += 'P' + d.players.length + ':' + d.players.map(function (p) { return p.id + p.coalition + Math.round(p.resource) + (p.shielded ? 'S' : '') + (p.online ? 'O' : ''); }).join(','); }
    if (Array.isArray(d.outposts)) { state.outposts.clear(); d.outposts.forEach(function (o) { state.outposts.set(o.id, o); }); }
    if (Array.isArray(d.planets)) { key += 'W' + d.planets.map(function (p) { return p.id + ':' + p.owner + ':' + p.troops + ':' + p.resource + ':' + (p.captureProg || 0) + ':' + (p.purityProg || 0) + ':' + (p.reinforce ? 1 : 0) + ':' + (p.destroyTimer > 0 ? p.destroyTimer : 0) + ':' + p.color; }).join(','); }
    if (Array.isArray(d.fleets)) { key += 'F' + d.fleets.map(function (f) { return f.id + ':' + f.n + ':' + (f.orbiting || 0); }).join(','); }
    state.dataKey = key;
    if (Array.isArray(d.players)) { state.players.clear(); d.players.forEach(function (p) { state.players.set(p.id, p); }); }
    if (Array.isArray(d.planets)) {
      var prevPlanets = new Map(state.planets);
      state.planets.clear();
      var nowP = performance.now();
      d.planets.forEach(function (p) {
        var oldP = prevPlanets.get(p.id);
        p._fadeAt = (oldP && oldP._fadeAt != null) ? oldP._fadeAt : (nowP - 1000);
        p._visCap = (oldP && oldP._visCap != null) ? oldP._visCap : (p.captureProg || 0);
        p._visPur = (oldP && oldP._visPur != null) ? oldP._visPur : (p.purityProg == null ? (p.owner ? 1 : 0) : p.purityProg);
        p._ringShares = (oldP && oldP._ringShares) ? oldP._ringShares : {};
        state.planets.set(p.id, p);
      });
    }
    if (Array.isArray(d.fleets)) {
      var nowT = performance.now();
      var seen = new Set();
      d.fleets.forEach(function (f) {
        seen.add(f.id);
        var prev = state.fleets.get(f.id);
        if (prev) {
          // keep the drawn position and ease toward the authoritative one
          f.dx = prev.dx == null ? prev.x : prev.dx;
          f.dy = prev.dy == null ? prev.y : prev.dy;
          f.lerpT = 0;
          f.fromX = f.dx; f.fromY = f.dy;
          f.toX = f.x; f.toY = f.y;
        } else {
          f.dx = f.px == null ? f.x : f.px;
          f.dy = f.py == null ? f.y : f.py;
          f.lerpT = 1;
          f.fromX = f.dx; f.fromY = f.dy; f.toX = f.x; f.toY = f.y;
        }
        f.updatedAt = nowT;
        state.fleets.set(f.id, f);
      });
      state.fleets.forEach(function (f, id) { if (!seen.has(id)) state.fleets.delete(id); });
    }
    if (Array.isArray(d.nodes)) { state.nodes.clear(); d.nodes.forEach(function (n) { state.nodes.set(n.id, n); }); }
    if (Array.isArray(d.pacts)) state.pacts = d.pacts;
    if (Array.isArray(d.coalitions)) state.coalitions = d.coalitions;
    var newPactKey = (state.pacts || []).map(function (x) { return x.a + ':' + x.b; }).join(',');
    if (newPactKey !== prevPactKey) bus.emit('diplomacy:change', {});
    if (key !== prevKey) bus.emit('state:change', {});
  }

  function handle(msg) {
    try { handleInner(msg); } catch (err) {
      console.error('message handler failed', msg && msg.t, err);
      if (!state.joined) { state.connecting = false; setJoinBusy(false, '重新接入'); toast('同步出错，请刷新页面重试', true); }
      else { state.joinError = String(err && err.message || err); }
    }
  }
  function handleInner(msg) {
    if (msg.t === 'hello') {
      state.joined = true;
      state.everJoined = true;
      state.selfId = msg.id;
      state.token = msg.token || '';
      if (state.token) storeSet('of.token', state.token);
      state.world = msg.world || state.world;
      state.rules = msg.rules || {};
      applyRoomMeta(msg, true);   // Task E：房间/模式元数据
      state.connecting = false;
      state.reconnectAttempt = 0;
      state.reconnectTimer = null;
      clearTimeout(state.joinTimer);
      applyData(msg);
      try { ModSandbox.load(msg.mods || []); } catch (e) {}   // Task G：进房热加载 Mod
      dom.netBanner.hidden = true;
      setJoinBusy(false, '进入星域');
      if (state.mode === 'start') {
        startGame(msg.resumed);
        if (msg.resumed) toast('已恢复上次的指挥席位与星球');
      }
      else {
        toast((msg.resumed ? '已重新同步' : '已接入星域') + (me ? ' · ' + me.name : ''));
        sendPing();
      }
      var me = selfPlayer();
      if (!state.camInit) placeCamera();
      selectPlanet(me ? me.homePlanet : 0);
      state.renderedKey = null;
      renderAll();
      updateRoomUI();
      if (state.pendingSpectate && wsOpen()) { try { state.ws.send(JSON.stringify({ t: 'spectate' })); } catch (e) {} state.pendingSpectate = false; }
    } else if (msg.t === 'state') {
      state.lastStateAt = performance.now();
      if (!state.camInit) { state.camInit = true; try { fitCamera(); } catch (e) {} }
      applyData(msg);
      applyRoomMeta(msg, false);   // Task E：房间/模式/积分榜/倒计时
      if (state.selPlanet && !state.planets.has(state.selPlanet)) selectPlanet(0);
      if (state.selFleet && !state.fleets.has(state.selFleet)) selectFleet(0);
      renderAll();
      updateRoomUI();
      var meView = Array.from(state.players.values()).find(function (x) { return x.id === state.selfId; });
      if (meView && meView.eliminated && dom.elimOverlay) dom.elimOverlay.hidden = false;
    } else if (msg.t === 'ev') {
      handleEvent(msg);
    } else if (msg.t === 'reject') {
      var rejectReason = msg.reason || '命令被拒绝';
      if (/禁入|满员|已满|已开局|ticket|nojoin|无法加入|不可加入|名额/i.test(rejectReason)) {
        toast('无法加入该房间：可能已满员、已开局或处于最后 5 分钟禁入期', true);
      } else {
        toast(rejectReason, true);
      }
      sfx('deny');
    } else if (msg.t === 'ack') {
      if (msg.op === 'launch') { sfx('order'); toast('舰队已出发 · ' + msg.n + ' 艘'); }
      else if (msg.op === 'gather') { sfx('order'); toast('采集舰队已出发'); }
      else if (msg.op === 'destroy') { toast('摧毁读条开始'); }
      else if (msg.op === 'ally') { toast('社交舰队已出发'); }
    } else if (msg.t === 'pong') {
      state.ping = Math.max(1, Math.round(performance.now() - (msg.c || state.lastPingSent)));
    } else if (msg.t === 'full') {
      setJoinBusy(false, '重新接入');
      toast(msg.message || '星域已满', true);
    }
  }

  function handleEvent(msg) {
    var k = msg.k;
    var meId = state.selfId;
    try { ModSandbox.runEventHooks(msg); } catch (e) {}   // Task G：Mod 事件钩子
    if (k === 'chat') {
      addChat(msg);
      return;
    }
    if (k === 'room-settled') { showRoomSettled(msg); return; }
    if (k === 'room-list') { return; }
    if (k === 'planet-spawn') { if (msg.planet) state.planets.set(msg.planet.id, msg.planet); return; }
    if (k === 'planet-captured') {
      var isMe = msg.by === meId;
      feed('<b>' + esc(factionName(msg.by)) + '</b> 占领了『' + esc(msg.name) + '』', !isMe && msg.prev === meId);
      sfx(isMe ? 'capture' : (msg.prev === meId ? 'lost' : 'battle'));
      if (msg.by === meId) toast('占领成功：' + msg.name);
      return;
    }
    if (k === 'planet-exhausted') { feed('<b>『' + esc(msg.name) + '』</b> 资源耗竭'); if (state.planets.has(msg.planet) && state.planets.get(msg.planet).owner === meId) toast('你的星球资源耗竭：' + msg.name, true); return; }
    if (k === 'planet-destroying') { feed('<b>' + esc(factionName(msg.by)) + '</b> 开始摧毁『' + esc(msg.name) + '』'); return; }
    if (k === 'planet-destroyed') {
      feed('<b>' + (msg.by ? esc(factionName(msg.by)) : '无人') + '</b> ' + (msg.splash ? '见证『' + esc(msg.name) + '』崩解' : '摧毁了『' + esc(msg.name) + '』'), true);
      var pgone = state.planets.get(msg.planet);
      ionSplash(msg.x != null ? msg.x : (pgone ? pgone.x : 0), msg.y != null ? msg.y : (pgone ? pgone.y : 0), msg.radius || (pgone ? pgone.r : 90));
      state.planets.delete(msg.planet);
      if (dom.orderPanel && !dom.orderPanel.hidden) updateOrderPanel();
      return;
    }
    if (k === 'destroy-cancel') { feed('『' + esc(factionName(msg.planet)) + '』摧毁被打断'); return; }
    if (k === 'fleet-merge') { if (msg.owner === meId) feed('舰队并入 <b>' + esc(planetName(msg.planet)) + '</b> · ' + msg.n + ' 艘'); return; }
    if (k === 'fleet-lost') { if (msg.owner === meId) { feed('你的舰队在 <b>' + esc(planetName(msg.planet)) + '</b> 全军覆没', true); sfx('lost'); } else feed('<b>' + esc(factionName(msg.owner)) + '</b> 的舰队全军覆没'); return; }
    if (k === 'fleet-destroyed') { feed('舰队交战 · <b>' + esc(factionName(msg.owner)) + '</b> 损失 ' + msg.n + ' 艘'); sfx('battle'); return; }
    if (k === 'pact-request') {
      if (msg.to === state.selfId) {
        addMailItem('pact', msg.from,
          (msg.fromName || '其他指挥官') + ' 请求与你缔结同盟',
          '同意后双方共享同盟色彩与防线，协同作战。',
          msg.expireAt || (Date.now() + 90000), msg);
        toast('收到来自 ' + (msg.fromName || '指挥官') + ' 的结盟请求');
        sfx('pact');
      } else {
        feed('<b>' + esc(msg.fromName) + '</b> 正在寻求结盟');
      }
      return;
    }
    if (k === 'pact-declined') {
      invalidateMailItem('pact:' + msg.a, '已拒绝');
      invalidateMailItem('pact:' + msg.b, '已拒绝');
      if (msg.a === state.selfId) toast(factionName(msg.b) + ' 拒绝了你的结盟请求', true);
      return;
    }
    if (k === 'pact-formed') {
      invalidateMailItem('pact:' + msg.a, '盟约已缔结');
      invalidateMailItem('pact:' + msg.b, '盟约已缔结');
      feed('<b>' + esc(factionName(msg.a)) + '</b> 与 <b>' + esc(factionName(msg.b)) + '</b> 结盟');
      if (msg.a === meId || msg.b === meId) { toast('盟约已建立'); sfx('pact'); }
      return;
    }
    if (k === 'pact-broken') { feed('<b>' + esc(factionName(msg.a)) + '</b> 解除了与 <b>' + esc(factionName(msg.b)) + '</b> 的盟约'); return; }
    if (k === 'node-claimed') { if (msg.by === meId) { toast('采集完成 +' + msg.amount + ' 资源'); sfx('click'); } feed('<b>' + esc(msg.name) + '</b> 采集了空间资源 +' + msg.amount); return; }
    if (k === 'home') { return; }
    if (k === 'leave') { try { ModSandbox.unloadAll(); } catch (e) {} return; }
    if (k === 'respawn') {
      state.eliminatedAt = 0;
      if (dom.elimOverlay) dom.elimOverlay.hidden = true;
      toast('整备完成 · 你已作为新玩家重返星域');
      var hp = state.planets.get(msg.home);
      if (hp) { state.cam.tx = hp.x; state.cam.ty = hp.y; selectPlanet(hp.id); }
      sfx('capture');
      return;
    }
    if (k === 'planet-purified') {
      feed('<b>『' + esc(planetName(msg.planet)) + '』</b> 原阵营已被净化');
      bus.emit('planet:change', { planet: msg.planet });
      return;
    }
    if (k === 'fleet-orbit-ready') {
      bus.emit('planet:change', { planet: msg.planet });
      return;
    }
    if (k === 'trade-request') { onTradeRequest(msg); return; }
    if (k === 'trade-result') { onTradeResult(msg); return; }
    if (k === 'vote-request') { onVoteRequest(msg); return; }
    if (k === 'vote-state') { onVoteState(msg); return; }
    if (k === 'diplo-result') { onDiploResult(msg); return; }
    if (k === 'diplo-request') { onDiploRequest(msg); return; }
    if (k === 'joint-request') {
      addJointRequest(msg);
      addMailItem('joint', msg.id, (msg.fromName || '盟友') + ' 发起联合出兵',
        '请求调遣你在『' + planetName(msg.src) + '』的驻轨舰队协同出征',
        msg.deadline || (Date.now() + 15000), msg);
      return;
    }
    if (k === 'joint-state') { updateJointState(msg); return; }
    if (k === 'joint-launched') {
      removeJoint(msg.id);
      invalidateMailItem('joint:' + msg.id, '已集结出发');
      feed('联合出兵 · 舰队已从 <b>『' + esc(planetName(msg.src)) + '』</b> 出击');
      toast('联合出兵舰队已出发');
      return;
    }
    if (k === 'joint-cancelled') {
      removeJoint(msg.id);
      invalidateMailItem('joint:' + msg.id, '集结已取消');
      feed('联合出兵已取消');
      toast('联合出兵已取消', true);
      return;
    }
    if (k === 'eliminated') {
      state.eliminatedAt = performance.now();
      if (dom.elimOverlay) dom.elimOverlay.hidden = false;
      sfx('lost');
      bus.emit('player:change', msg);
      return;
    }
    if (k === 'presence' || k === 'shield-off') {
      bus.emit('player:change', msg);
      bus.emit('diplomacy:change', msg);
      return;
    }
    bus.emit('state:change', msg);
  }
  function planetName(id) {
    var p = state.planets.get(Number(id));
    return p ? p.name : '星球';
  }

  function placeCamera() {
    var me = selfPlayer();
    var hp = me ? state.planets.get(me.homePlanet) : null;
    var z = clamp(Math.max(minZoom(), 0.36), minZoom(), 0.58);
    state.cam.zoom = z;
    if (hp) { state.cam.x = hp.x; state.cam.y = hp.y; state.cam.tx = hp.x; state.cam.ty = hp.y; }
    else { state.cam.x = state.world.w / 2; state.cam.y = state.world.h / 2; state.cam.tx = state.cam.x; state.cam.ty = state.cam.y; }
    clampCam();
    state.cam.x = state.cam.tx;
    state.cam.y = state.cam.ty;
    state.camInit = true;
  }

  function openStatusDialog() {
    if (!dom.statusDialog) return;
    var rows = [];
    if (state.roomId || state.roomMode) rows.push(['房间', (state.roomName || state.roomId || '—') + ' · ' + roomModeName()]);
    if (state.roomStatus) rows.push(['房间状态', roomStatusName() + (state.noJoin ? '（禁入）' : '')]);
    if (state.roomId) rows.push(['房间编号', String(state.roomId)]);
    var __rmods = (state.roomMods || []).filter(function (m) { return m.id !== 'nebula-overdrive' && m.builtin !== true; });
    if (__rmods.length) rows.push(['模组', __rmods.map(function (m) { return m.name || m.id; }).join(' / ')]);
    if (state.spectating) rows.push(['模式', '观战中']);
    var me = selfPlayer();
    var planets = 0, ships = 0, neutral = 0;
    state.planets.forEach(function (p) { if (p.owner === state.selfId) { planets++; ships += p.troops; } else if (!p.owner) neutral++; });
    var fleets = myFleets().length;
    rows.push(['你的星球', planets + ' / ' + state.planets.size]);
    rows.push(['你的飞船', ships]);
    rows.push(['你的舰队', fleets]);
    rows.push(['中立星球', neutral]);
    rows.push(['能量', me ? Math.round(me.resource) : '-']);
    rows.push(['在线阵营', Array.from(state.players.values()).filter(function (p) { return p.online || !p.bot; }).length + ' / ' + state.players.size]);
    rows.push(['链路延迟', (state.ping || '--') + ' ms']);
    rows.push(['淘汰规则', '失去全部星球与飞船后淘汰，' + Math.round((state.rules.respawnSeconds || 30)) + ' 秒后以新玩家身份重生']);
    dom.statusBody.innerHTML = rows.map(function (r) { return '<div class="row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>'; }).join('');
    dom.statusDialog.hidden = false;
  }

  function updateElimination() {
    if (!dom.elimOverlay) return;
    var p = selfPlayer();
    if (!p || state.mode !== 'game') { dom.elimOverlay.hidden = true; return; }
    var minePlanets = 0, mineShips = 0;
    state.planets.forEach(function (pl) { if (pl.owner === state.selfId) { minePlanets++; mineShips += pl.troops; } });
    var mineFleets = 0;
    state.fleets.forEach(function (f) { if (f.owner === state.selfId) mineFleets += f.n; });
    var out = minePlanets === 0 && mineFleets === 0;
    if (out && !state.eliminatedAt) state.eliminatedAt = performance.now();
    if (!out) state.eliminatedAt = 0;
    if (!out) { dom.elimOverlay.hidden = true; return; }
    var sec = p && typeof p.respawnIn === 'number' && p.respawnIn > 0
      ? p.respawnIn
      : Math.max(0, Math.ceil(((state.rules.respawnSeconds || 30) * 1000 - (performance.now() - state.eliminatedAt)) / 1000));
    dom.elimOverlay.hidden = false;
    if (dom.elimSeconds) dom.elimSeconds.textContent = String(sec);
  }

  function startGame(resumed) {
    state.mode = 'game';
    state.camInit = false;
    dom.start.classList.add('leaving');
    setTimeout(function () { dom.start.hidden = true; }, 650);
    dom.hud.hidden = false;
    if (dom.factionPanel) dom.factionPanel.hidden = true;
    if (dom.orderPanel) dom.orderPanel.hidden = true;
    if (dom.chatPanel) {
      dom.chatPanel.hidden = false;
      state.chatCollapsed = true;
      dom.chatPanel.classList.add('collapsed');
      if (dom.chatCollapse) dom.chatCollapse.textContent = '▸';
      renderChatChannelButtons();
    }
    if (!state.stars) buildStars();
    sendPing();
    setInterval(function () { if (state.ws && wsOpen()) sendPing(); }, 5000);
    toast(resumed ? '已恢复上次的指挥席位' : '进入星域 · 已分配初始星球');
  }
  function fitCamera() {
    state.cam.zoom = minZoom();
    var me = selfPlayer();
    var home = me ? state.planets.get(me.homePlanet) : null;
    if (home) { state.cam.tx = home.x; state.cam.ty = home.y; }
    else { state.cam.tx = state.world.w / 2; state.cam.ty = state.world.h / 2; }
    clampCam();
    state.cam.x = state.cam.tx;
    state.cam.y = state.cam.ty;
  }

  /* ---------------- selection & orders ---------------- */
  function selectPlanet(id) {
    state.selPlanet = id || 0;
    state.selFleet = 0;
    state.inspectFleet = 0;
    state.panelKey = '';
    state.hexDismissed = false;                 // 重新选中星球时恢复六边形按钮显示
    if (state.infoPlanet && state.infoPlanet !== (id || 0)) closePlanetInfo();
    var pl = state.planets.get(id);
    if (pl) {
      state.sliderValue = Math.max(1, Math.floor(pl.troops));
      if (pl.owner === state.selfId) state.orderSrc = pl.id;   // sticky order source for double tap
    }
    updateOrderPanel();
    updateLists();
    updateHints();
    renderAllyBars(true);
    updateDispatchUI();
  }
  function selectFleet(id) {
    state.selFleet = id || 0;
    state.selPlanet = 0;
    state.panelKey = '';
    updateOrderPanel();
    updateHints();
  }
  function sliderCount(pl) {
    var v = clamp(Math.round(state.sliderValue || 1), 1, Math.max(1, Math.floor(pl.troops)));
    return v;
  }

  // 单击星球：己方 -> 选中；已有己方选中 -> 远征；无选中 -> 选中（敌方显示情报）
  function clickPlanet(id) {
    var pl = state.planets.get(id);
    if (!pl) return;
    if (state.selPlanet && state.selPlanet !== id) {
      var src = state.planets.get(state.selPlanet);
      if (src && src.owner === state.selfId) { orderLaunch(src.id, id); return; }
    }
    if (state.selPlanet === id && pl.owner === state.selfId) { /* already selected */ }
    selectPlanet(id);
    sfx('click');
    updateHints();
  }
  function orderLaunch(srcId, targetId) {
    var src = state.planets.get(srcId);
    var tgt = state.planets.get(targetId);
    if (!src || !tgt) return;
    if (planetShielded(tgt) && tgt.owner !== state.selfId) { toast('『' + tgt.name + '』的指挥官处于保护期', true); sfx('deny'); return; }
    // B1：一律按底部百分比滑条计算派出数量（旧数量滑杆已隐藏）
    var pct = clamp(state.dispatchPct == null ? 1 : state.dispatchPct, 0, 1);
    var available = Math.floor(src.troops);
    if (available < 1) { toast('该星球没有可派遣的驻军', true); sfx('deny'); return; }
    var n = Math.max(1, Math.round(available * pct));
    if (state.dispatchExactCount != null) {
      n = clamp(Math.round(state.dispatchExactCount), 1, available);
      pct = clamp(n / Math.max(1, available), 0, 1);
    }
    var allies = allyAllocations(srcId);   // B4：盟友滑条 >0 时走联合出兵
    var ok = false;
    if (allies.length > 0) {
      ok = sendIntent({ t: 'jointLaunch', src: srcId, target: targetId, pct: pct, allies: allies });
      if (ok) toast('联合出兵集结 · 已向盟友发出请求');
    } else {
      ok = sendIntent({ t: 'launch', src: srcId, target: targetId, n: n });
    }
    if (ok) {
      // keep the source planet selected so the next double tap launches again from it
      state.orderSrc = srcId;
      state.inspectPlanet = 0;
      state.selPlanet = srcId;
      state.selFleet = 0;
      updateOrderPanel();
      updateHints();
      if (window.innerWidth <= 560) dom.orderPanel.classList.add('collapsed');
    }
  }
  function clickFleet(id) {
    var f = state.fleets.get(id);
    if (!f) return;
    if (f.owner === state.selfId) { selectFleet(id); sfx('click'); }
    else {
      // 选中敌方舰队：显示情报，同时保留己方星球选择用于追击
      state.inspectFleet = id;
      updateOrderPanel();
      toast('敌方舰队 · ' + factionName(f.owner) + ' · ' + f.n + ' 艘');
    }
  }

  /* ---------------- panels ---------------- */
  function updateHeader() {
    var me = selfPlayer();
    if (!me) return;
    dom.selfName.textContent = me.name;
    dom.selfTag.textContent = me.bot ? 'AI 指挥官' : (me.coalition ? '联盟成员 · 能量 ' + Math.round(me.resource) : 'COMMANDER');
    dom.badge.textContent = Array.from(me.name).slice(0, 2).join('');
    dom.badge.style.color = displayColor(me.id);
    var worlds = myPlanets();
    var ships = 0;
    worlds.forEach(function (p) { ships += p.troops; });
    var fleets = myFleets();
    dom.statPlanets.textContent = worlds.length;
    dom.statShips.textContent = ships;
    dom.statFleets.textContent = fleets.length;
    dom.energyText.textContent = Math.round(me.resource);
    dom.energyBar.style.setProperty('--v', clamp(me.resource, 0, 100) + '%');
    dom.mapCoords.innerHTML = '落点 <b>X ' + Math.round(state.cam.x) + ' / Y ' + Math.round(state.cam.y) + '</b> · 缩放 ' + Math.round(state.cam.zoom * 100) + '% · 链路 ' + (state.ping || '--') + 'ms';
  }

  function updateLists() {
    var worlds = myPlanets();
    worlds.sort(function (a, b) { return b.troops - a.troops; });
    var me = selfPlayer();
    var key = worlds.map(function (p) { return p.id + ':' + p.troops + ':' + p.resource + ':' + p.resource + ':' + (p.exhausted ? 1 : 0) + ':' + (p.reinforce ? 1 : 0) + ':' + (p.destroyTimer > 0 ? 1 : 0); }).join('|') + '#' + state.selPlanet;
    if (key !== state.panelKey) {
      state.panelKey = key;
      var html = '';
      for (var i = 0; i < worlds.length; i++) {
        var p = worlds[i];
        var badges = '';
        if (p.exhausted) badges += '<span class="pbadge ex">耗竭</span>';
        if (p.destroyTimer > 0) badges += '<span class="pbadge ex">摧毁中</span>';
        if (!p.reinforce) badges += '<span class="pbadge">停止补充</span>';
        html += '<button class="planet-item' + (p.id === state.selPlanet ? ' sel' : '') + (me && me.homePlanet === p.id ? ' home' : '') + '" data-pid="' + p.id + '">' +
          '<span class="dot" style="--c:' + esc(p.color || displayColor(p.owner)) + '"></span>' +
          '<span class="pmeta"><span class="pname">' + esc(p.name) + '</span>' +
          '<span class="pstat"><b>' + p.troops + '</b>/' + p.cap + ' 飞船 · 资源 <b>' + p.resource + '</b> · ' + esc(p.size) + '</span></span>' +
          (badges || '<span class="pbadge">' + Math.round(p.troops / p.cap * 100) + '%</span>') + '</button>';
      }
      if (!worlds.length) html = '<p style="font-size:10px;color:#6b8a93;margin:4px 0">你还没有星球。等待重生或与盟友协调。</p>';
      dom.planetList.innerHTML = html;
      dom.myWorldsCount.textContent = worlds.length + ' 座';
    }
    // faction list
    var rows = [];
    state.players.forEach(function (p) {
      var count = 0;
      state.planets.forEach(function (pl) { if (pl.owner === p.id) count++; });
      rows.push({ p: p, count: count });
    });
    rows.sort(function (a, b) { return b.count - a.count; });
    var me2 = selfPlayer();
    var fh = '';
    rows.forEach(function (r) {
      var cls = r.p.id === state.selfId ? ' me' : (me2 && r.p.coalition && r.p.coalition === me2.coalition ? ' ally' : '');
      fh += '<button class="faction-row' + cls + '" data-fid="' + r.p.id + '" style="background:none;border:0;border-bottom:1px solid rgba(110,247,255,.06);text-align:left">' +
        '<span class="fdot" style="--c:' + esc(displayColor(r.p.id)) + '"></span>' +
        '<span class="fname">' + esc(r.p.name) + (r.p.bot ? ' · AI' : '') + (r.p.online ? '' : ' · 离线') + '</span>' +
        '<span class="fnum">' + r.count + ' 星</span></button>';
    });
    dom.factionList.innerHTML = fh;
    dom.factionCount.textContent = rows.length + ' / ' + ((state.rules.maxPlayers) || 8);
  }

  function planetById(id) { return state.planets.get(id); }

  function updateOrderPanel() {
    var selPl = planetById(state.selPlanet);
    if (dom.dispatchDock) {
      var canDispatch = !!(selPl && ((selPl.owner === state.selfId && Math.floor(selPl.troops) >= 1) || (selPl.orbitBy && selPl.orbitBy[state.selfId] >= 1)));
      dom.dispatchDock.hidden = !canDispatch;
    }
    if (state.factionView < 0) return; // 建立停泊点选址模式借用 orderPanel
    if (state.selFleet) { renderFleetPanel(state.fleets.get(state.selFleet)); return; }
    if (state.inspectFleet && state.fleets.has(state.inspectFleet) && !state.selPlanet) { renderFleetPanel(state.fleets.get(state.inspectFleet), true); return; }
    // 彻底去除左下角/侧边冗余的星球信息面板，星球信息仅由右侧六边形图标①浮窗显示
    if (dom.orderPanel) dom.orderPanel.hidden = true;
    return;
    dom.opKicker.textContent = pl.owner === state.selfId ? 'YOUR WORLD · 己方星球' : (isAlly(pl.owner) ? 'ALLY WORLD · 盟友星球' : (pl.owner ? 'HOSTILE WORLD · 敌方星球' : 'NEUTRAL WORLD · 中立星球'));
    dom.opTitle.textContent = pl.name;
    var ownerName = pl.owner ? factionName(pl.owner) : '中立';
    var tags = '<span class="tag ' + (pl.owner === state.selfId ? 'own' : pl.owner ? 'ex' : '') + '">' + esc(ownerName) + '</span>' +
      '<span class="tag">' + (pl.size === 'L' ? '大型' : pl.size === 'M' ? '中型' : '小型') + '世界</span>' +
      '<span class="tag">载船上限 ' + pl.cap + '</span>';
    if (pl.exhausted) tags += '<span class="tag warn">资源耗竭</span>';
    if (pl.invuln) tags += '<span class="tag warn">保护期</span>';
    if (pl.destroyTimer > 0) tags += '<span class="tag warn">摧毁读条</span>';
    if (!pl.reinforce && pl.owner) tags += '<span class="tag warn">停止补充</span>';
    dom.opTags.innerHTML = tags;
    dom.opStats.innerHTML =
      '<div class="stat"><span>驻军飞船</span><b>' + pl.troops + ' <small>/ ' + pl.cap + '</small></b></div>' +
      '<div class="stat"><span>星球矿藏</span><b>' + Math.round(pl.resource) + '</b></div>' +
      '<div class="stat"><span>阵营化</span><b>' + (pl.owner ? Math.round((pl.purityProg == null ? 1 : pl.purityProg) * 100) : 0) + '%</b></div>' +
      '<div class="stat"><span>补充速率</span><b>' + (pl.reinforce && pl.owner && !pl.exhausted ? '+1 <small>/秒</small>' : '—') + '</b></div>';
    dom.opBars.innerHTML =
      '<div class="bar-row"><span>驻军</span><div class="bar"><i style="width:' + clamp(pl.troops / pl.cap * 100, 0, 100) + '%"></i></div><span>' + Math.floor(pl.troops) + '/' + pl.cap + '</span></div>' +
      '<div class="bar-row"><span>矿藏</span><div class="bar res"><i style="width:' + clamp(pl.resource / Math.max(1, pl.maxResource || 180) * 100, 0, 100) + '%"></i></div><span>' + Math.round(pl.resource) + '</span></div>' +
      (pl.captureProg > 0.005 ? '<div class="bar-row"><span>占领</span><div class="bar en"><i style="width:' + clamp(pl.captureProg * 100, 0, 100) + '%"></i></div><span>' + Math.round(pl.captureProg * 100) + '%</span></div>' : '');
    var mine = pl.owner === state.selfId;
    dom.sliderBlock.hidden = true;   // B1：旧的按数量滑条由底部百分比派遣滑条取代（协议允许隐藏）
    if (mine) {
      var max = Math.max(1, Math.floor(pl.troops));
      if (state.sliderValue > max) state.sliderValue = max;
      if (state.sliderValue < 1) state.sliderValue = 1;
      dom.slider.min = 1;
      dom.slider.max = max;
      dom.slider.disabled = max <= 1;
      dom.slider.value = String(sliderCount(pl));
      dom.sliderLabel.textContent = '远征派遣数量（点选目标星球）';
      dom.sliderValue.textContent = sliderCount(pl) + ' / ' + Math.floor(pl.troops);
    }
    // no action buttons: everything is done by selecting a world and double-tapping a target
    dom.opActions.innerHTML = '';
    if (mine) {
      dom.opNote.textContent = pl.exhausted
        ? '资源已耗竭：驻扎消耗能量，能量见底驻军会流失；无驻军时 20 秒后崩解。'
        : '拖动底部百分比滑条决定派出比例，双击其它星球即可出征。';
    } else {
      dom.opNote.textContent = isAlly(pl.owner)
        ? '盟友星球：双击可从你的星球派兵增援（不会开战）。'
        : (pl.owner ? '敌方星球：双击派舰队，打光守军后再走占领读条。' : '中立星球：双击派舰队，抵达后开始占领读条。');
    }
    // progress
    dom.opProgress.hidden = !(pl.destroyTimer > 0);
    dom.opProgress.hidden = !(pl.destroyTimer > 0);
    if (pl.destroyTimer > 0) {
      var totalD = (state.rules.destroyTime) || 8;
      dom.opProgress.hidden = false;
      dom.opProgressText.textContent = '摧毁 ' + pl.destroyTimer.toFixed(1) + 's';
      dom.opProgressBar.style.width = clamp((1 - pl.destroyTimer / totalD) * 100, 0, 100) + '%';
    } else if (dom.opProgress) {
      dom.opProgress.hidden = true;
    }
    // B3/B1：同步盟友滑条与百分比派遣显示；信息浮窗实时刷新
    renderAllyBars();
    updateDispatchUI();
    refreshPlanetInfoIfOpen();
  }

  function renderFleetPanel(f, enemy) {
    if (!f) { dom.orderPanel.hidden = true; return; }
    dom.orderPanel.hidden = false;
    dom.opKicker.textContent = enemy ? 'HOSTILE FLEET · 敌方舰队' : 'FLEET · 你的舰队';
    dom.opTitle.textContent = '舰队 #' + f.id;
    dom.opTags.innerHTML = '<span class="tag ' + (enemy ? 'ex' : 'own') + '">' + esc(factionName(f.owner)) + '</span>' +
      '<span class="tag">' + (f.kind === 'gather' ? '采集任务' : f.kind === 'social' ? '外交任务' : '远征中') + '</span>';
    dom.opStats.innerHTML =
      '<div class="stat"><span>飞船数量</span><b>' + f.n + ' <small>艘</small></b></div>' +
      '<div class="stat"><span>目标</span><b>' + (f.target ? esc(planetName(f.target)) : (f.node ? '资源点' : '—')) + '</b></div>';
    dom.opBars.innerHTML = '';
    dom.sliderBlock.hidden = true;
    dom.opActions.innerHTML = enemy ? '' : '<button class="btn wide" data-act="recall">取消选择</button>';
    dom.opNote.textContent = enemy ? '敌方舰队会与你的舰队交战。' : '舰队抵达己方星球会自动并入驻军；抵达敌方星球会发起攻击。';
    dom.opProgress.hidden = true;
  }

  function updateHints() {
    var step = 1, text = '';
    if (state.selFleet) { step = 3; text = '舰队正在飞行 · 抵达后自动并入或交战'; }
    else if (state.selPlanet) {
      var pl = planetById(state.selPlanet);
      if (pl && pl.owner === state.selfId) { var _p = clamp(state.dispatchPct, 0, 1); var _n = Math.max(1, Math.round(Math.floor(pl.troops) * _p)); var _joint = allyAllocations(pl.id).length > 0; step = 2; text = '再点击目标星球，按 <b>' + Math.round(_p * 100) + '%</b>（约 <b>' + _n + '</b> 艘）' + (_joint ? ' · <b>联合出兵</b>' : '') + '出征'; }
      else { step = 1; text = '这是<b>' + esc(pl ? factionName(pl.owner) : '中立') + '</b>的星球 · 选中自己的星球后可出征'; }
    } else { step = 1; text = '先选中你自己的星球，再点击目标星球下达远征命令'; }
    dom.hintStep.textContent = '0' + step;
    dom.hintText.innerHTML = text;
    dom.modeTag.textContent = state.connected ? '在线' : '离线';
    dom.modeTag.classList.toggle('busy', !state.connected || (!state.joined));
  }

  function renderAll() {
    if (state.dataKey !== state.renderedKey) { state.renderedKey = state.dataKey; state.panelKey = ''; }
    updateHeader();
    updateLists();
    updateOrderPanel();
    updateHints();
  }

  function planetActionHandler(e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      var act = btn.getAttribute('data-act');
      var pl = planetById(state.selPlanet);
      var f = state.fleets.get(state.selFleet);
      if (act === 'launch' || act === 'sendall') {
        if (!pl) return;
        if (act === 'sendall') state.sliderValue = Math.max(1, Math.floor(pl.troops));
        updateOrderPanel();
        toast('已确认数量 · 点击目标星球');
        state.awaitTarget = true;
      } else if (act === 'reinforce') {
        if (pl) sendIntent({ t: 'reinforce', id: pl.id, on: !pl.reinforce });
      } else if (act === 'merge') {
        if (!pl) return;
        state.mergeTarget = pl.id;
        toast('请选择要并入的己方星球');
      } else if (act === 'merge-note') {
        toast('选中自己的星球后再点这里的目标即可合并');
      } else if (act === 'destroy') {
        if (pl) destroyPlanet(pl);
      } else if (act === 'attack') {
        toast('先在左侧选中自己的星球，再点击此星球出征');
      } else if (act === 'recall') {
        selectFleet(0);
      }
      sfx('click');
  }
  function bindPanelActions() {
    dom.opActions.addEventListener('click', planetActionHandler);
    dom.slider.addEventListener('input', function () {
      state.sliderValue = Number(dom.slider.value) || 1;
      var pl = planetById(state.selPlanet);
      if (pl) { dom.sliderValue.textContent = sliderCount(pl) + ' / ' + Math.floor(pl.troops); }
      updateHints();
    });
    dom.planetList.addEventListener('click', function (e) {
      var item = e.target.closest('[data-pid]');
      if (!item) return;
      var id = Number(item.getAttribute('data-pid'));
      var pl = planetById(id);
      if (state.mergeTarget) {
        var target = state.mergeTarget; state.mergeTarget = 0;
        if (target !== id) sendIntent({ t: 'merge', a: id, b: target });
        return;
      }
      if (state.selPlanet && state.selPlanet !== id) { orderLaunch(state.selPlanet, id); return; }
      selectPlanet(id);
      focusPlanet(id);
    });
    dom.factionList.addEventListener('click', function (e) {
      var row = e.target.closest('[data-fid]');
      if (!row) return;
      var id = Number(row.getAttribute('data-fid'));
      var targetPlayer = state.players.get(id);
      if (!targetPlayer) return;
      var home = state.planets.get(targetPlayer.homePlanet);
      if (home) focusPlanet(home.id);
      if (id === state.selfId) { toast('已定位至你的主星'); return; }
      // 直接打开七态外交面板（旧的 openFactionPanel 会被 updateOrderPanel 立即隐藏）
      var anchorPl = home || Array.from(state.planets.values()).find(function (p) { return p.owner === id; });
      if (anchorPl) openDiploPanel(anchorPl);
      else openDiploPanel({ id: 0, owner: id, name: targetPlayer.name });
    });
    dom.tabPlanets.addEventListener('click', function () { dom.tabPlanets.classList.add('on'); dom.tabFactions.classList.remove('on'); dom.planetsView.hidden = false; dom.factionsView.hidden = true; });
    dom.tabFactions.addEventListener('click', function () { dom.tabFactions.classList.add('on'); dom.tabPlanets.classList.remove('on'); dom.factionsView.hidden = false; dom.planetsView.hidden = true; });
    if (dom.opChevron) dom.opChevron.addEventListener('click', function () { dom.orderPanel.classList.toggle('collapsed'); });
    function autoCollapse() { if (window.innerWidth <= 560) dom.orderPanel.classList.add('collapsed'); }
    dom.opClose.addEventListener('click', function () { state.factionView = 0; state.selPlanet = 0; state.selFleet = 0; state.inspectPlanet = 0; dom.orderPanel.hidden = true; updateLists(); updateHints(); });
  }

  function openFactionPanel(id) {
    var p = state.players.get(id);
    if (!p) return;
    var me = selfPlayer();
    if (!me) return;
    dom.orderPanel.hidden = false;
    dom.opKicker.textContent = 'FACTION · 阵营';
    dom.opTitle.textContent = p.name;
    dom.opTags.innerHTML = '<span class="tag ' + (p.id === me.id ? 'own' : '') + '">' + (p.bot ? 'AI 指挥官' : '人类指挥官') + '</span>' +
      (p.online ? '<span class="tag">在线</span>' : '<span class="tag warn">离线</span>') +
      (p.coalition ? '<span class="tag own">联盟 ' + p.coalition + '</span>' : '');
    dom.opStats.innerHTML =
      '<div class="stat"><span>星球</span><b>' + countPlanets(p.id) + '</b></div>' +
      '<div class="stat"><span>飞船</span><b>' + countShips(p.id) + '</b></div>' +
      '<div class="stat"><span>能量</span><b>' + Math.round(p.resource) + '</b></div>' +
      '<div class="stat"><span>盟约</span><b>' + (p.coalition ? '结盟中' : '—') + '</b></div>';
    dom.opBars.innerHTML = '';
    dom.sliderBlock.hidden = true;
    dom.opProgress.hidden = true;
    var allied = me.coalition && p.coalition === me.coalition;
    var actions = '';
    if (p.id !== me.id) {
      actions += '<button class="btn primary" data-act="ally" ' + (allied || me.coalition || me.resource < (state.rules.socialCost || 40) ? 'disabled' : '') + '>派出社交舰队结盟（' + (state.rules.socialCost || 40) + ' 能量）</button>';
      if (allied) actions += '<button class="btn danger wide" data-act="breakpact">解除盟约</button>';
    } else {
      actions += '<button class="btn wide" data-act="recall">返回地图</button>';
    }
    dom.opActions.innerHTML = actions;
    dom.opNote.textContent = '社交舰队需要从你的主星出发，抵达对方主星后立即结盟。结盟后双方星球与飞船统一颜色；解除后可重新独立。';
    var handler = function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn || btn.disabled) return;
      var act = btn.getAttribute('data-act');
      if (act === 'ally') sendIntent({ t: 'ally', id: p.id });
      if (act === 'breakpact') sendIntent({ t: 'breakpact', id: p.id });
      if (act === 'recall') { dom.orderPanel.hidden = true; }
    };
    dom.opActions.onclick = handler;
  }
  function countPlanets(id) { var n = 0; state.planets.forEach(function (p) { if (p.owner === id) n++; }); return n; }
  function countShips(id) { var n = 0; state.planets.forEach(function (p) { if (p.owner === id) n += p.troops; }); state.fleets.forEach(function (f) { if (f.owner === id) n += f.n; }); return n; }

  // selecting a world only pans the camera; it never changes the zoom level
  function focusPlanet(id) {
    var pl = state.planets.get(id);
    if (!pl) return;
    state.cam.tx = pl.x;
    state.cam.ty = pl.y;
  }

  /* ---------------- rendering ---------------- */
  function resize() {
    // the stage is sized by CSS (100%); only the backing store needs updating here
    var __q = state.settings && state.settings.quality;
    var __maxDpr = __q === 'smooth' ? 1 : (__q === 'high' ? 2 : 1.5);
    var dpr = Math.min(window.devicePixelRatio || 1, __maxDpr);
    state.dpr = dpr;
    var w = viewW(), h = viewH();
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  // The camera never drops below ~8 planets per screen (or one padded world if the display is short).
  function minZoom() {
    var w = viewW(), h = viewH();
    var zFull = Math.min(w / (state.world.w + 160), h / (state.world.h + 160));
    // 平均一颗星球占 1900x1320 的星域，一屏约 8 颗 -> 按面积反推最小缩放；
    // 但永远不允许缩到"整张星图"（zFull）以下，那样星球会变成小点。
    var zEight = Math.sqrt((w * h) / (8 * 1900 * 1320));
    var zMin = Math.max(zEight, zFull * 1.0);
    return Math.min(1.0, zMin);
  }
  function clampCam() {
    var w = viewW(), h = viewH();
    state.cam.zoom = clamp(state.cam.zoom, Math.max(minZoom(), 0.02), 1.8);
    var vw = w / state.cam.zoom, vh = h / state.cam.zoom;
    if (vw >= state.world.w + 160) state.cam.tx = state.world.w / 2;
    else state.cam.tx = clamp(state.cam.tx, vw / 2 - 80, state.world.w - vw / 2 + 80);
    if (vh >= state.world.h + 160) state.cam.ty = state.world.h / 2;
    else state.cam.ty = clamp(state.cam.ty, vh / 2 - 80, state.world.h - vh / 2 + 80);
  }

  function updateCamera(dt) {
    clampCam();
    var k = 1 - Math.exp(-7 * dt);
    state.cam.x += (state.cam.tx - state.cam.x) * k;
    state.cam.y += (state.cam.ty - state.cam.y) * k;
  }

  /* ================= Stage 5 · I1/I2：贴图与全景演武 ================= */
  var ASSET_SRC = {
    nebula_deep_1: '/assets/nebula_deep_1.webp', nebula_deep_2: '/assets/nebula_deep_2.webp',
    planet_terran: '/assets/planet_terran.webp', planet_gas: '/assets/planet_gas.webp',
    planet_storm: '/assets/planet_storm.webp', planet_lava: '/assets/planet_lava.webp',
    planet_clouds: '/assets/planet_clouds.webp'
  };
  var assets = {}; var iceTex = null;
  function loadAssets() {
    if (state.assetsLoaded) return; state.assetsLoaded = true;
    Object.keys(ASSET_SRC).forEach(function (k) {
      try {
        if (typeof Image === 'undefined') return;
        var im = new Image();
        im.onload = function () { assets[k] = im; };
        im.onerror = function () { assets[k] = null; };
        im.src = ASSET_SRC[k];
      } catch (e) {}
    });
  }
  function asset(k) { return assets[k] || null; }
  function getIceTexture() {
    if (iceTex) return iceTex;
    var lava = asset('planet_lava'); if (!lava) return null;
    try {
      var c = document.createElement('canvas'); c.width = 256; c.height = 128;
      var g = c.getContext('2d'); if (g.filter !== undefined) g.filter = 'hue-rotate(185deg)';
      g.drawImage(lava, 0, 0, 256, 128); iceTex = c; return c;
    } catch (e) { return null; }
  }
  function terrainOf(pl) { if (!pl) return 'terran'; if (pl.isOutpost) return 'outpost'; if (pl.exhausted) return 'lava'; return ['terran', 'gas', 'lava', 'ice', 'storm'][((pl.id % 5) + 5) % 5]; }
  function terrainColor(th) { return { terran: '#5eead4', gas: '#fbbf24', lava: '#fb7185', ice: '#93c5fd', storm: '#818cf8' }[th] || '#9aa7b0'; }
  function planetTextureFor(pl, th) {
    if (th === 'ice') return getIceTexture();
    var m = { terran: 'planet_terran', gas: 'planet_gas', lava: 'planet_lava', storm: 'planet_storm' };
    return asset(m[th]);
  }
  function drawPlanetRing(r, pl, t, back) {
    if (state.settings.planetRings === false) return;
    ctx.save(); ctx.rotate(-0.38);
    ctx.strokeStyle = 'rgba(200,230,255,0.35)'; ctx.lineWidth = Math.max(2, r * 0.06);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.55, r * 0.5, 0, back ? Math.PI : 0, back ? TAU : Math.PI); ctx.stroke();
    ctx.strokeStyle = 'rgba(150,200,255,0.18)'; ctx.lineWidth = Math.max(1, r * 0.03);
    ctx.beginPath(); ctx.ellipse(0, 0, r * 1.75, r * 0.58, 0, back ? Math.PI : 0, back ? TAU : Math.PI); ctx.stroke();
    ctx.restore();
  }
  function drawTexturedPlanet(pl, t, th) {
    if (state.settings.planetRotate === false) t = 0;
    var tint = pl.owner ? (pl.color || displayColor(pl.owner)) : terrainColor(th);
    var strip = getTintedPlanetStrip(th, tint);
    if (!strip) return false;
    var shade = getSphereShadeCanvas(pl.r, tint);
    var r = pl.r, pid = pl.id, dir = (pid % 2 ? 1 : -1), hasRing = (pl.size === 'L' || pid % 5 === 4 || pid % 5 === 1);
    try {
      // 单次 drawImage（双倍宽无缝长条按源坐标滚动）
      var sx = Math.floor((((t * 15 * dir + pid * 97) % 512) + 512) % 512);
      ctx.save(); ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.clip();
      ctx.drawImage(strip, sx, 0, 512, 256, -r, -r, r * 2, r * 2);
      var clouds = (th === 'terran' || th === 'lava' || th === 'ice') ? getCloudStrip() : null;
      if (clouds) {
        var cs = Math.floor((((t * 22 * dir + pid * 53) % 512) + 512) % 512);
        ctx.globalAlpha = 0.55; ctx.globalCompositeOperation = 'screen';
        ctx.drawImage(clouds, cs, 0, 512, 256, -r, -r, r * 2, r * 2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      ctx.restore();
      if (shade && shade.canvas) ctx.drawImage(shade.canvas, -shade.size / 2, -shade.size / 2);
      if (hasRing) drawPlanetRing(r, pl, t, false);
      return true;
    } catch (e) { return false; }
  }
  function initDemoScene() {
    var cx = state.world.w * 0.5, cy = state.world.h * 0.5, planets = [];
    for (var i = 0; i < 7; i++) {
      var ang = i / 7 * TAU, rad = 700 + (i % 3) * 220, id = i;
      var p = {
        id: id, owner: 0, color: '', name: 'DEMO-' + (i + 1),
        x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad * 0.62,
        r: id % 5 === 4 ? 120 : (id % 5 === 1 ? 95 : 88), cap: 200,
        troops: 10 + (i * 7) % 20, resource: 120, maxResource: 180,
        purityProg: 1, captureProg: 0, destroyTimer: 0, size: id % 5 === 4 ? 'L' : 'M',
        isOutpost: false, orbitBy: {}, reinforce: true, exhausted: false, _demo: true,
        _orbitCount: 8 + (i * 5) % 17
      };
      planets.push(p);
    }
    state.demoScene = { planets: planets, fleets: [], nextFleetAt: performance.now() + 2200, initialized: true };
  }
  function demoFleetSpawn() {
    var ds = state.demoScene; if (!ds || ds.planets.length < 2) return;
    var a = ds.planets[Math.floor(Math.random() * ds.planets.length)];
    var b = ds.planets[Math.floor(Math.random() * ds.planets.length)];
    if (a === b) return;
    ds.fleets.push({ a: a, b: b, born: performance.now(), dur: 2200 + Math.random() * 1200, n: 6 + Math.floor(Math.random() * 10) });
    if (ds.fleets.length > 10) ds.fleets.shift();
  }
  function drawDemoFleet(f, now) {
    var pr = clamp((now - f.born) / f.dur, 0, 1);
    var x = f.a.x + (f.b.x - f.a.x) * pr, y = f.a.y + (f.b.y - f.a.y) * pr;
    var ang = Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.strokeStyle = 'rgba(120,240,255,0.18)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-f.n * 3, 0); ctx.lineTo(0, 0); ctx.stroke();
    for (var i = 0; i < Math.min(8, f.n); i++) { ctx.fillStyle = 'rgba(180,255,255,0.85)'; ctx.beginPath(); ctx.arc(-i * 4, (i % 2 ? 1 : -1) * 2, 1.6, 0, TAU); ctx.fill(); }
    ctx.restore();
  }
  function drawDemoOrbitShips(p, t) {
    var n = p._orbitCount || 10, rr = p.r * 1.45;
    for (var i = 0; i < n; i++) {
      var a = t * 0.6 + i * TAU / n;
      ctx.fillStyle = 'rgba(180,245,255,' + (0.5 + 0.4 * Math.sin(t * 2 + i)).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr * 0.34, 1.6, 0, TAU); ctx.fill();
    }
  }
  function drawHeroRing(hx, hy, hr, t, back) {
    if (state.settings.planetRings === false) return;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(18 * Math.PI / 180);
    ctx.strokeStyle = back ? 'rgba(150,200,255,0.18)' : 'rgba(180,235,255,0.4)';
    ctx.lineWidth = Math.max(3, hr * 0.02);
    ctx.beginPath(); ctx.ellipse(0, 0, hr * 1.35, hr * 0.34, 0, back ? Math.PI : 0, back ? TAU : Math.PI); ctx.stroke();
    ctx.strokeStyle = back ? 'rgba(120,180,255,0.10)' : 'rgba(140,210,255,0.22)';
    ctx.lineWidth = Math.max(2, hr * 0.012);
    ctx.beginPath(); ctx.ellipse(0, 0, hr * 1.5, hr * 0.4, 0, back ? Math.PI : 0, back ? TAU : Math.PI); ctx.stroke();
    ctx.restore();
  }
  function heroOrbitPoint(hx, hy, hr, rMul, tiltRad, ang) {
    var ex = Math.cos(ang) * hr * rMul;
    var ey = Math.sin(ang) * hr * rMul * 0.34;
    var c = Math.cos(tiltRad), s = Math.sin(tiltRad);
    return { x: hx + ex * c - ey * s, y: hy + ex * s + ey * c };
  }
  function drawHeroShipSprite(shipClass, sc, depth) {
    var texKey = shipClass === 'flagship' ? 'ship_flagship' : (shipClass === 'cruiser' ? 'ship_cruiser' : (shipClass === 'interceptor' ? 'ship_interceptor' : 'ship_fighter'));
    var tex = asset(texKey);
    var sz = (shipClass === 'flagship' ? 46 : (shipClass === 'cruiser' ? 34 : (shipClass === 'interceptor' ? 28 : 22))) * sc;
    if (state.settings.engineTrails !== false) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var thrX = -sz * 0.38, thrR = sz * 0.34;
      try {
        var eg = ctx.createRadialGradient(thrX, 0, 0, thrX, 0, thrR);
        eg.addColorStop(0, 'rgba(235,255,255,0.95)');
        eg.addColorStop(0.4, 'rgba(80,225,255,0.65)');
        eg.addColorStop(1, 'rgba(20,120,200,0)');
        ctx.fillStyle = eg; ctx.beginPath(); ctx.arc(thrX, 0, thrR, 0, TAU); ctx.fill();
      } catch (e) {}
      ctx.restore();
    }
    if (tex) {
      ctx.save();
      ctx.globalAlpha = 0.72 + 0.28 * depth;
      ctx.rotate(Math.PI * 0.5);
      try { ctx.drawImage(tex, -sz * 0.5, -sz * 0.5, sz, sz); } catch (e) {}
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.scale(sc, sc);
    ctx.fillStyle = 'rgba(14,38,60,0.92)';
    ctx.strokeStyle = 'rgba(130,245,255,0.92)';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-5, -5.5); ctx.lineTo(-3, 0); ctx.lineTo(-5, 5.5); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  function initHeroShips() {
    if (state.heroShips && state.heroShips.version === 3) return state.heroShips;
    var classes = ['flagship', 'interceptor', 'fighter', 'cruiser', 'fighter', 'interceptor', 'fighter', 'flagship', 'cruiser', 'fighter', 'interceptor', 'fighter'];
    var list = [];
    for (var i = 0; i < classes.length; i++) {
      var sc = classes[i];
      var dir = (i % 2 === 0) ? 1 : -1;
      var baseSp = sc === 'flagship' ? 0.052 : (sc === 'cruiser' ? 0.072 : (sc === 'interceptor' ? 0.095 : 0.115));
      list.push({
        kind: 0, shipClass: sc,
        phase: (i / classes.length) * TAU + i * 0.37,
        r: 1.30 + (i % 4) * 0.065,
        tilt: (18 + (i % 3 - 1) * 2.0) * Math.PI / 180,
        sp: baseSp * dir
      });
    }
    for (var j = 0; j < 3; j++) {
      list.push({
        kind: 1,
        shipClass: j === 0 ? 'flagship' : (j === 1 ? 'cruiser' : 'interceptor'),
        phase: j * 2.1,
        speed: 0.038 + j * 0.01,
        yBias: -0.25 + j * 0.25
      });
    }
    state.heroShips = list;
    state.heroShips.version = 3;
    return list;
  }
  function drawHeroShips(hx, hy, hr, t, backPass) {
    initHeroShips();
    var rotOn = state.settings.planetRotate !== false;
    var simT = rotOn ? t : 12.0;
    var hs = state.heroShips;
    for (var i = 0; i < hs.length; i++) {
      var s = hs[i];
      if (s.kind === 0) {
        var ang = simT * s.sp + s.phase;
        var sinA = Math.sin(ang);
        var isBack = sinA < 0;
        if (!!backPass !== isBack) continue;
        var dir = s.sp >= 0 ? 1 : -1;
        var pt = heroOrbitPoint(hx, hy, hr, s.r, s.tilt, ang);
        var dex = -Math.sin(ang) * hr * s.r * dir;
        var dey = Math.cos(ang) * hr * s.r * 0.34 * dir;
        var ct = Math.cos(s.tilt), st = Math.sin(s.tilt);
        var heading = Math.atan2(dex * st + dey * ct, dex * ct - dey * st);
        var depth = 0.5 + 0.5 * sinA;
        var sc = 0.72 + 0.58 * depth;
        if (state.settings.engineTrails !== false) {
          var tailArc = (s.shipClass === 'flagship' ? 0.24 : 0.18) * dir;
          var tailStart = heroOrbitPoint(hx, hy, hr, s.r, s.tilt, ang - tailArc);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          try {
            var tg = ctx.createLinearGradient(pt.x, pt.y, tailStart.x, tailStart.y);
            tg.addColorStop(0, 'rgba(195,255,255,' + (0.28 + 0.42 * depth).toFixed(2) + ')');
            tg.addColorStop(0.45, 'rgba(70,220,255,' + (0.12 + 0.20 * depth).toFixed(2) + ')');
            tg.addColorStop(1, 'rgba(20,140,220,0)');
            ctx.strokeStyle = tg;
            ctx.lineWidth = (s.shipClass === 'flagship' ? 3.2 : 2.0) * sc;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
            for (var k = 1; k <= 6; k++) {
              var hp = heroOrbitPoint(hx, hy, hr, s.r, s.tilt, ang - (tailArc * k / 6));
              ctx.lineTo(hp.x, hp.y);
            }
            ctx.stroke();
          } catch (e) {}
          ctx.restore();
        }
        ctx.save(); ctx.translate(pt.x, pt.y); ctx.rotate(heading);
        drawHeroShipSprite(s.shipClass, sc, depth);
        ctx.restore();
      } else if (!backPass) {
        var u = (simT * s.speed + s.phase) % 1;
        var x0 = hx + hr * 0.55, y0 = hy + s.yBias * hr * 0.95;
        var x1 = hx + hr * 2.55, y1 = hy + (s.yBias - 0.18) * hr * 0.85;
        var cx = x0 + (x1 - x0) * u;
        var cy = y0 + (y1 - y0) * u - Math.sin(u * Math.PI) * (hr * 0.12);
        var dx = x1 - x0, dy = (y1 - y0) - Math.cos(u * Math.PI) * Math.PI * (hr * 0.12);
        var ang2 = Math.atan2(dy, dx);
        var fade = Math.sin(u * Math.PI);
        if (fade < 0.08) continue;
        var sc2 = 0.85 + 0.28 * fade;
        if (state.settings.engineTrails !== false) {
          var tailLen = 56 * sc2;
          var tx = cx - Math.cos(ang2) * tailLen, ty = cy - Math.sin(ang2) * tailLen;
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          try {
            var dg = ctx.createLinearGradient(cx, cy, tx, ty);
            dg.addColorStop(0, 'rgba(200,255,255,' + (0.60 * fade).toFixed(2) + ')');
            dg.addColorStop(1, 'rgba(20,120,200,0)');
            ctx.strokeStyle = dg;
            ctx.lineWidth = 2.4 * sc2;
            ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
          } catch (e) {}
          ctx.restore();
        }
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang2);
        drawHeroShipSprite(s.shipClass, sc2, fade);
        ctx.restore();
      }
    }
  }
  function drawHeroPlanet(hx, hy, hr, t, easePan) {
    var rotT = state.settings.planetRotate !== false ? t : 0;
    var camShift = (easePan || 0) * 115; // 镜头偏航时球面经度同步视差滚动
    if (state.settings.planetRings !== false) {
      try {
        var glow = ctx.createRadialGradient(hx, hy, hr * 0.9, hx, hy, hr * 1.18);
        glow.addColorStop(0, 'rgba(70,235,255,0.28)'); glow.addColorStop(0.6, 'rgba(40,140,180,0.12)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(hx, hy, hr * 1.18, 0, TAU); ctx.fill();
      } catch (e) {}
    }
    drawHeroRing(hx, hy, hr, rotT, true);
    drawHeroShips(hx, hy, hr, t, true);
    ctx.save(); ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.clip();
    var strip = getTintedPlanetStrip('terran', null), clouds = getCloudStrip();
    if (strip) {
      var sx = Math.floor(((rotT * 6 + camShift) % 512 + 512) % 512);
      try { ctx.drawImage(strip, sx, 0, 512, 256, hx - hr, hy - hr, hr * 2, hr * 2); } catch (e) {}
      if (clouds) {
        var cs = Math.floor((((state.settings.planetRotate !== false ? rotT * 9.5 : 0) + camShift * 1.25) % 512 + 512) % 512);
        ctx.globalAlpha = 0.52; ctx.globalCompositeOperation = 'screen';
        try { ctx.drawImage(clouds, cs, 0, 512, 256, hx - hr, hy - hr, hr * 2, hr * 2); } catch (e) {}
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
    } else {
      var g = ctx.createRadialGradient(hx - hr * 0.35, hy - hr * 0.35, hr * 0.1, hx, hy, hr * 1.1);
      g.addColorStop(0, '#7fe9d9'); g.addColorStop(0.45, '#2b8f86'); g.addColorStop(0.8, '#0d2a33'); g.addColorStop(1, '#040a12');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
    }
    try {
      var hi = ctx.createRadialGradient(hx - hr * 0.35, hy - hr * 0.35, 0, hx - hr * 0.3, hy - hr * 0.3, hr * 0.9);
      hi.addColorStop(0, 'rgba(255,255,255,0.32)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hi; ctx.beginPath(); ctx.arc(hx, hy, hr, 0, TAU); ctx.fill();
      var sh = ctx.createRadialGradient(hx + hr * 0.5, hy + hr * 0.55, hr * 0.1, hx + hr * 0.45, hy + hr * 0.5, hr * 1.4);
      sh.addColorStop(0, 'rgba(2,6,15,0.72)'); sh.addColorStop(0.7, 'rgba(2,6,15,0.22)'); sh.addColorStop(1, 'rgba(2,6,15,0)');
      ctx.fillStyle = sh; ctx.fillRect(hx - hr, hy - hr, hr * 2, hr * 2);
    } catch (e) {}
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,240,255,0.85)'; ctx.lineWidth = Math.max(2, hr * 0.006);
    ctx.beginPath(); ctx.arc(hx, hy, hr - 1, 0, TAU); ctx.stroke();
    drawHeroRing(hx, hy, hr, rotT, false);
  }
  function updateHeroCamera(dt) {
    var isPortrait = viewH() > viewW();
    var wantPan = (portal.view === 'hall') || (portal.view === 'home' && state.heroStage === 'menu');
    var targetPan = (wantPan && !isPortrait) ? 1.0 : 0.0;
    var diff = targetPan - (state.heroPan || 0);
    if (Math.abs(diff) > 0.0005) state.heroPan = (state.heroPan || 0) + diff * Math.min(1, dt * 3.8);
    else state.heroPan = targetPan;
    if (isPortrait) state.heroPan = 0;
  }
  function renderPanorama(t, dt) {
    updateHeroCamera(dt);
    var pan = state.heroPan || 0;
    // 三次平滑缓动，模拟深空云台相机平稳横摇
    var easePan = pan * pan * (3 - 2 * pan);
    drawBackdropWithCameraPan(t, easePan);
    var w = viewW(), h = viewH();
    // 保持巨型行星在居中与左移时的真实物理尺度一致（不暴涨），仅带 4% 广角边缘透视感
    var baseR = Math.round(Math.max(w * 0.25, h * 0.43));
    var hr = Math.round(baseR * (1 + easePan * 0.04));
    var hx = Math.round((w * 0.50) * (1 - easePan) + (w * 0.02) * easePan);
    var hy = Math.round((h * 0.50) * (1 - easePan) + (h * 0.51) * easePan);
    drawHeroPlanet(hx, hy, hr, t, easePan);
    drawHeroShips(hx, hy, hr, t, false);
    state._heroDraws = (state._heroDraws || 0) + 1;
  }
  function bindMicroUx() {
    if (state.microBound) return; state.microBound = true;
    try {
      document.addEventListener('pointerover', function (e) {
        var t = e.target && e.target.closest && e.target.closest('.btn,.auth-tab,.hall-filter,.chat-ch,.mc-room-row,.admin-tab');
        if (!t) return; if (t === state._hoverEl) return; state._hoverEl = t; sfx('hover');
      });
      document.addEventListener('click', function (e) {
        var t = e.target && e.target.closest && e.target.closest('.auth-tab,.hall-filter,.chat-ch,.admin-tab');
        if (t) sfx('tab');
      });
      document.addEventListener('dblclick', function (e) {
        var row = e.target && e.target.closest && e.target.closest('.mc-room-row');
        if (row) sfx('joinRoom');
      });
    } catch (e) {}
  }

  var nebulaCanvas = null, nebulaCtx = null, nebulaLastAt = 0, nebulaFrame = 0;
  function composeNebulaBuffer(t) {
    if (!nebulaCanvas) { nebulaCanvas = document.createElement('canvas'); nebulaCanvas.width = 960; nebulaCanvas.height = 540; nebulaCtx = nebulaCanvas.getContext('2d'); }
    var now = performance.now();
    nebulaFrame = (nebulaFrame + 1) % 3;
    if (nebulaFrame !== 0 && now - nebulaLastAt < 50) return;
    nebulaLastAt = now;
    var bw = 960, bh = 540, g = nebulaCtx; if (!g) return;
    var bright = (state.settings ? state.settings.nebula : 100) / 100;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, bw, bh);
    var t1 = asset('nebula_deep_1'), t2 = asset('nebula_deep_2');
    if (t1) {
      g.save(); g.translate(bw / 2, bh / 2); g.rotate(t * 0.004);
      g.globalAlpha = (state.mode === 'start' ? 0.82 : 0.52) * bright;
      try { g.drawImage(t1, -bw * 0.75, -bh * 0.75, bw * 1.5, bh * 1.5); } catch (e) {}
      g.restore();
    }
    if (t2) {
      g.save(); g.globalCompositeOperation = 'screen'; g.translate(bw / 2, bh / 2); g.rotate(-t * 0.006);
      g.globalAlpha = (state.mode === 'start' ? 0.72 : 0.45) * bright * (0.82 + 0.18 * Math.sin(t * 0.35));
      try { g.drawImage(t2, -bw * 0.68, -bh * 0.62, bw * 1.36, bh * 1.24); } catch (e) {}
      g.restore();
    }
  }
  var planetStripCache = new Map(), cloudStripCache = null, shadeCache = new Map();
  function getTintedPlanetStrip(terrainKey, tintHex) {
    var key = terrainKey + '|' + (tintHex || '');
    if (planetStripCache.has(key)) return planetStripCache.get(key);
    var tex = (terrainKey === 'ice') ? getIceTexture() : asset('planet_' + terrainKey);
    if (!tex) return null;
    if (planetStripCache.size > 60) planetStripCache.clear();
    try {
      var c = document.createElement('canvas'); c.width = 1024; c.height = 256;
      var g = c.getContext('2d');
      g.drawImage(tex, 0, 0, 512, 256); g.drawImage(tex, 512, 0, 512, 256);
      if (tintHex) { g.globalCompositeOperation = 'color'; g.globalAlpha = 0.52; g.fillStyle = tintHex; g.fillRect(0, 0, 1024, 256); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; }
      planetStripCache.set(key, c); return c;
    } catch (e) { return null; }
  }
  function getCloudStrip() {
    if (cloudStripCache) return cloudStripCache;
    var tex = asset('planet_clouds'); if (!tex) return null;
    try { var c = document.createElement('canvas'); c.width = 1024; c.height = 256; var g = c.getContext('2d'); g.globalAlpha = 0.55; g.drawImage(tex, 0, 0, 512, 256); g.drawImage(tex, 512, 0, 512, 256); cloudStripCache = c; return c; } catch (e) { return null; }
  }
  function getSphereShadeCanvas(r, tintHex) {
    var q = Math.max(8, Math.round(r / 4) * 4), key = q + '|' + (tintHex || '');
    if (shadeCache.has(key)) return shadeCache.get(key);
    if (shadeCache.size > 60) shadeCache.clear();
    var pad = Math.round(q * 0.6), size = (q + pad) * 2;
    try {
      var c = document.createElement('canvas'); c.width = size; c.height = size;
      var g = c.getContext('2d'); g.translate(size / 2, size / 2);
      var tc = tintHex || '#9aa7b0';
      var halo = g.createRadialGradient(-q * 0.2, -q * 0.2, q * 0.72, 0, 0, q * 1.5);
      halo.addColorStop(0, rgba(tc, 0)); halo.addColorStop(0.4, rgba(tc, 0.28)); halo.addColorStop(1, rgba(tc, 0));
      g.fillStyle = halo; g.beginPath(); g.arc(0, 0, q * 1.5, 0, TAU); g.fill();
      g.save(); g.beginPath(); g.arc(0, 0, q, 0, TAU); g.clip();
      var hi = g.createRadialGradient(-q * 0.35, -q * 0.35, 0, -q * 0.35, -q * 0.35, q * 0.85);
      hi.addColorStop(0, 'rgba(255,255,255,0.35)'); hi.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = hi; g.fillRect(-q, -q, q * 2, q * 2);
      var sh = g.createRadialGradient(q * 0.45, q * 0.55, q * 0.1, q * 0.4, q * 0.5, q * 1.35);
      sh.addColorStop(0, 'rgba(2,6,15,0.76)'); sh.addColorStop(0.7, 'rgba(2,6,15,0.25)'); sh.addColorStop(1, 'rgba(2,6,15,0)');
      g.fillStyle = sh; g.fillRect(-q, -q, q * 2, q * 2);
      g.strokeStyle = rgba(tc, 0.85); g.lineWidth = 2.5; g.beginPath(); g.arc(0, 0, q - 1.25, 0, TAU); g.stroke();
      g.restore();
      var obj = { canvas: c, size: size, q: q }; shadeCache.set(key, obj); return obj;
    } catch (e) { return null; }
  }
  function drawBackdropWithCameraPan(t, easePan) { drawBackdrop(t, easePan); }
  function drawBackdrop(t, panIn) {
    var w = viewW(), h = viewH(), z = state.cam.zoom;
    var easePan = clamp(panIn || 0, 0, 1);
    var nebOffsetX = -easePan * w * 0.14;
    var starOffsetX = -easePan * w * 0.34;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    var g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.8);
    g.addColorStop(0, '#071726');
    g.addColorStop(0.5, '#040d18');
    g.addColorStop(1, '#02050b');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // I2/J3：双层星云离屏合成缓存（主画布每帧仅 1 次 drawImage）
    var __hasNeb = asset('nebula_deep_1') || asset('nebula_deep_2');
    if (__hasNeb) {
      composeNebulaBuffer(state.settings.nebulaFlow === false ? 0 : t);
      if (nebulaCanvas) {
        try {
          ctx.save();
          // 左右各预留 18% 余量（总宽 1.36w），无论镜头如何横摇绝不露出黑边断层
          ctx.drawImage(nebulaCanvas, -w * 0.18 + nebOffsetX, -h * 0.08, w * 1.36, h * 1.16);
          ctx.restore();
        } catch (e) {}
      }
    }
    if (!__hasNeb) {
    var neb = [
      { x: 0.28, y: 0.30, r: 0.62, c: 'rgba(48,62,135,0.22)' },
      { x: 0.66, y: 0.42, r: 0.70, c: 'rgba(72,45,128,0.16)' },
      { x: 0.52, y: 0.72, r: 0.58, c: 'rgba(28,110,120,0.14)' },
      { x: 0.82, y: 0.20, r: 0.45, c: 'rgba(38,68,145,0.16)' },
      { x: 0.16, y: 0.78, r: 0.5, c: 'rgba(24,90,115,0.12)' }
    ];
    var ox = -(state.cam.x / Math.max(1, state.world.w) - 0.5) * w * 0.12;
    var oy = -(state.cam.y / Math.max(1, state.world.h) - 0.5) * h * 0.12;
    for (var ni = 0; ni < neb.length; ni++) {
      var nb2 = neb[ni];
      var ncx = w * nb2.x + ox, ncy = h * nb2.y + oy, nrad = Math.max(w, h) * nb2.r;
      var ng = ctx.createRadialGradient(ncx, ncy, 0, ncx, ncy, nrad);
      ng.addColorStop(0, nb2.c);
      ng.addColorStop(1, 'rgba(2,5,11,0)');
      ctx.fillStyle = ng;
      ctx.beginPath(); ctx.ellipse(ncx, ncy, nrad, nrad * 0.7, 0.5, 0, TAU); ctx.fill();
    }
    }
    if (!state.dust) { state.dust = []; for (var __di = 0; __di < 35; __di++) state.dust.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() * 1.5, a: 0.2 + Math.random() * 0.5, v: 0.2 + Math.random() * 0.6 }); }
    for (var __dj = 0; __dj < state.dust.length; __dj++) {
      var __du = state.dust[__dj];
      var __dx = (((__du.x + (state.settings.nebulaFlow === false ? 0 : t * 0.004 * __du.v)) % 1) * w) + starOffsetX * 0.55;
      if (__dx < -8) __dx += w;
      ctx.fillStyle = 'rgba(200,230,255,' + __du.a + ')';
      ctx.fillRect(__dx, __du.y * h, __du.r, __du.r);
    }
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-state.cam.x, -state.cam.y);
    if (state.stars) {
      var left = state.cam.x - w / (2 * z) - 20, right = state.cam.x + w / (2 * z) + 20;
      var top = state.cam.y - h / (2 * z) - 20, bottom = state.cam.y + h / (2 * z) + 20;
      var panWorld = starOffsetX / z;
      for (var i = 0; i < state.stars.length; i++) {
        var s = state.stars[i];
        if (s.x < left || s.x > right || s.y < top || s.y > bottom) continue;
        var tw = 0.6 + 0.4 * Math.sin(t * 1.4 + s.tw);
        if (s.bright) {
          var br = Math.max(s.r, 1.6) / z;
          ctx.fillStyle = rgba(s.color || '#d8f3ff', 0.16 * tw);
          ctx.beginPath(); ctx.arc(s.x + panWorld, s.y, br * 5, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * tw).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(s.x + panWorld, s.y, br, 0, TAU); ctx.fill();
        } else {
          ctx.fillStyle = 'rgba(190,236,255,' + (s.a * tw).toFixed(3) + ')';
          ctx.fillRect(s.x + panWorld, s.y, Math.max(s.r, 1.2) / z, Math.max(s.r, 1.2) / z);
        }
      }
    }
    ctx.strokeStyle = 'rgba(110,247,255,.16)';
    ctx.lineWidth = 2 / z;
    ctx.strokeRect(0, 0, state.world.w, state.world.h);
    ctx.fillStyle = 'rgba(2,5,11,.55)';
    ctx.fillRect(-4000, -4000, state.world.w + 8000, 4000);
    ctx.fillRect(-4000, state.world.h, state.world.w + 8000, 4000);
    ctx.fillRect(-4000, 0, 4000, state.world.h);
    ctx.fillRect(state.world.w, 0, 4000, state.world.h);
    ctx.restore();
  }

  var ORBIT_COLORS = ['#ff6b9d', '#ffd166', '#4cc9f0', '#b28dff', '#7ee787', '#ff9f6b', '#f78fb3', '#9be7ff'];

  // Ships orbit their world; the first dozen ride the inner ring so the count reads at a glance.
  function hash01(n) {
    var x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
    return x - Math.floor(x);
  }

  // 返回目标星球的环绕数量修正值：提前抵达的前排飞船为 +1，服务端已入轨但尚在半路的队尾飞船为 -1
  function getOrbitDeltaCount(planetId, ownerId) {
    var delta = 0;
    state.fleetShips.forEach(function (ships) {
      if (!ships || ships.done || ships.targetId !== planetId || ships.owner !== ownerId) return;
      for (var i = 0; i < ships.length; i++) {
        if (ships.docking) {
          if (!ships[i].arrived) delta--; // 服务端已计入星环，但该船还在半路，暂扣
        } else {
          if (ships[i].arrived) delta++;  // 服务端尚未入轨，但该前排船已触碰星环，提前并入星环旋转
        }
      }
    });
    return delta;
  }

  function collectOrbitShips3D(pl, t, backOut, frontOut, fade) {
    var vsOrbit = getOrbitVisScale();
    var fadeK = (fade == null ? 1 : fade);
    var factionShips = [];
    var rawDef = Math.floor(pl.troops || 0);
    var defDelta = pl.owner ? getOrbitDeltaCount(pl.id, pl.owner) : 0;
    var defCount = Math.max(0, rawDef + defDelta);
    if (defCount > 0) {
      factionShips.push({
        owner: pl.owner,
        color: pl.owner ? (pl.color || displayColor(pl.owner)) : '#b8cde0',
        isNeutral: !pl.owner,
        count: clamp(defCount, 1, 38),
        isDef: true
      });
    }
    var shares = Object.assign({}, pl.orbitBy || {});
    // 若有敌方/盟友前排飞船提前抵达星环，确保其阵营 ID 也在 shares 列表内
    state.fleetShips.forEach(function (ships) {
      if (!ships || ships.done || ships.targetId !== pl.id || !ships.owner) return;
      if (ships.owner !== pl.owner && shares[ships.owner] == null) shares[ships.owner] = 0;
    });
    Object.keys(shares).forEach(function (oidStr) {
      var oid = Number(oidStr);
      var rawCnt = Math.floor(shares[oid] || 0);
      var dCnt = (oid === pl.owner) ? 0 : getOrbitDeltaCount(pl.id, oid);
      var cnt = Math.max(0, rawCnt + dCnt);
      if (cnt <= 0) return;
      factionShips.push({
        owner: oid,
        color: displayColor(oid),
        isNeutral: false,
        count: clamp(cnt, 1, 38),
        isDef: (oid === pl.owner)
      });
    });
    if (!factionShips.length) return;

    // 接近水平的星环倾角（约 -6.5° ~ +6.5°），短轴压扁比 0.22，左右两侧舒展星翼
    var tilt = ((pl.id % 2 === 0 ? 1 : -1) * 0.11);
    var cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    var aspect = 0.22;
    var hasHostileInOrbit = factionShips.some(function (g) { return g.owner !== pl.owner && !isAlly(g.owner); });

    factionShips.forEach(function (grp, gIdx) {
      for (var i = 0; i < grp.count; i++) {
        var seed = pl.id * 113 + (grp.owner || 0) * 37 + i * 19;
        // 使用固定槽位索引 i 乘黄金角分布，避免 count 变化时整圈飞船跳位闪烁！
        var baseAngle = i * 2.3999632 + gIdx * 1.57;
        var rx = pl.r * (1.28 + hash01(seed) * 0.32 + (gIdx * 0.05));
        var speed = (0.95 + hash01(seed + 5) * 0.32);
        var ang = t * speed + baseAngle;

        var ex = Math.cos(ang) * rx;
        var ey = Math.sin(ang) * rx * aspect;
        var tvx = -Math.sin(ang) * rx;
        var tvy = Math.cos(ang) * rx * aspect;

        var wx = pl.x + ex * cosT - ey * sinT;
        var wy = pl.y + ex * sinT + ey * cosT;
        var tang = Math.atan2(tvx * sinT + tvy * cosT, tvx * cosT - tvy * sinT);

        var depth = Math.sin(ang); // < 0 在星球背面，>= 0 在星球正面
        var distFromCenter = Math.hypot(wx - pl.x, wy - pl.y);
        if (depth < 0 && distFromCenter < pl.r * 0.96) continue; // 背面被球体遮挡

        var shipObj = {
          x: wx, y: wy, ang: tang,
          scale: (0.86 + 0.22 * depth) * vsOrbit,
          alpha: (depth < 0 ? 0.62 : 0.96) * fadeK,
          color: grp.color,
          isNeutral: grp.isNeutral
        };
        if (depth < 0) backOut.push(shipObj);
        else frontOut.push(shipObj);

        if (hasHostileInOrbit && Math.random() < 0.035) {
          addParticle({
            x: wx, y: wy,
            vx: (Math.random() - 0.5) * 90, vy: (Math.random() - 0.5) * 90,
            life: 0.14 + Math.random() * 0.16, max: 0.30,
            size: (1.8 + Math.random() * 1.8) * vsOrbit,
            color: grp.color, drag: 0.1, glow: true
          });
        }
      }
    });
  }

  function drawOrbitShipBatch(list) {
    if (!list.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      var ux = Math.cos(s.ang), uy = Math.sin(s.ang);
      var nx = -uy, ny = ux;
      var tailLen = 18.5 * s.scale;
      var halfW = 2.35 * s.scale;
      var tailAlpha = (s.isNeutral ? 0.48 : 0.86) * s.alpha;
      var grad = ctx.createLinearGradient(s.x, s.y, s.x - ux * tailLen, s.y - uy * tailLen);
      grad.addColorStop(0, rgba(s.color, tailAlpha));
      grad.addColorStop(0.45, rgba(s.color, tailAlpha * 0.42));
      grad.addColorStop(1, rgba(s.color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(s.x + nx * halfW, s.y + ny * halfW);
      ctx.lineTo(s.x - ux * tailLen, s.y - uy * tailLen);
      ctx.lineTo(s.x - nx * halfW, s.y - ny * halfW);
      ctx.closePath();
      ctx.fill();

      var glowR = 7.4 * s.scale;
      var glowAlpha = (s.isNeutral ? 0.26 : 0.54) * s.alpha;
      var g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
      g.addColorStop(0, rgba(s.color, glowAlpha));
      g.addColorStop(1, rgba(s.color, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(s.x, s.y, glowR, 0, TAU); ctx.fill();

      ctx.fillStyle = rgba('#ffffff', (s.isNeutral ? 0.88 : 0.98) * s.alpha);
      ctx.beginPath(); ctx.arc(s.x, s.y, 2.05 * s.scale, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function getOrbitVisScale() {
    var z = Math.max(state.cam.zoom || 0.35, 0.15);
    return clamp(Math.pow(0.48 / z, 0.55), 1.35, 2.40);
  }

  function getVisScale() {
    var z = Math.max(state.cam.zoom || 0.35, 0.15);
    return clamp(Math.pow(0.50 / z, 0.58), 1.45, 2.60);
  }

  var planetBodyCache = new Map();
  function getPlanetBodyCanvas(pl) {
    var ownerColor = pl.owner ? (pl.color || displayColor(pl.owner)) : '';
    var key = pl.id + ':' + (ownerColor || 'neutral') + ':' + Math.round(pl.r);
    if (planetBodyCache.has(key)) return planetBodyCache.get(key);

    var r = Math.round(pl.r);
    var pad = Math.round(r * 0.75);
    var size = (r + pad) * 2;
    var off = document.createElement('canvas');
    off.width = size; off.height = size;
    var octx = off.getContext('2d');
    var cx = size / 2, cy = size / 2;

    octx.save();
    octx.translate(cx, cy);

    // 1. 偏心大气外辉光
    if (pl.owner) {
      var halo = octx.createRadialGradient(-r * 0.20, -r * 0.20, r * 0.72, 0, 0, r * 1.50);
      halo.addColorStop(0, rgba(ownerColor, 0));
      halo.addColorStop(0.32, rgba(ownerColor, 0.34));
      halo.addColorStop(0.65, rgba(ownerColor, 0.10));
      halo.addColorStop(1, rgba(ownerColor, 0));
      octx.fillStyle = halo;
      octx.beginPath(); octx.arc(0, 0, r * 1.50, 0, TAU); octx.fill();
    } else {
      var nHalo = octx.createRadialGradient(-r * 0.24, -r * 0.24, r * 0.78, 0, 0, r * 1.28);
      nHalo.addColorStop(0, 'rgba(210,225,240,0)');
      nHalo.addColorStop(0.45, 'rgba(210,225,240,0.16)');
      nHalo.addColorStop(1, 'rgba(210,225,240,0)');
      octx.fillStyle = nHalo;
      octx.beginPath(); octx.arc(0, 0, r * 1.28, 0, TAU); octx.fill();
    }

    // 2. 饱满球体基底（保留背光侧深空靛蓝轮廓，避免背光面融入纯黑背景显得星球缩水）
    octx.save();
    octx.beginPath(); octx.arc(0, 0, r, 0, TAU); octx.clip();

    var bodyGrad = octx.createRadialGradient(-r * 0.42, -r * 0.42, r * 0.05, r * 0.15, r * 0.15, r * 1.25);
    if (pl.owner) {
      bodyGrad.addColorStop(0, rgba(ownerColor, 0.54));
      bodyGrad.addColorStop(0.38, '#132036');
      bodyGrad.addColorStop(0.78, '#0b1322');
      bodyGrad.addColorStop(1, '#070c16');
    } else {
      bodyGrad.addColorStop(0, '#788594');
      bodyGrad.addColorStop(0.40, '#363f4a');
      bodyGrad.addColorStop(0.78, '#1b2028');
      bodyGrad.addColorStop(1, '#10141a');
    }
    octx.fillStyle = bodyGrad;
    octx.fillRect(-r, -r, r * 2, r * 2);

    // 3. 地表微米级岩石颗粒纹理
    var grainCount = Math.floor(r * r * 0.45);
    for (var g = 0; g < grainCount; g++) {
      var gx = (hash01(pl.id * 13 + g * 7) * 2 - 1) * r;
      var gy = (hash01(pl.id * 29 + g * 11) * 2 - 1) * r;
      if (gx * gx + gy * gy > r * r) continue;
      var lightBias = ((-gx - gy) / (r * 1.4) + 1) * 0.5;
      if (g % 3 === 0) {
        octx.fillStyle = pl.owner
          ? rgba(ownerColor, 0.04 + 0.09 * lightBias)
          : 'rgba(230,240,255,' + (0.03 + 0.06 * lightBias).toFixed(3) + ')';
      } else {
        octx.fillStyle = 'rgba(0,0,0,0.22)';
      }
      var gs = 1.1 + (g % 2) * 0.8;
      octx.fillRect(gx, gy, gs, gs);
    }

    // 4. 球体内壁菲涅尔内发光
    if (pl.owner) {
      var innerRim = octx.createRadialGradient(0, 0, r * 0.72, 0, 0, r);
      innerRim.addColorStop(0, rgba(ownerColor, 0));
      innerRim.addColorStop(0.78, rgba(ownerColor, 0.16));
      innerRim.addColorStop(1, rgba(ownerColor, 0.65));
      octx.fillStyle = innerRim;
      octx.beginPath(); octx.arc(0, 0, r, 0, TAU); octx.fill();
    }
    octx.restore();

    // 5. 360° 清晰球体轮廓弧（左上极亮，右下保留 0.28 轮廓亮度，使整颗星球视觉体积饱满不缩水）
    var rimGrad = octx.createLinearGradient(-r, -r, r * 0.85, r * 0.85);
    if (pl.owner) {
      rimGrad.addColorStop(0, '#ffffff');
      rimGrad.addColorStop(0.18, ownerColor);
      rimGrad.addColorStop(0.62, rgba(ownerColor, 0.48));
      rimGrad.addColorStop(1, rgba(ownerColor, 0.26));
    } else {
      rimGrad.addColorStop(0, 'rgba(240,248,255,0.85)');
      rimGrad.addColorStop(0.50, 'rgba(165,185,205,0.38)');
      rimGrad.addColorStop(1, 'rgba(120,140,165,0.22)');
    }
    octx.strokeStyle = rimGrad;
    octx.lineWidth = Math.max(2.4, r * 0.046);
    octx.beginPath(); octx.arc(0, 0, r - octx.lineWidth * 0.35, 0, TAU); octx.stroke();

    octx.restore();
    if (planetBodyCache.size > 120) planetBodyCache.clear();
    planetBodyCache.set(key, off);
    return off;
  }

  /* ================= Stage 3 · Task G：ModSandbox 客户端热加载沙盒 ================= */
  var ModSandbox = {
    hooks: { planet: [], hud: [], event: [] },
    styleNodes: [],
    active: [],
    _makeApi: function (mod) {
      var self = this;
      mod = mod || {};
      return {
        modId: mod.id || '',
        config: (mod.config && typeof mod.config === 'object') ? mod.config : {},
        onRenderPlanet: function (fn) { if (typeof fn === 'function') self.hooks.planet.push(fn); },
        onRenderHud: function (fn) { if (typeof fn === 'function') self.hooks.hud.push(fn); },
        onEvent: function (fn) { if (typeof fn === 'function') self.hooks.event.push(fn); },
        addStyle: function (cssText) {
          if (!cssText) return null;
          var st = document.createElement('style');
          st.setAttribute('data-mod-style', '1');
          if (mod.id) st.setAttribute('data-mod', String(mod.id));
          st.textContent = String(cssText);
          (document.head || document.documentElement).appendChild(st);
          self.styleNodes.push(st);
          return st;
        }
      };
    },
    load: function (mods) {
      this.unloadAll();   // 先清空旧扩展（零残留）
      if (!Array.isArray(mods) || !mods.length) return 0;
      for (var i = 0; i < mods.length; i++) {
        var mod = mods[i] || {};
        try {
          var api = this._makeApi(mod);
          var config = (mod.config && typeof mod.config === 'object') ? mod.config : {};
          var factory = new Function('api', 'config', mod.clientCode || '');
          factory(api, config);
          this.active.push({ id: mod.id || ('mod-' + i), name: mod.name || '' });
        } catch (e) {
          // 单个 mod 报错不影响游戏与其它 mod
          try { console.warn('[ModSandbox] mod failed: ' + (mod.id || i), e); } catch (x) {}
        }
      }
      return this.active.length;
    },
    unloadAll: function () {
      for (var i = 0; i < this.styleNodes.length; i++) {
        var el = this.styleNodes[i];
        try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      }
      this.styleNodes = [];
      this.hooks.planet = [];
      this.hooks.hud = [];
      this.hooks.event = [];
      this.active = [];
    },
    runPlanetHooks: function (ctx, pl, t) {
      var list = this.hooks.planet;
      for (var i = 0; i < list.length; i++) { try { list[i](ctx, pl, t); } catch (e) {} }
    },
    runHudHooks: function (ctx, t) {
      var list = this.hooks.hud;
      for (var i = 0; i < list.length; i++) { try { list[i](ctx, t); } catch (e) {} }
    },
    runEventHooks: function (msg) {
      var list = this.hooks.event;
      for (var i = 0; i < list.length; i++) { try { list[i](msg); } catch (e) {} }
    },
    count: function () {
      return { planet: this.hooks.planet.length, hud: this.hooks.hud.length, event: this.hooks.event.length, styles: this.styleNodes.length, active: this.active.length };
    }
  };

  function drawPlanet(pl, t) {
    var isSel = pl.id === state.selPlanet;
    var ownerColor = pl.owner ? (pl.color || displayColor(pl.owner)) : '';
    ctx.save();
    ctx.translate(pl.x, pl.y);
    if (isSel) {
      var pulse = 0.6 + 0.4 * Math.sin(t * 3);
      ctx.strokeStyle = 'rgba(255,255,255,' + pulse.toFixed(2) + ')';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.lineDashOffset = -t * 40;
      ctx.beginPath(); ctx.arc(0, 0, pl.r + 20, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (pl.isOutpost) {
      ctx.save();
      ctx.rotate(t * 0.08);
      var mg = ctx.createLinearGradient(-pl.r, -pl.r, pl.r, pl.r);
      mg.addColorStop(0, '#b8c4d0'); mg.addColorStop(0.5, '#6b7683'); mg.addColorStop(1, '#1e242b');
      ctx.strokeStyle = mg;
      ctx.lineWidth = pl.r * 0.5;
      ctx.beginPath(); ctx.arc(0, 0, pl.r * 0.74, 0, TAU); ctx.stroke();
      for (var li = 0; li < 6; li++) {
        ctx.save(); ctx.rotate((li / 6) * TAU);
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.moveTo(pl.r * 0.86, -pl.r * 0.16);
        ctx.lineTo(pl.r * 1.12, -pl.r * 0.09);
        ctx.lineTo(pl.r * 1.12, pl.r * 0.09);
        ctx.lineTo(pl.r * 0.86, pl.r * 0.16);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = rgba(ownerColor || '#9fb4c0', 0.6);
      ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.arc(0, 0, pl.r * 0.46, 0, TAU); ctx.stroke();
      ctx.restore();
      for (var lp = 0; lp < (pl.level || 1); lp++) {
        ctx.beginPath();
        ctx.arc(-((pl.level || 1) - 1) * 7 + lp * 14, -pl.r * 0.95, 3.2, 0, TAU);
        ctx.fillStyle = ownerColor || '#cfe3ee'; ctx.fill();
      }
    } else {
      var _th = terrainOf(pl);
      state._lastTerrain = _th;
      if (!drawTexturedPlanet(pl, t, _th)) {
        var bodyCanvas = getPlanetBodyCanvas(pl);
        ctx.drawImage(bodyCanvas, -bodyCanvas.width / 2, -bodyCanvas.height / 2);
        ctx.strokeStyle = rgba(terrainColor(_th), 0.55); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(0, 0, pl.r - 1, 0, TAU); ctx.stroke();
      }
    }
    if (pl.exhausted) {
      ctx.strokeStyle = 'rgba(255,143,107,' + (0.45 + 0.3 * Math.sin(t * 4)) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 6]);
      ctx.beginPath(); ctx.arc(0, 0, pl.r + 9, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (planetShielded(pl)) {
      ctx.strokeStyle = 'rgba(160,240,255,.5)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 6]);
      ctx.beginPath(); ctx.arc(0, 0, pl.r + 15, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    var z = state.cam.zoom;
    var ringR = pl.r * 1.48 + 10;
    var shares = pl.orbitBy || {};
    var ids = Object.keys(shares).map(Number).filter(function (id) { return shares[id] > 0.01; });

    // 60fps 丝滑读条插值（消除 200ms 服务端 Tick 步进感）
    var targetCap = pl.captureProg || 0;
    var targetPur = (pl.purityProg == null ? (pl.owner ? 1 : 0) : pl.purityProg);
    if (pl._visCap == null || Math.abs(targetCap - pl._visCap) > 0.35) pl._visCap = targetCap;
    else pl._visCap += (targetCap - pl._visCap) * 0.14;
    if (pl._visPur == null || Math.abs(targetPur - pl._visPur) > 0.35) pl._visPur = targetPur;
    else pl._visPur += (targetPur - pl._visPur) * 0.14;

    // ---- 多方舰队混战 / 同驻：按飞船实时占比绘制分段环形条 ----
    var segMap = new Map();
    if (pl.troops >= 1) {
      var defKey = pl.owner || 0;
      segMap.set(defKey, {
        owner: defKey,
        count: Math.floor(pl.troops),
        color: pl.owner ? (ownerColor || displayColor(pl.owner)) : '#9aa7b0'
      });
    }
    ids.forEach(function (oid) {
      var c = Math.floor(shares[oid] || 0);
      if (c < 1) return;
      if (segMap.has(oid)) segMap.get(oid).count += c;
      else segMap.set(oid, { owner: oid, count: c, color: displayColor(oid) });
    });
    var segments = Array.from(segMap.values()).filter(function (s) { return s.count >= 1; });
    segments.sort(function (a, b) { return (a.owner === pl.owner ? -1 : b.owner === pl.owner ? 1 : a.owner - b.owner); });

    if (!pl._ringShares) pl._ringShares = {};
    var purifying = (pl.owner !== 0 && pl._visPur < 0.995 && segments.length <= 1);
    var capturing = (pl.owner === 0 && pl._visCap > 0.003 && segments.length <= 1);

    if (segments.length >= 2) {
      var smoothTotal = 0;
      for (var si = 0; si < segments.length; si++) {
        var sg = segments[si];
        var prevS = pl._ringShares[sg.owner];
        sg.smooth = (prevS == null) ? sg.count : (prevS + (sg.count - prevS) * 0.18);
        pl._ringShares[sg.owner] = sg.smooth;
        smoothTotal += sg.smooth;
      }
      if (smoothTotal > 0.01) {
        var curAng = -Math.PI / 2;
        var gapAng = segments.length > 1 ? 0.045 : 0;
        var dfs = clamp(12 / Math.max(z, 0.2), 11, 36);
        ctx.font = '700 ' + dfs.toFixed(0) + 'px "SFMono-Regular",Consolas,monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineCap = 'round';
        ctx.lineWidth = 3.4;

        for (var k = 0; k < segments.length; k++) {
          var item = segments[k];
          var span = (item.smooth / smoothTotal) * TAU;
          var a0 = curAng + gapAng * 0.5;
          var a1 = curAng + Math.max(gapAng * 0.6, span - gapAng * 0.5);
          ctx.strokeStyle = rgba(item.color, 0.92);
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, ringR, a0, a1);
          ctx.stroke();

          var midAng = curAng + span * 0.5;
          var labelR = ringR + 14 + dfs * 0.35;
          var lx = pl.x + Math.cos(midAng) * labelR;
          var ly = pl.y + Math.sin(midAng) * labelR;
          ctx.lineWidth = 3.2;
          ctx.strokeStyle = 'rgba(2,7,12,.9)';
          ctx.strokeText(String(item.count), lx, ly);
          ctx.fillStyle = item.color;
          ctx.fillText(String(item.count), lx, ly);
          ctx.lineWidth = 3.4;
          curAng += span;
        }
        ctx.lineCap = 'butt';
      }
    } else if (purifying) {
      ctx.strokeStyle = 'rgba(255,176,102,.28)'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, ringR, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffb066'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.shadowColor = '#ffb066'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(1 - pl._visPur, 0, 1)); ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    } else if (capturing || pl._visCap > 0.005) {
      var capCol = pl.captureBy ? displayColor(pl.captureBy) : '#5bffd8';
      ctx.strokeStyle = rgba(capCol, 0.28); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, ringR, 0, TAU); ctx.stroke();
      ctx.strokeStyle = capCol; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
      ctx.shadowColor = capCol; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, ringR, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(pl._visCap, 0, 1)); ctx.stroke();
      ctx.shadowBlur = 0; ctx.lineCap = 'butt';
    }

    // ---- three-layer text: troops below, owner above, name only when focused ----
    var opP = pl.owner ? state.players.get(pl.owner) : null;
    var tag = '';
    if (pl.owner && isAlly(pl.owner)) tag += ' [盟友]';
    if (opP && opP.bot) tag += ' [AI]';
    if (opP && !opP.bot && opP.online === false) tag += ' [掉线]';
    var allyBits = '';
    if (ids.length > 1) {
      ids.forEach(function (id) {
        var pid = Number(id);
        if (pid === pl.owner || !(shares[id] > 0.01)) return;
        allyBits += ' +' + Math.round(shares[id]);
      });
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    var fs1 = clamp(15 / Math.max(z, 0.2), 12, 54);
    var belowY = pl.y + pl.r + 18;
    var tstr = Math.floor(pl.troops) + '/' + pl.cap + allyBits;
    ctx.font = '700 ' + fs1.toFixed(1) + 'px "SFMono-Regular",Consolas,monospace';
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,7,12,.9)';
    ctx.strokeText(tstr, pl.x, belowY);
    ctx.fillStyle = pl.owner ? (ownerColor || '#eafcff') : 'rgba(170,185,200,' + (pl.troops > 0 ? '0.9' : '0.55') + ')';
    ctx.fillText(tstr, pl.x, belowY);

    var fs2 = clamp(12 / Math.max(z, 0.2), 10, 44);
    var showName = (pl.id === state.selPlanet) || (z > 0.65);
    var topY = pl.y - (purifying || pl.captureProg > 0.005 ? ringR : pl.r) - 10;
    if (pl.owner) {
      var label = factionName(pl.owner) + tag;
      ctx.font = '600 ' + fs2.toFixed(1) + 'px "PingFang SC","Noto Sans SC",sans-serif';
      ctx.lineWidth = 3.4; ctx.strokeStyle = 'rgba(2,7,12,.9)';
      ctx.strokeText(label, pl.x, topY);
      ctx.fillStyle = ownerColor || '#dbe7ee';
      ctx.fillText(label, pl.x, topY);
      if (showName) {
        ctx.font = '800 ' + (fs2 * 1.25).toFixed(1) + 'px "PingFang SC","Noto Sans SC",system-ui,sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,7,12,.92)';
        ctx.strokeText(pl.name, pl.x, topY - fs2 * 1.5);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(pl.name, pl.x, topY - fs2 * 1.5);
      }
    } else if (showName) {
      ctx.font = '700 ' + (fs2 * 1.2).toFixed(1) + 'px "PingFang SC","Noto Sans SC",sans-serif';
      ctx.lineWidth = 3.6; ctx.strokeStyle = 'rgba(2,7,12,.9)';
      ctx.strokeText(pl.name, pl.x, topY);
      ctx.fillStyle = 'rgba(214,226,234,.92)';
      ctx.fillText(pl.name, pl.x, topY);
    }
    if (pl.exhausted) {
      ctx.fillStyle = 'rgba(2,8,12,.74)';
      ctx.fillRect(pl.x - 24, pl.y - 10, 48, 20);
      ctx.fillStyle = '#ffab7a';
      ctx.font = '600 12px "PingFang SC","Noto Sans SC",sans-serif';
      ctx.fillText('耗竭', pl.x, pl.y + 4);
    }
    ctx.textBaseline = 'alphabetic';
    if (pl.destroyTimer > 0) {
      var total = (state.rules.destroyTime) || 8;
      var pct = clamp(1 - pl.destroyTimer / total, 0, 1);
      ctx.strokeStyle = '#ffc766';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r + 26, -Math.PI / 2, -Math.PI / 2 + TAU * pct); ctx.stroke();
      ctx.lineCap = 'butt';
    }
    if (pl.id === state.selPlanet && pl.owner && !pl.exhausted) {
      // ore ring is only drawn for the world you have selected
      var rc = clamp(pl.resource / Math.max(1, pl.maxResource || 180), 0, 1);
      ctx.strokeStyle = 'rgba(255,199,102,.75)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(pl.x, pl.y, pl.r + 12, -Math.PI * 0.15, -Math.PI * 0.15 + TAU * rc); ctx.stroke();
    }
    ModSandbox.runPlanetHooks(ctx, pl, t);   // Task G：Mod 星球渲染钩子
  }

  // Fleets are bound to a world: the selected world emits a named squad, other squadrons stay dim.
  function linkedSquad() {
    if (!state.selPlanet) return null;
    var pl = state.planets.get(state.selPlanet);
    if (!pl || pl.owner !== state.selfId) return null;
    var best = null;
    state.fleets.forEach(function (f) {
      if (f.owner !== state.selfId) return;
      if (f.target === pl.id && (!best || f.id < best.id)) best = f;
    });
    return best;
  }

  // ---- point-ship formation (strict forward peel-off + per-ship orbit insertion) ----
  function computePlanetOrbitPoint(pl, ang, rScale) {
    var tilt = ((pl.id % 2 === 0 ? 1 : -1) * 0.11);
    var cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    var rx = pl.r * (rScale || 1.38);
    var ex = Math.cos(ang) * rx;
    var ey = Math.sin(ang) * rx * 0.22;
    return {
      x: pl.x + ex * cosT - ey * sinT,
      y: pl.y + ex * sinT + ey * cosT
    };
  }

  function ensureFleetShips(f) {
    var n = Math.min(42, Math.max(1, Math.round(f.n || 1)));
    var arr = state.fleetShips.get(f.id);
    var srcPl = f.srcPlanet && state.planets.has(f.srcPlanet) ? state.planets.get(f.srcPlanet) : null;
    var sx = srcPl ? srcPl.x : (f.startX != null ? f.startX : (f.dx == null ? f.x : f.dx));
    var sy = srcPl ? srcPl.y : (f.startY != null ? f.startY : (f.dy == null ? f.y : f.dy));
    var tx = (f.tx != null ? f.tx : sx + 1);
    var ty = (f.ty != null ? f.ty : sy);
    var col = f.color || displayColor(f.owner);

    if (!arr) {
      arr = [];
      arr.id = f.id;
      // 若首次同步时该舰队已经处于环绕状态，直接标记 done，绝不在源星球生成幽灵飞船
      if (f.orbiting) {
        arr.done = true;
        arr.docking = true;
        state.fleetShips.set(f.id, arr);
        return arr;
      }
      arr.owner = f.owner;
      arr.color = col;
      arr.srcPlanet = f.srcPlanet || 0;
      arr.targetId = f.target || f.targetPlanet || 0;
      arr.sx = sx; arr.sy = sy;
      arr.tx = tx; arr.ty = ty;
      arr.born = performance.now();
      arr.docking = !!f.orbiting;

      var flyAng = Math.atan2(ty - sy, tx - sx);
      for (var i = 0; i < n; i++) {
        var r1 = hash01(f.id * 97 + i * 31);
        var r2 = hash01(f.id * 131 + i * 73);
        var ox, oy;
        if (srcPl) {
          var orbAng = i * 2.3999632 + (f.id % 7) * 0.9;
          var pt = computePlanetOrbitPoint(srcPl, orbAng, 1.28 + 0.30 * r2);
          ox = pt.x; oy = pt.y;
        } else {
          var a0 = flyAng + (r1 - 0.5) * 2.0;
          ox = sx + Math.cos(a0) * 45 * (0.5 + 0.5 * r2);
          oy = sy + Math.sin(a0) * 45 * 0.35;
        }
        arr.push({
          x: ox, y: oy,
          ang: flyAng,
          latSeed: (r1 - 0.5) * 2.0, // -1 ~ +1
          speedSeed: r2,
          rank: 0,
          speedRatio: 1.0,
          entryAng: Math.atan2(sy - ty, sx - tx) + (r1 - 0.5) * 1.6,
          orbitRScale: 1.30 + 0.30 * r2,
          arrived: false
        });
      }
      // 按离目标距离从近到远排序：本来就在星球朝向目标一侧的飞船先出发，背面的随后平滑绕出，绝不倒退！
      arr.sort(function (a, b) {
        return Math.hypot(tx - a.x, ty - a.y) - Math.hypot(tx - b.x, ty - b.y);
      });
      for (var k = 0; k < arr.length; k++) {
        arr[k].rank = arr.length > 1 ? k / (arr.length - 1) : 0;
      }
      state.fleetShips.set(f.id, arr);
    } else {
      if (arr.done) return arr;
      arr.color = col;
      arr.owner = f.owner;
      if (f.target || f.targetPlanet) arr.targetId = f.target || f.targetPlanet;
      if (f.tx != null && !f.orbiting) { arr.tx = f.tx; arr.ty = f.ty; }
      if (f.orbiting) arr.docking = true;

      if (!arr.docking && arr.length !== n) {
        var hx = (f.dx == null ? f.x : f.dx), hy = (f.dy == null ? f.y : f.dy);
        while (arr.length < n) {
          var idx = arr.length;
          var ref = arr[arr.length - 1] || { x: hx, y: hy, ang: 0 };
          arr.push({
            x: ref.x, y: ref.y, ang: ref.ang || 0,
            latSeed: (hash01(f.id * 53 + idx) - 0.5) * 2,
            speedSeed: hash01(f.id * 79 + idx),
            rank: 1.0,
            speedRatio: 1.0,
            entryAng: (idx * 2.3999632) % TAU,
            orbitRScale: 1.35,
            arrived: false
          });
        }
        while (arr.length > n) arr.pop();
      }
    }
    return arr;
  }

  function updateFleetShips(dt, now) {
    var vs = getVisScale();
    var stepDt = Math.min(dt, 0.05);
    var tSec = now / 1000;

    state.fleets.forEach(function (f) {
      ensureFleetShips(f);
    });
    state.fleetShips.forEach(function (ships, id) {
      var f = state.fleets.get(id);
      if (!f || f.orbiting) ships.docking = true;
    });

    var finishedSwarms = [];
    state.fleetShips.forEach(function (ships, id) {
      var f = state.fleets.get(id);
      var tgtPl = ships.targetId && state.planets.has(ships.targetId) ? state.planets.get(ships.targetId) : null;
      var srcPl = ships.srcPlanet && state.planets.has(ships.srcPlanet) ? state.planets.get(ships.srcPlanet) : null;
      var sx = srcPl ? srcPl.x : ships.sx;
      var sy = srcPl ? srcPl.y : ships.sy;
      var tx = tgtPl ? tgtPl.x : ships.tx;
      var ty = tgtPl ? tgtPl.y : ships.ty;

      // 服务端在距目标球心 arriveR 处即判定入轨（与 server.js 一致）
      var arriveR = tgtPl ? ((tgtPl.isOutpost ? tgtPl.r * 1.15 : tgtPl.r * 1.28) + 4) : 12;
      var startR = srcPl ? (srcPl.r * 1.35) : 0;
      var ddx = tx - sx, ddy = ty - sy;
      var centerDist = Math.max(1, Math.hypot(ddx, ddy));
      var ux = ddx / centerDist, uy = ddy / centerDist;
      var nx = -uy, ny = ux;

      var startX = sx + ux * startR, startY = sy + uy * startR;
      var endX = tx - ux * arriveR, endY = ty - uy * arriveR;
      var flightSpan = Math.max(20, centerDist - startR - arriveR);

      // 锚定服务端插值坐标 (f.dx, f.dy)，计算权威航程进度 prog
      var fx = (f && !f.orbiting) ? (f.dx != null ? f.dx : f.x) : endX;
      var fy = (f && !f.orbiting) ? (f.dy != null ? f.dy : f.y) : endY;
      var along = (fx - startX) * ux + (fy - startY) * uy;
      var prog = ships.docking ? 1.0 : clamp(along / flightSpan, 0, 1);

      var swarmWidth = Math.min(64, 12 + Math.sqrt(ships.length) * 8.5) * vs;
      var swarmLen = Math.min(76, 16 + Math.sqrt(ships.length) * 9.0) * vs;
      var corridorEnv = Math.sin(prog * Math.PI);
      var allArrived = true;

      for (var i = 0; i < ships.length; i++) {
        var s = ships[i];
        if (s.arrived) continue;
        if (s.ox == null) { s.ox = s.x; s.oy = s.y; }

        var orbGoalX = tx, orbGoalY = ty;
        if (tgtPl) {
          var orbAng = tSec * 1.05 + s.entryAng;
          var orbPt = computePlanetOrbitPoint(tgtPl, orbAng, s.orbitRScale || 1.38);
          orbGoalX = orbPt.x;
          orbGoalY = orbPt.y;
        }

        if (!ships.docking && prog < 0.98) {
          var longOffset = (0.5 - s.rank) * swarmLen * corridorEnv;
          var latOffset = s.latSeed * swarmWidth * corridorEnv;
          var formX = fx + ux * longOffset + nx * latOffset;
          var formY = fy + uy * longOffset + ny * latOffset;
          var launchBlend = clamp(prog / 0.15, 0, 1);
          var targetX = s.ox * (1 - launchBlend) + formX * launchBlend;
          var targetY = s.oy * (1 - launchBlend) + formY * launchBlend;
          var mvX = targetX - s.x, mvY = targetY - s.y;
          if (Math.hypot(mvX, mvY) > 0.5) s.ang = Math.atan2(mvY, mvX);
          else s.ang = Math.atan2(uy, ux);
          s.x = targetX;
          s.y = targetY;
          s.speedRatio = 1.0;
          allArrived = false;
        } else {
          var toOrbX = orbGoalX - s.x, toOrbY = orbGoalY - s.y;
          var distOrb = Math.hypot(toOrbX, toOrbY);
          var dockSpeed = ((state.rules && state.rules.shipSpeed) || 340) * 2.4;
          var step = dockSpeed * stepDt;
          if (distOrb <= Math.max(step, 14)) {
            s.x = orbGoalX;
            s.y = orbGoalY;
            s.arrived = true;
            continue;
          }
          s.x += (toOrbX / distOrb) * step;
          s.y += (toOrbY / distOrb) * step;
          s.ang = Math.atan2(toOrbY, toOrbX);
          s.speedRatio = 1.25;
          allArrived = false;
        }
      }

      if (allArrived && (ships.docking || !state.fleets.has(id))) {
        ships.done = true;
        if (!state.fleets.has(id)) finishedSwarms.push(id);
      }
    });

    finishedSwarms.forEach(function (id) {
      state.fleetShips.delete(id);
    });
  }

  function distToSegment(px, py, ax, ay, bx, by) {
    var vx = bx - ax, vy = by - ay;
    var wx = px - ax, wy = py - ay;
    var c1 = vx * wx + vy * wy;
    if (c1 <= 0) return Math.hypot(px - ax, py - ay);
    var c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(px - bx, py - by);
    var t = c1 / c2;
    return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
  }

  function updateFleetPositions(now) {
    var span = Math.max(80, (state.rules && state.rules.tickMs ? state.rules.tickMs * 2.4 : 240));
    state.fleets.forEach(function (f) {
      var k = clamp((now - (f.updatedAt || now)) / span, 0, 1);
      if (f.fromX == null) { f.fromX = f.dx == null ? f.px ?? f.x : f.dx; f.fromY = f.dy == null ? f.py ?? f.y : f.dy; }
      if (f.toX == null) { f.toX = f.x; f.toY = f.y; }
      f.dx = f.fromX + (f.toX - f.fromX) * k;
      f.dy = f.fromY + (f.toY - f.fromY) * k;
    });
  }

  function drawFleets(t) {
    var z = state.cam.zoom;
    var vs = getVisScale();

    // 遍历 state.fleetShips 而非仅遍历 !f.orbiting，确保刚到达星球的舰队尾部飞船依然逐艘丝滑飞入星环，绝不凭空闪现消失！
    state.fleetShips.forEach(function (ships, id) {
      var f = state.fleets.get(id);
      var col = ships.color || (f ? f.color || displayColor(f.owner) : '#6ef7ff');
      var owner = ships.owner || (f ? f.owner : 0);
      var mine = owner === state.selfId;
      var allied = isAlly(owner);
      var isSelected = f && !f.orbiting && (f.id === state.selFleet || f.id === state.inspectFleet);

      if (isSelected && f) {
        var fx = f.dx == null ? f.x : f.dx;
        var fy = f.dy == null ? f.y : f.dy;
        var tx = f.tx != null ? f.tx : fx;
        var ty = f.ty != null ? f.ty : fy;
        var sx = ships.sx != null ? ships.sx : fx;
        var sy = ships.sy != null ? ships.sy : fy;
        ctx.save();
        ctx.lineWidth = 1.6 / z;
        ctx.strokeStyle = rgba(col, 0.32);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(fx, fy); ctx.stroke();
        if (mine || allied) {
          ctx.strokeStyle = rgba(col, 0.60);
          ctx.setLineDash([6 / z, 6 / z]);
          ctx.lineDashOffset = -t * 25 / z;
          ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(tx, ty); ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
      }

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      var activeCount = 0;
      var sumX = 0, sumY = 0;
      for (var i = 0; i < ships.length; i++) {
        var s = ships[i];
        if (s.arrived) continue;
        activeCount++;
        sumX += s.x; sumY += s.y;

        var ang = s.ang != null ? s.ang : 0;
        var ux = Math.cos(ang), uy = Math.sin(ang);
        var nx = -uy, ny = ux;

        // 饱满醒目的流光梭比例（与放大后的星球协调匹配）
        var tailLen = (28 + 14 * clamp(s.speedRatio || 1, 0.4, 1.3)) * vs;
        var headHalfW = 2.6 * vs;
        var tailX = s.x - ux * tailLen, tailY = s.y - uy * tailLen;

        if (state.settings.engineTrails !== false) {
          // 1. 阵营色锥形流光尾迹
          var grad = ctx.createLinearGradient(s.x, s.y, tailX, tailY);
          grad.addColorStop(0, rgba(col, 0.92));
          grad.addColorStop(0.45, rgba(col, 0.44));
          grad.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(s.x + nx * headHalfW, s.y + ny * headHalfW);
          ctx.lineTo(tailX, tailY);
          ctx.lineTo(s.x - nx * headHalfW, s.y - ny * headHalfW);
          ctx.closePath();
          ctx.fill();

          // 2. 饱满星芒光晕
          var glowR = 7.8 * vs;
          var glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
          glow.addColorStop(0, rgba(col, 0.52));
          glow.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(s.x, s.y, glowR, 0, TAU); ctx.fill();
        }

        // 3. 纯白锐利亮芯
        var coreLen = tailLen * 0.46;
        var coreW = 1.25 * vs;
        ctx.fillStyle = 'rgba(255,255,255,0.98)';
        ctx.beginPath();
        ctx.moveTo(s.x + nx * coreW, s.y + ny * coreW);
        ctx.lineTo(s.x - ux * coreLen, s.y - uy * coreLen);
        ctx.lineTo(s.x - nx * coreW, s.y - ny * coreW);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath(); ctx.arc(s.x, s.y, 2.15 * vs, 0, TAU); ctx.fill();
      }
      ctx.restore();

      if (isSelected && activeCount > 0) {
        var cx = sumX / activeCount, cy = sumY / activeCount;
        var fontSize = clamp(12 / Math.max(z, 0.22), 13, 24);
        ctx.save();
        ctx.font = '700 ' + fontSize.toFixed(0) + 'px "SFMono-Regular", Consolas, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = col;
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = 4;
        ctx.fillText(activeCount, cx, cy - 16 * vs);
        ctx.restore();
      }
    });
  }

  function ionSplash(x, y, radius) {
    var n = 72;
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var sp = 90 + Math.random() * 460;
      addParticle({
        x: x + Math.cos(a) * radius * 0.4,
        y: y + Math.sin(a) * radius * 0.4,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 0.9, max: 1.6,
        size: 2 + Math.random() * 5,
        color: i % 3 === 0 ? '#e0fbff' : (i % 3 === 1 ? '#6ef7ff' : '#a78bfa'),
        drag: 0.035, glow: true
      });
    }
    for (var r = 0; r < 4; r++) spawnRing(x, y, r % 2 ? '#a78bfa' : '#6ef7ff', radius * (2.2 + r * 0.9), 1.1 + r * 0.25);
    for (var j = 0; j < 26; j++) {
      var ang = Math.random() * TAU, d = Math.random() * radius * 1.6;
      addParticle({
        x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d,
        vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        life: 2.4 + Math.random() * 2.2, max: 4.6,
        size: 10 + Math.random() * 26,
        color: 'rgba(120,190,255,0.5)', drag: 0.6, glow: false, soft: true
      });
    }
    sfx('battle');
  }

  function addParticle(p) {
    if (state.settings.particles === false) return;
    if (state.particles.length > 900) state.particles.shift();
    state.particles.push(p);
  }

  function spawnRing(x, y, color, size, life) {
    if (state.rings.length > 32) state.rings.shift();
    state.rings.push({ x: x, y: y, r: 6, maxR: size, life: life, maxLife: life, color: color });
  }

  function updateParticles(dt) {
    for (var i = state.particles.length - 1; i >= 0; i--) {
      var p = state.particles[i];
      p.life -= dt;
      if (p.life <= 0) { state.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      var d = Math.pow(p.drag, dt);
      p.vx *= d; p.vy *= d;
    }
    for (var j = state.rings.length - 1; j >= 0; j--) {
      var r = state.rings[j];
      r.life -= dt;
      if (r.life <= 0) { state.rings.splice(j, 1); continue; }
      var tt = 1 - r.life / r.maxLife;
      r.r = 6 + (r.maxR - 6) * (1 - Math.pow(1 - tt, 2));
    }
  }

  function drawParticlesFx() {
    if (state.settings.particles === false) { if (state.particles.length) state.particles.length = 0; if (state.rings.length) state.rings.length = 0; return; }
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      var a = clamp(p.life / p.max, 0, 1);
      if (p.glow) {
        ctx.globalAlpha = a * 0.9;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
        ctx.globalAlpha = a * 0.25;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * 2.4, 0, TAU); ctx.fill();
      } else {
        ctx.globalAlpha = a * (p.soft ? 0.18 : 0.3);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (p.soft ? 1 + (1 - a) * 1.6 : 1), 0, TAU); ctx.fill();
      }
    }
    for (var j = 0; j < state.rings.length; j++) {
      var r = state.rings[j];
      var ra = clamp(r.life / r.maxLife, 0, 1);
      ctx.globalAlpha = ra * 0.85;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2.4 * ra + 0.8;
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawOutposts(t) {
    state.outposts.forEach(function (o) {
      var col = o.owner ? (o.color || displayColor(o.owner)) : 'rgba(160,178,188,.9)';
      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(t * 0.12);
      ctx.beginPath();
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * TAU;
        var px = Math.cos(a) * o.r * 0.72, py = Math.sin(a) * o.r * 0.72;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fillStyle = o.owner ? rgba(col, 0.22) : 'rgba(150,165,175,.12)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.6;
      ctx.stroke();
      ctx.restore();
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 0.22, 0, TAU); ctx.fillStyle = col; ctx.fill();
      for (var k = 0; k < o.level; k++) {
        ctx.beginPath(); ctx.arc(o.x - (o.level - 1) * 7 + k * 14, o.y - o.r * 1.05, 3.4, 0, TAU);
        ctx.fillStyle = col; ctx.fill();
      }
      ctx.textAlign = 'center';
      ctx.font = '700 13px "PingFang SC","Noto Sans SC",sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(2,7,12,.9)';
      ctx.strokeText('停泊点 Lv' + o.level, o.x, o.y - o.r * 1.05 - 12);
      ctx.fillStyle = '#eafcff';
      ctx.fillText('停泊点 Lv' + o.level, o.x, o.y - o.r * 1.05 - 12);
      ctx.font = '600 12px "SFMono-Regular",Consolas,monospace';
      ctx.strokeText(o.troops + '/' + o.cap, o.x, o.y + o.r * 1.05 + 16);
      ctx.fillStyle = 'rgba(220,240,248,.92)';
      ctx.fillText(o.troops + '/' + o.cap, o.x, o.y + o.r * 1.05 + 16);
      if (o.captureProg > 0.01) {
        ctx.strokeStyle = '#ffc766'; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(o.x, o.y, o.r + 7, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(o.captureProg, 0, 1)); ctx.stroke();
      }
    });
  }

  function drawNodes(t) {
    var z = Math.max(state.cam.zoom || 0.35, 0.15);
    var ns = getVisScale();
    var fs = clamp(13 / Math.max(z, 0.22), 14, 38);
    state.nodes.forEach(function (n) {
      var pulse = 0.65 + 0.35 * Math.sin(t * 2.4 + n.id);
      var R = 24 * ns;
      var glowR = (56 + pulse * 18) * ns;
      var glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, glowR);
      glow.addColorStop(0, 'rgba(255,205,110,' + (0.46 * pulse).toFixed(2) + ')');
      glow.addColorStop(0.5, 'rgba(255,176,72,' + (0.18 * pulse).toFixed(2) + ')');
      glow.addColorStop(1, 'rgba(255,199,102,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(n.x, n.y, glowR, 0, TAU); ctx.fill();
      ctx.save();
      ctx.translate(n.x, n.y);
      var f = ['#fff4d6', '#ffd166', '#d98a2b', '#6e4212'];
      ctx.fillStyle = f[0]; ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R * 0.62, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = f[1]; ctx.beginPath(); ctx.moveTo(R * 0.62, 0); ctx.lineTo(0, R); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = f[2]; ctx.beginPath(); ctx.moveTo(0, R); ctx.lineTo(-R * 0.62, 0); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = f[3]; ctx.beginPath(); ctx.moveTo(-R * 0.62, 0); ctx.lineTo(0, -R); ctx.lineTo(0, 0); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(255,245,210,.75)'; ctx.lineWidth = Math.max(1.5, 1.4 / z);
      ctx.beginPath(); ctx.moveTo(0, -R); ctx.lineTo(R * 0.62, 0); ctx.lineTo(0, R); ctx.lineTo(-R * 0.62, 0); ctx.closePath(); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,235,160,' + (0.92 * pulse).toFixed(2) + ')';
      ctx.beginPath(); ctx.arc(0, 0, 6.5 * ns * pulse, 0, TAU); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
      ctx.font = '700 ' + fs.toFixed(0) + 'px "SFMono-Regular",Consolas,monospace';
      ctx.textAlign = 'center';
      ctx.lineWidth = 3.6;
      ctx.strokeStyle = 'rgba(2,7,12,.92)';
      ctx.strokeText('+' + Math.round(n.amount), n.x, n.y + R + fs * 0.95);
      ctx.fillStyle = '#ffd875';
      ctx.fillText('+' + Math.round(n.amount), n.x, n.y + R + fs * 0.95);
    });
  }


  function drawShips(list) {
    for (var i = 0; i < list.length; i++) {
      var s = list[i];
      if (s.dashed) {
        ctx.strokeStyle = 'rgba(160,170,180,.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.stroke();
      } else {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,.55)';
        ctx.beginPath(); ctx.arc(s.x - s.r * 0.3, s.y - s.r * 0.3, s.r * 0.38, 0, TAU); ctx.fill();
        ctx.strokeStyle = rgba(s.color, 0.45);
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 2.6, 0, TAU); ctx.stroke();
      }
    }
  }

  /* ============ Stage 5.3/5.4：全局点击星芒粒子 / 首页三态 / 派遣直输 / 本地远征沙盒 ============ */

  // 5.4 §4.1 全局点击星芒粒子（屏幕空间，任何界面都生效）
  function spawnUiClickBurst(sx, sy) {
    if (state.settings && state.settings.particles === false) return;
    for (var i = 0; i < 12; i++) {
      var a = (i / 12) * TAU + (Math.random() - 0.5) * 0.35;
      var sp = 45 + Math.random() * 115;
      state.uiBursts.push({
        x: sx, y: sy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.28 + Math.random() * 0.18, max: 0.44,
        r: 1.4 + Math.random() * 1.8,
        color: i % 3 === 0 ? '#ffffff' : (i % 2 === 0 ? '#6ef7ff' : '#5bffd8')
      });
    }
    if (state.uiBursts.length > 260) state.uiBursts.splice(0, state.uiBursts.length - 260);
  }
  function getFxCtx() {
    var cv = document.getElementById('fxCanvas');
    if (!cv) return null;
    var w = viewW(), h = viewH(), dpr = state.dpr || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      if (cv.style) { cv.style.position = 'fixed'; cv.style.inset = '0'; cv.style.width = '100%'; cv.style.height = '100%'; }
    }
    if (!cv.__ctx) { try { cv.__ctx = cv.getContext('2d'); } catch (e) { cv.__ctx = null; } }
    return cv.__ctx;
  }
  function updateAndDrawUiBursts(dt) {
    if (!state.uiBursts || !state.uiBursts.length) return;
    var target = getFxCtx(), g = target || ctx;
    try {
      g.save();
      if (target) { g.setTransform(state.dpr || 1, 0, 0, state.dpr || 1, 0, 0); g.clearRect(0, 0, viewW(), viewH()); }
      else g.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
      g.globalCompositeOperation = 'lighter';
      for (var i = state.uiBursts.length - 1; i >= 0; i--) {
        var p = state.uiBursts[i];
        p.life -= dt;
        if (p.life <= 0) { state.uiBursts.splice(i, 1); continue; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.vx *= 0.88; p.vy *= 0.88;
        var alpha = clamp(p.life / p.max, 0, 1);
        g.fillStyle = rgba(p.color, alpha * 0.9);
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.6 + 0.4 * alpha), 0, TAU); g.fill();
      }
      g.restore();
    } catch (e) { try { g.restore(); } catch (e2) {} }
  }
  var LAST_ACTIVE_KEY = 'of.lastActiveAt';
  function touchActive() { try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch (e) {} }
  function lastActiveAt() { var v = Number(storeGet(LAST_ACTIVE_KEY) || 0); return isFinite(v) ? v : 0; }
  function isPortraitView() { return viewH() > viewW(); }
  function resolveHeroStage() {
    if (!portal.session) return 'auth';
    var idle = Date.now() - lastActiveAt();
    return idle > 5 * 60 * 1000 ? 'standby' : 'menu';
  }
  function applyHeroStage() {
    var inHome = portal.view === 'home';
    var inAuth = portal.view === 'auth';
    var isStandby = inHome && state.heroStage === 'standby';
    var isMenu = inHome && state.heroStage === 'menu';

    if (dom.standbyPrompt) dom.standbyPrompt.hidden = !isStandby;
    if (dom.homeMainMenu) dom.homeMainMenu.hidden = !isMenu;
    // 手稿要求：未登录或待机态显示右上角公告；待机态显示右下角退出登录；进入主菜单后其它按钮隐藏
    if (dom.homeNoticeBtn) dom.homeNoticeBtn.hidden = !(inAuth || isStandby);
    if (dom.homeSwitch) dom.homeSwitch.hidden = !isStandby;
    if (dom.homeMainMenu && isMenu) {
      dom.homeMainMenu.classList.remove('fade-in');
      setTimeout(function () { if (dom.homeMainMenu && !dom.homeMainMenu.hidden) dom.homeMainMenu.classList.add('fade-in'); }, 16);
    }
  }
  function enterHeroMenu() {
    state.heroStage = 'menu';
    touchActive();
    applyHeroStage();
    sfx('tab');
  }
  function enterHeroStandby() {
    state.heroStage = 'standby';
    applyHeroStage();
  }
  function syncHeroStage() { state.heroStage = resolveHeroStage(); applyHeroStage(); }
  function showPortraitHintOnce() {
    if (!isPortraitView()) return;
    if (storeGet('of.portraitHinted') === '1') return;
    storeSet('of.portraitHinted', '1');
    // 手稿要求：登录后【弹窗】提示横屏游玩以获得最佳体验（而非一闪而过的 toast）
    showConfirm({
      kicker: 'DISPLAY ORIENTATION · 视口建议',
      title: '建议横屏游玩',
      body: '检测到当前处于竖屏模式，建议旋转设备使用横屏游玩以获得最佳星域视野与操控体验。',
      okText: '我知道了',
      danger: false,
      onOk: function () {}
    });
  }

  // 5.4 §6.2 派遣比例条支持直接输入精确艘数
  function bindDispatchCountInput() {
    if (!dom.dispatchCountInput || dom.dispatchCountInput.__bound) return;
    dom.dispatchCountInput.__bound = true;
    dom.dispatchCountInput.addEventListener('input', function () {
      var pl = planetById(state.selPlanet);
      var avail = (pl && pl.owner === state.selfId) ? Math.max(1, Math.floor(pl.troops || 0)) : 100;
      var n = clamp(Math.floor(Number(dom.dispatchCountInput.value) || 1), 1, avail);
      state.dispatchExactCount = n;
      state.dispatchPct = clamp(n / avail, 0, 1);
      updateDispatchUI();
      updateHints();
    });
    dom.dispatchCountInput.addEventListener('blur', function () {
      if (dom.dispatchCountInput) dom.dispatchCountInput.value = String(currentDispatchCount() || 1);
    });
  }
  function currentDispatchCount() {
    var pl = planetById(state.selPlanet);
    if (!pl || pl.owner !== state.selfId) return null;
    var avail = Math.max(1, Math.floor(pl.troops || 0));
    if (state.dispatchExactCount != null) return clamp(Math.round(state.dispatchExactCount), 1, avail);
    return Math.max(1, Math.round(avail * clamp(state.dispatchPct == null ? 1 : state.dispatchPct, 0, 1)));
  }

  // 5.4 §3.2 本地远征沙盒（纯本地，不连 WebSocket）
  var SANDBOX_RULES = { tickMs: 100, shipSpeed: 340, maxPlayers: 8, warmupMs: 0 };
  function sandboxMsg(html, err) { if (dom.expeditionMsg) { dom.expeditionMsg.innerHTML = html; dom.expeditionMsg.classList.toggle('err', !!err); } }
  function openExpeditionModal() { if (dom.expeditionModal) { dom.expeditionModal.hidden = false; sandboxMsg(''); } }
  function closeExpeditionModal() { if (dom.expeditionModal) closeModalAnimated(dom.expeditionModal); }
  function makeSandboxWorld(seedName) {
    var ps = [], n = 12, W = 12400, H = 8800;
    var classes = ['S', 'M', 'L', 'M', 'S', 'M', 'L', 'S', 'M', 'M', 'S', 'L'];
    for (var i = 0; i < n; i++) {
      var cls = classes[i];
      var rad = cls === 'S' ? 92 : cls === 'M' ? 132 : 182;
      var ang = (i / n) * TAU + 0.4;
      var rr = (i === 0) ? 0 : (2200 + (i % 3) * 900);
      ps.push({
        id: i + 1, x: Math.round(W / 2 + Math.cos(ang) * rr), y: Math.round(H / 2 + Math.sin(ang) * rr),
        r: rad, size: cls, cap: cls === 'S' ? 30 : cls === 'M' ? 45 : 65,
        owner: i === 0 ? 1 : (i < 4 ? 2 : 0), color: i === 0 ? '#5eead4' : (i < 4 ? '#fb7185' : ''),
        troops: i === 0 ? 22 : (i < 4 ? 14 : Math.floor(6 + (i % 5) * 3)),
        resource: 120, maxResource: 180, purityProg: i < 4 ? 1 : 0, captureProg: 0, captureBy: 0,
        destroyTimer: 0, name: (seedName || '演习') + '-' + String.fromCharCode(65 + i),
        hue: 190, isOutpost: false, exhausted: false, reinforce: true
      });
    }
    return { world: { w: W, h: H }, planets: ps, players: [
      { id: 1, name: '你', color: '#5eead4', bot: false, online: true, coalition: 0, resource: 60, homePlanet: 1 },
      { id: 2, name: '演习 AI', color: '#fb7185', bot: true, online: true, coalition: 0, resource: 60, homePlanet: 2 }
    ], fleets: [], nodes: [], rules: SANDBOX_RULES };
  }
  function startSandbox(data, label) {
    try {
      state.players.clear(); state.planets.clear(); state.fleets.clear(); state.nodes.clear(); state.fleetShips.clear();
      (data.players || []).forEach(function (p) { state.players.set(p.id, p); });
      (data.planets || []).forEach(function (p) { state.planets.set(p.id, p); });
      (data.fleets || []).forEach(function (f) { state.fleets.set(f.id, f); });
      (data.nodes || []).forEach(function (nd) { state.nodes.set(nd.id, nd); });
      if (data.world) state.world = { w: data.world.w || 12400, h: data.world.h || 8800 };
      state.rules = Object.assign({}, SANDBOX_RULES, data.rules || {});
      state.selfId = 1; state.sandbox = true;
      state.selPlanet = 1; state.selFleet = 0; state.inspectPlanet = 0;
      state.mode = 'game'; state.camInit = false;
      state.joined = true; state.connected = false;
      if (dom.start) dom.start.hidden = true;
      if (dom.hud) dom.hud.hidden = false;
      syncSandboxMenu();
      closeExpeditionModal();
      if (!state.stars) buildStars();
      try { placeCamera(); } catch (e) {}
      toast('本地远征已启动 · ' + (label || '演习星域') + '（导出存档见菜单）');
      renderAll();
    } catch (e) {
      sandboxMsg('装载失败：' + (e && e.message ? e.message : e), true);
    }
  }

  /* ---- 5.5 修复3：本地远征沙盒引擎（派兵/占领/补充/销毁/本地 AI） ---- */
  function handleSandboxIntent(obj) {
    if (!obj || !state.sandbox) return false;
    if (obj.t === 'launch') {
      var src = state.planets.get(Number(obj.src)), tgt = state.planets.get(Number(obj.target));
      if (!src || !tgt || src.owner !== state.selfId) return false;
      var avail = Math.floor(src.troops || 0);
      var n = clamp(Math.round(Number(obj.n) || 1), 1, avail);
      if (n < 1) return false;
      src.troops -= n;
      spawnSandboxFleet(state.selfId, src, tgt, n);
      sfx('order');
      toast('舰队已出征 · ' + n + ' 艘');
      return true;
    }
    if (obj.t === 'reinforce') {
      var pl = state.planets.get(Number(obj.id));
      if (pl && pl.owner === state.selfId) { pl.reinforce = !!obj.on; renderAll(); return true; }
    }
    if (obj.t === 'destroy') {
      var dp = state.planets.get(Number(obj.id));
      if (dp && dp.owner === state.selfId && dp.troops >= 15) { dp.destroyTimer = 8.0; toast('摧毁读条开始'); return true; }
    }
    if (obj.t === 'gather') { toast('本地远征不提供资源点采集'); return true; }
    return true;
  }
  function spawnSandboxFleet(ownerId, srcPl, tgtPl, n) {
    var owner = state.players.get(ownerId);
    var fid = (state._sbNextFid = (state._sbNextFid || 100) + 1);
    var ddx = tgtPl.x - srcPl.x, ddy = tgtPl.y - srcPl.y, dl = Math.hypot(ddx, ddy) || 1;
    var sx = srcPl.x + (ddx / dl) * (srcPl.r * 1.35);
    var sy = srcPl.y + (ddy / dl) * (srcPl.r * 1.35);
    var f = {
      id: fid, owner: ownerId, color: owner ? owner.color : '#5eead4',
      n: n, x: sx, y: sy, dx: sx, dy: sy, fromX: sx, fromY: sy, toX: sx, toY: sy,
      startX: sx, startY: sy, tx: tgtPl.x, ty: tgtPl.y,
      srcPlanet: srcPl.id, target: tgtPl.id, targetPlanet: tgtPl.id,
      orbiting: 0, updatedAt: performance.now()
    };
    state.fleets.set(fid, f);
  }
  function stepSandboxSimulation(dt) {
    if (!state.sandbox || state.mode !== 'game') return;
    // 1. 星球自动补充飞船与摧毁读条
    state.planets.forEach(function (pl) {
      if (pl.owner && pl.reinforce && !pl.exhausted && pl.troops < pl.cap && pl.resource > 0) {
        var gain = Math.min(pl.cap - pl.troops, pl.resource, dt * 1.1);
        pl.troops += gain;
        pl.resource = Math.max(0, pl.resource - gain);
        if (pl.resource <= 0) pl.exhausted = true;
      }
      if (pl.destroyTimer > 0) {
        pl.destroyTimer -= dt;
        if (pl.destroyTimer <= 0) {
          try { ionSplash(pl.x, pl.y, pl.r); } catch (e) {}
          state.planets.delete(pl.id);
        }
      }
    });
    // 2. 舰队飞行与抵达结算
    var speed = (state.rules && state.rules.shipSpeed) || 340;
    state.fleets.forEach(function (f, fid) {
      var tgt = state.planets.get(f.target || f.targetPlanet);
      if (!tgt) { state.fleets.delete(fid); return; }
      var dx = tgt.x - f.x, dy = tgt.y - f.y, d = Math.hypot(dx, dy);
      var arriveR = tgt.r * 1.28 + 4;
      if (d <= arriveR) {
        if (tgt.owner === f.owner) {
          tgt.troops = Math.min(tgt.cap, tgt.troops + f.n);
        } else {
          tgt.troops -= f.n;
          if (tgt.troops < 0) {
            tgt.owner = f.owner;
            tgt.color = displayColor(f.owner);
            tgt.troops = Math.min(tgt.cap, Math.abs(tgt.troops));
            tgt.purityProg = 1;
            sfx(f.owner === state.selfId ? 'capture' : 'lost');
          } else {
            sfx('battle');
          }
        }
        state.fleets.delete(fid);
      } else {
        var step = Math.min(d, speed * dt);
        f.x += (dx / d) * step; f.y += (dy / d) * step;
        f.dx = f.x; f.dy = f.y; f.fromX = f.x; f.fromY = f.y; f.toX = f.x; f.toY = f.y;
      }
    });
    // 3. 演习 AI 每 4.5 秒自动调度出征
    state._sbAiAcc = (state._sbAiAcc || 0) + dt;
    if (state._sbAiAcc >= 4.5) {
      state._sbAiAcc = 0;
      var aiPlanets = [];
      var targets = [];
      state.planets.forEach(function (p) {
        if (p.owner === 2 && p.troops >= 16) aiPlanets.push(p);
        else if (p.owner !== 2) targets.push(p);
      });
      if (aiPlanets.length && targets.length) {
        var sp = aiPlanets[Math.floor(Math.random() * aiPlanets.length)];
        targets.sort(function (a, b) { return Math.hypot(a.x - sp.x, a.y - sp.y) - Math.hypot(b.x - sp.x, b.y - sp.y); });
        var tp = targets[0];
        var sendN = Math.max(1, Math.floor(sp.troops * 0.55));
        sp.troops -= sendN;
        spawnSandboxFleet(2, sp, tp, sendN);
      }
      renderAll();
    }
  }

  function expeditionStartDefault() {
    startSandbox(makeSandboxWorld('演习'), '标准演习星域');
  }
  function expeditionLoadFile(file) {
    if (!file) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        var data = JSON.parse(String(fr.result || '{}'));
        if (!data || (!data.planets && !data.world)) { sandboxMsg('文件缺少 world / planets 字段，无法解析', true); return; }
        if (!data.planets || !data.planets.length) data.planets = makeSandboxWorld('导入').planets;
        if (!data.players || !data.players.length) data.players = makeSandboxWorld('导入').players;
        startSandbox(data, file.name);
      } catch (e) { sandboxMsg('JSON 解析失败：' + (e && e.message ? e.message : e), true); }
    };
    fr.onerror = function () { sandboxMsg('读取文件失败', true); };
    fr.readAsText(file);
  }
  function exportSandboxSave() {
    try {
      var out = {
        world: state.world, rules: state.rules,
        planets: Array.from(state.planets.values()).map(function (p) { var o = Object.assign({}, p); delete o._visCap; delete o._visPur; delete o._ringShares; delete o._fadeAt; return o; }),
        players: Array.from(state.players.values()),
        fleets: Array.from(state.fleets.values()),
        nodes: Array.from(state.nodes.values()),
        exportedAt: new Date().toISOString()
      };
      var blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'orbital-frontier-save-' + Date.now() + '.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
      toast('本地存档已导出');
    } catch (e) { toast('导出失败：' + (e && e.message ? e.message : e), true); }
  }
  function bindExpedition() {
    if (dom.homeExpedition && !dom.homeExpedition.__bound) {
      dom.homeExpedition.__bound = true;
      dom.homeExpedition.addEventListener('click', function () {
        showConfirm({
          kicker: 'LOCAL EXPEDITION', title: '前往远征',
          body: '网页端暂不支持关卡和云存档，仅支持本地存档/关卡文件解析，确认进入吗？',
          okText: '确认进入', danger: false,
          onOk: function () { openExpeditionModal(); }
        });
      });
    }
    if (dom.expeditionStartDefault && !dom.expeditionStartDefault.__bound) {
      dom.expeditionStartDefault.__bound = true;
      dom.expeditionStartDefault.addEventListener('click', expeditionStartDefault);
    }
    if (dom.expeditionFileInput && !dom.expeditionFileInput.__bound) {
      dom.expeditionFileInput.__bound = true;
      dom.expeditionFileInput.addEventListener('change', function () {
        var f = dom.expeditionFileInput.files && dom.expeditionFileInput.files[0];
        expeditionLoadFile(f);
      });
    }
    if (dom.expeditionClose && !dom.expeditionClose.__bound) {
      dom.expeditionClose.__bound = true;
      dom.expeditionClose.addEventListener('click', closeExpeditionModal);
    }
    if (dom.standbyPrompt && !dom.standbyPrompt.__bound) {
      dom.standbyPrompt.__bound = true;
      dom.standbyPrompt.addEventListener('click', function (e) { e.stopPropagation(); enterHeroMenu(); });
    }
    if (dom.homeNoticeBtn && !dom.homeNoticeBtn.__bound) {
      dom.homeNoticeBtn.__bound = true;
      dom.homeNoticeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var txt = (portal.announcement || (portal.profile && portal.profile.announcement) || '').trim();
        showConfirm({ kicker: 'SECTOR NOTICE', title: '星域公告', body: txt || '暂无新的星域公告。', okText: '知道了', danger: false, onOk: function () {} });
      });
    }
  }
  function syncSandboxMenu() {
    var b = document.getElementById('menuExportSave');
    if (b) b.hidden = !state.sandbox;
  }
  function bindStage53UI() {
    bindDispatchCountInput();
    bindExpedition();
    if (!state.uiBurstBound) {
      state.uiBurstBound = true;
      document.addEventListener('pointerdown', function (e) { spawnUiClickBurst(e.clientX, e.clientY); }, { passive: true });
    }
    // 空白处点击必须绑在全屏 #startScreen（#homeView 高度可能为 0）
    if (dom.start && !dom.start.__stageBound) {
      dom.start.__stageBound = true;
      dom.start.addEventListener('click', function (e) {
        if (portal.view !== 'home' || state.heroStage !== 'standby') return;
        var t = e.target;
        if (t && t.closest && (t.closest('button') || t.closest('input') || t.closest('.confirm-card') || t.closest('.panel'))) return;
        enterHeroMenu();
      });
    }
  }

  function render() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - state.lastFrame) / 1000) || 0.016;
    state.lastFrame = now;
    state.t += dt;
    var t = state.t;
    state._fpsFrames = (state._fpsFrames || 0) + 1; state._fpsAcc = (state._fpsAcc || 0) + dt;
    if (state._fpsAcc >= 0.5) {
      state.fps = Math.round(state._fpsFrames / state._fpsAcc); state._fpsFrames = 0; state._fpsAcc = 0;
      if (dom.fpsBadge) { dom.fpsBadge.hidden = !state.settings.showFps; if (state.settings.showFps) dom.fpsBadge.textContent = state.fps + ' FPS · ' + (state.ping || '--') + 'ms'; }
    }
    applyDragEdgeScroll(dt);   // C1：拖拽派遣时按屏边距离平滑滚屏
    updateCamera(dt);
    updateFleetPositions(now);
    updateFleetShips(dt, now);
    updateParticles(dt);
    stepSandboxSimulation(dt);
    if (state.mode === 'start') {
      renderPanorama(t, dt);
      updateAndDrawUiBursts(dt);
      requestAnimationFrame(render);
      return;
    }
    drawBackdrop(t);
    var w = viewW(), h = viewH(), z = state.cam.zoom;
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(z, z);
    ctx.translate(-state.cam.x, -state.cam.y);
    drawNodes(t);
    var __vw = w / z, __vh = h / z;
    var __vL = state.cam.x - __vw / 2 - 260, __vR = state.cam.x + __vw / 2 + 260;
    var __vT = state.cam.y - __vh / 2 - 260, __vB = state.cam.y + __vh / 2 + 260;
    state.planets.forEach(function (pl) {
      if (pl._fadeAt == null) pl._fadeAt = performance.now();
      var __out = (pl.x < __vL || pl.x > __vR || pl.y < __vT || pl.y > __vB);
      var __tc = pl.captureProg || 0, __tp = (pl.purityProg == null ? (pl.owner ? 1 : 0) : pl.purityProg);
      if (pl._visCap == null || Math.abs(__tc - pl._visCap) > 0.35) pl._visCap = __tc; else if (__out) pl._visCap += (__tc - pl._visCap) * 0.14;
      if (pl._visPur == null || Math.abs(__tp - pl._visPur) > 0.35) pl._visPur = __tp; else if (__out) pl._visPur += (__tp - pl._visPur) * 0.14;
      if (__out) return;   // J3：视锥剔除，跳过屏外星绘制
      var fade = clamp((performance.now() - pl._fadeAt) / 600, 0, 1);
      var back = [], front = [];
      collectOrbitShips3D(pl, t, back, front, fade);
      drawOrbitShipBatch(back);
      drawPlanet(pl, t);
      drawOrbitShipBatch(front);
    });
    drawFleets(t);
    drawParticlesFx();
    ctx.restore();
    ModSandbox.runHudHooks(ctx, t);   // Task G：Mod HUD 渲染钩子（屏幕空间）
    updateHexMenu();
    updateJointCountdowns();
    drawDragOrder(t);
    updateMailCountdowns();
    if (state.pointer.type === 'mouse' && state.pointer.x) {
      var wpt = screenToWorld(state.pointer.x, state.pointer.y);
      ctx.save();
      ctx.translate(w / 2, h / 2); ctx.scale(z, z); ctx.translate(-state.cam.x, -state.cam.y);
      ctx.strokeStyle = 'rgba(160,240,255,.3)';
      ctx.lineWidth = 1 / z;
      ctx.beginPath(); ctx.arc(wpt.x, wpt.y, 10 / z, 0, TAU); ctx.stroke();
      ctx.restore();
    }
    drawMinimap();
    updateAndDrawUiBursts(dt);
    updateHudClock();
    requestAnimationFrame(render);
  }

  var lastMinimapAt = 0;
  function updateHudClock() {
    var now = performance.now();
    if (state.mode !== 'game') return;
    if (now - lastMinimapAt < 100) return;
    lastMinimapAt = now;
    var zEl = document.getElementById('minimapZoom');
    if (zEl) zEl.textContent = Math.round(state.cam.zoom * 100) + '%';
  }

  /* ---------------- minimap ---------------- */
  function drawMinimap() {
    var mc = dom.minimap;
    if (!mc) return;
    var w = mc.width, h = mc.height;
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = 'rgba(2,7,13,.92)';
    mctx.fillRect(0, 0, w, h);
    var pad = 4;
    var sx = (w - pad * 2) / state.world.w, sy = (h - pad * 2) / state.world.h;
    var sc = Math.min(sx, sy);
    var ox = (w - state.world.w * sc) / 2, oy = (h - state.world.h * sc) / 2;
    var mx = function (x) { return ox + x * sc; }, my = function (y) { return oy + y * sc; };
    mctx.strokeStyle = 'rgba(110,247,255,.2)';
    mctx.strokeRect(ox, oy, state.world.w * sc, state.world.h * sc);
    mctx.fillStyle = 'rgba(255,199,102,.7)';
    state.nodes.forEach(function (n) { mctx.fillRect(mx(n.x) - 1, my(n.y) - 1, 2, 2); });
    state.planets.forEach(function (p) {
      var px = mx(p.x), py = my(p.y);
      if (p.owner) {
        mctx.fillStyle = p.color || displayColor(p.owner);
        mctx.beginPath(); mctx.arc(px, py, Math.max(2.5, p.r * sc), 0, TAU); mctx.fill();
      } else {
        mctx.strokeStyle = 'rgba(150,165,175,.8)';
        mctx.lineWidth = 1;
        mctx.beginPath(); mctx.arc(px, py, Math.max(2, p.r * sc), 0, TAU); mctx.stroke();
      }
      if (p.id === state.selPlanet) {
        mctx.strokeStyle = '#fff';
        mctx.lineWidth = 1.4;
        mctx.strokeRect(px - 5, py - 5, 10, 10);
      }
    });
    state.fleets.forEach(function (f) {
      if (f.orbiting) return;
      var fx = f.dx != null ? f.dx : f.x, fy = f.dy != null ? f.dy : f.y;
      mctx.fillStyle = f.color || displayColor(f.owner);
      mctx.fillRect(mx(fx) - 1.5, my(fy) - 1.5, 3, 3);
    });
    // viewport rectangle
    var vw = viewW() / state.cam.zoom, vh = viewH() / state.cam.zoom;
    mctx.strokeStyle = 'rgba(255,255,255,.75)';
    mctx.lineWidth = 1.2;
    mctx.strokeRect(mx(state.cam.x - vw / 2), my(state.cam.y - vh / 2), vw * sc, vh * sc);
  }

  /* ---------------- input ---------------- */
  function pickAt(sx, sy) {
    var wp = screenToWorld(sx, sy);
    var z = state.cam.zoom;
    // 1. 星球优先级最高：点击星球绝不会被途经的航线或驻留舰队劫持
    var bestPl = null, bpD = Infinity;
    state.planets.forEach(function (p) {
      var d = dist(wp.x, wp.y, p.x, p.y);
      if (d < p.r + 28 / z && d < bpD) { bpD = d; bestPl = p; }
    });
    if (bestPl) return { kind: 'planet', id: bestPl.id };

    // 2. 资源节点次之（匹配放大后的晶簇体积，手机单指点击更轻松）
    var bestNode = null, bnD = 44 / z;
    state.nodes.forEach(function (n) {
      var d = dist(wp.x, wp.y, n.x, n.y);
      if (d < bnD) { bnD = d; bestNode = n; }
    });
    if (bestNode) return { kind: 'node', id: bestNode.id };

    // 3. 仅检测正在飞行中的非零舰队实体（排除已入轨或 0 艘僵尸舰队，且不再把整条起止连线当作碰撞盒）
    var bestFleet = null, bfD = 28 / z;
    state.fleets.forEach(function (f) {
      if (f.orbiting || (f.n || 0) < 1) return;
      var hx = (f.dx == null ? f.x : f.dx), hy = (f.dy == null ? f.y : f.dy);
      var d = dist(wp.x, wp.y, hx, hy);
      var ships = state.fleetShips.get(f.id);
      if (ships && ships.length) {
        for (var i = 0; i < ships.length; i++) {
          if (ships[i].arrived) continue;
          d = Math.min(d, dist(wp.x, wp.y, ships[i].x, ships[i].y));
        }
      }
      if (d < bfD) { bfD = d; bestFleet = f; }
    });
    if (bestFleet) return { kind: 'fleet', id: bestFleet.id };
    return null;
  }

  function handleTap(sx, sy) {
    var hit = pickAt(sx, sy);
    var now = performance.now();
    if (!hit) { state.lastClick = { id: '', t: 0 }; dismissHexMenu(); return; }
    var key = hit.kind + ':' + hit.id;
    var dbl = state.lastClick.id === key && now - state.lastClick.t < 460;
    state.lastClick = { id: key, t: now };

    if (hit.kind === 'planet') {
      state.hexDismissed = false;   // B2：点击任意星球重新展开六边形按钮
      var pl = state.planets.get(hit.id);
      var srcId = state.orderSrc || (state.selPlanet && (state.planets.get(state.selPlanet) || {}).owner === state.selfId ? state.selPlanet : 0);
      var srcPlanet = srcId ? state.planets.get(srcId) : null;

      // selected fleet can be re-aimed anywhere, any time
      if (dbl && state.selFleet && state.fleets.has(state.selFleet)) {
        clearTimeout(state.tapSelectTimer);
        sendIntent({ t: 'retarget', fleet: state.selFleet, target: hit.id });
        toast('舰队改道 · ' + (pl ? pl.name : ''));
        sfx('order');
        return;
      }

      if (dbl) {
        // double tap on ANY other world of ours = gather troops there; on a foreign world = attack
        if (srcPlanet && srcPlanet.owner === state.selfId && srcPlanet.id !== hit.id) {
          orderLaunch(srcPlanet.id, hit.id);
          return;
        }
        // double tapping the source itself: just focus it
        if (pl.owner === state.selfId) { selectPlanet(hit.id); focusPlanet(hit.id); }
        else { state.inspectPlanet = hit.id; updateOrderPanel(); }
        sfx('click');
        return;
      }

      // single tap: deferred selection, so a following tap becomes a true double tap
      clearTimeout(state.tapSelectTimer);
      var tapId = hit.id;
      var tapOwn = pl.owner === state.selfId;
      state.tapSelectTimer = setTimeout(function () {
        var tp2 = state.planets.get(tapId);
        if (!tp2) return;
        if (tapOwn) {
          state.inspectPlanet = 0;
          selectPlanet(tapId);
          focusPlanet(tapId);
        } else {
          state.selPlanet = 0;
          state.selFleet = 0;
          state.inspectPlanet = tapId;
          updateOrderPanel();
        }
        sfx('click');
      }, 260);
      return;
    }
    if (hit.kind === 'fleet') { clickFleet(hit.id); return; }
    if (hit.kind === 'node') { clickNodeSafe(hit.id); return; }
  }

  // tapping a node is a gather order for the selected world; otherwise show what it is
  function clickNodeSafe(id) {
    var node = state.nodes.get(id);
    if (!node) return;
    // the server picks the closest own world with ships: one tap is enough
    if (sendIntent({ t: 'gather', node: id })) { toast('已派出最近的采集舰队'); sfx('order'); }
  }

  function dbg() { if (state.debug) { try { console.log.apply(console, arguments); } catch (e) {} } }

  function bindInput() {
    if (state.inputBound) return;
    state.inputBound = true;
    state.pointers = state.pointers || new Map();
    state.pinch = null;
    state.pointer = state.pointer || { down: false, moved: false, sx: 0, sy: 0, cx: 0, cy: 0, id: 0, type: 'mouse', x: 0, y: 0 };
    state.debug = /(^|[?&])debug=1/.test(location.search);
    // native fallbacks: touch and mouse events are always wired in case pointer events are missing
    canvas.addEventListener('touchstart', function (e) {
      dbg('touchstart', e.touches.length);
      state.longPressFired = false;
      if (e.touches.length === 1) startLongPress(e.touches[0].clientX, e.touches[0].clientY);
      if (e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        state.pinch = { d: Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), zoom: state.cam.zoom, cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 };
        state.pointer.down = false;
      } else if (e.touches.length === 1) {
        var t0 = e.touches[0];
        state.pointer = { down: true, moved: false, sx: t0.clientX, sy: t0.clientY, cx: t0.clientX, cy: t0.clientY, id: 'touch', type: 'touch', x: t0.clientX, y: t0.clientY };
        state.dragOrder = null;
      }
      e.preventDefault();
    }, { passive: false });
    canvas.addEventListener('touchmove', function (e) {
      e.preventDefault();
      if (state.pinch && e.touches.length === 2) {
        var a = e.touches[0], b = e.touches[1];
        var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        var mx = (a.clientX + b.clientX) / 2, my = (a.clientY + b.clientY) / 2;
        if (d > 4) zoomAt(mx, my, (state.pinch.zoom * (d / state.pinch.d)) / state.cam.zoom);
        state.cam.tx -= (mx - state.pinch.cx) / state.cam.zoom;
        state.cam.ty -= (my - state.pinch.cy) / state.cam.zoom;
        state.pinch.cx = mx; state.pinch.cy = my;
        clampCam();
        state.cam.x = state.cam.tx; state.cam.y = state.cam.ty;
        dbg('pinch', d.toFixed(0), 'zoom', state.cam.zoom.toFixed(2));
        return;
      }
      if (!state.pointer.down || !e.touches.length) return;
      var t1 = e.touches[0];
      dragTo(t1.clientX, t1.clientY);
    }, { passive: false });
    canvas.addEventListener('touchend', function (e) {
      clearTimeout(state.longPressTimer);
      dbg('touchend', e.touches.length, 'moved', state.pointer.moved);
      if (e.touches.length < 2) state.pinch = null;
      if (!state.pointer.down) return;
      if (e.touches.length === 0) {
        state.pointer.down = false;
        if (state.dragOrder && state.dragOrder.active) { finishDragOrder(state.pointer.x, state.pointer.y); state.longPressFired = false; return; }
        if (!state.pointer.moved && !state.longPressFired) handleTap(state.pointer.sx, state.pointer.sy);
      state.longPressFired = false;
      }
    }, { passive: false });
    canvas.addEventListener('touchcancel', function () { state.pinch = null; state.pointer.down = false; state.dragOrder = null; }, { passive: false });
    canvas.addEventListener('mousedown', function (e) {
      if (state.pointer.down) return;
      state.pointer = { down: true, moved: false, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, id: 'mouse', type: 'mouse', x: e.clientX, y: e.clientY };
      state.dragOrder = null;
    });
    window.addEventListener('mousemove', function (e) {
      if (!state.pointer.down || state.pointer.type !== 'mouse') return;
      dragTo(e.clientX, e.clientY);
    });
    window.addEventListener('mouseup', function (e) {
      if (!state.pointer.down || state.pointer.type !== 'mouse') return;
      state.pointer.down = false;
      if (state.dragOrder && state.dragOrder.active) { finishDragOrder(e.clientX, e.clientY); return; }
      if (!state.pointer.moved) handleTap(e.clientX, e.clientY);
    });
    canvas.addEventListener('dragstart', function (e) { e.preventDefault(); });
    bindPointerGestures();
    bindKeyboardAndMenus();
    bindZoomButtons();
  }

  function dragTo(x, y) {
    clearTimeout(state.longPressTimer);
    if (state.probe) state.probe.drag = (state.probe.drag || 0) + 1;
    var dx = x - state.pointer.sx, dy = y - state.pointer.sy;
    if (!state.pointer.moved && dx * dx + dy * dy > 36) state.pointer.moved = true;
    // C1：拖拽派遣进行中 → 不平移镜头
    if (state.dragOrder && state.dragOrder.active) { updateDragOrder(x, y); return; }
    // C1：起手为有己方可用兵力的星球（含己方星球或停有己方协防舰队的星球）→ 进入拖拽派遣
    if (state.pointer.moved && !state.dragOrder) {
      var hit0 = pickAt(state.pointer.sx, state.pointer.sy);
      if (hit0 && hit0.kind === 'planet') {
        var sp0 = state.planets.get(hit0.id);
        if (sp0 && dragEligible(sp0)) {
          state.dragOrder = { srcId: sp0.id, x: x, y: y, active: true };
          updateDragOrder(x, y);
          sfx('click');
          return;
        }
      }
    }
    if (!state.pointer.moved) return;
    state.cam.tx -= (x - state.pointer.cx) / state.cam.zoom;
    state.cam.ty -= (y - state.pointer.cy) / state.cam.zoom;
    clampCam();
    state.cam.x = state.cam.tx;
    state.cam.y = state.cam.ty;
    state.pointer.cx = x;
    state.pointer.cy = y;
  }

  function zoomAt(clientX, clientY, factor) {
    if (state.probe) state.probe.zoomIn = (state.probe.zoomIn || 0) + 1;
    var before = screenToWorld(clientX, clientY);
    state.cam.zoom = clamp(state.cam.zoom * factor, minZoom(), 1.8);
    clampCam();
    var after = screenToWorld(clientX, clientY);
    state.cam.tx += before.x - after.x;
    state.cam.ty += before.y - after.y;
    clampCam();
    state.cam.x = state.cam.tx;
    state.cam.y = state.cam.ty;
  }

  // pointer events: second path in case touch events are unreliable on the device
  // Only real pointers on the stage should move the camera; panels, buttons and the minimap keep their own input.
  function isUiTarget(t) {
    if (!t || t === canvas || t === document.body || t === document.documentElement) return false;
    return !!(t.closest && t.closest('.panel, .hud-menu, .dialog, .zoom-ctl, #minimap, #minimapWrap, button, input, textarea, #startScreen'));
  }

  // long press on the map = quick diplomacy with the world's owner
  var pendingPactRequest = null;

  function showOutpostPicker(sx, sy) {
    var wp = screenToWorld(sx, sy);
    if (wp.x < 120 || wp.y < 120 || wp.x > state.world.w - 120 || wp.y > state.world.h - 120) { toast('超出星域边界'); return; }
    var me = selfPlayer();
    var res = me ? Math.round(me.resource) : 0;
    var levels = (state.rules && state.rules.outpostLevels) || [
      { level: 1, cost: 80, cap: 12 }, { level: 2, cost: 200, cap: 24 }, { level: 3, cost: 420, cap: 40 }
    ];
    state.factionView = -1;
    dom.orderPanel.hidden = false;
    dom.orderPanel.classList.remove('collapsed');
    dom.opKicker.textContent = 'OUTPOST · 建立停泊点';
    dom.opTitle.textContent = '停泊点';
    dom.opTags.innerHTML = '<span class="tag">X ' + Math.round(wp.x) + ' / Y ' + Math.round(wp.y) + '</span><span class="tag">资源 ' + res + '</span>';
    dom.opStats.innerHTML = '';
    dom.opBars.innerHTML = '';
    dom.sliderBlock.hidden = true;
    dom.opProgress.hidden = true;
    dom.opActions.innerHTML = levels.map(function (l) {
      return '<button class="btn ' + (res >= l.cost ? 'primary' : '') + ' wide" data-out="' + l.level + '"' + (res < l.cost ? ' disabled' : '') + '>Lv' + l.level + ' · ' + l.cost + ' 资源 · 上限 ' + l.cap + '</button>';
    }).join('') + '<button class="btn wide" data-out="cancel">取消</button>';
    dom.opNote.textContent = '停泊点任何势力都可以占领，可以停放舰队，也能在没有落脚点时保住席位。';
    dom.opActions.onclick = function (ev) {
      var btn = ev.target.closest('[data-out]');
      if (!btn) return;
      var v = btn.getAttribute('data-out');
      dom.opActions.onclick = null;
      state.factionView = 0;
      dom.orderPanel.hidden = true;
      if (v !== 'cancel') sendIntent({ t: 'outpost', level: Number(v), x: Math.round(wp.x), y: Math.round(wp.y) });
    };
    sfx('click');
  }

  function showPactRequest(msg) {
    state.factionView = -1;
    dom.orderPanel.hidden = false;
    dom.orderPanel.classList.remove('collapsed');
    dom.opKicker.textContent = 'ALLIANCE REQUEST · 结盟请求';
    dom.opTitle.textContent = msg.fromName || '对方指挥官';
    dom.opTags.innerHTML = '<span class="tag ex">请求结盟</span>';
    dom.opStats.innerHTML = '<div class="stat"><span>对方消耗</span><b>' + (msg.cost || 40) + ' 资源</b></div>';
    dom.opBars.innerHTML = '';
    dom.sliderBlock.hidden = true;
    dom.opProgress.hidden = true;
    dom.opActions.innerHTML = '<button class="btn primary wide" data-pact="yes">同意结盟</button>'
      + '<button class="btn wide" data-pact="no">拒绝</button>';
    dom.opNote.textContent = '同意后对方会派出社交舰队抵达你的主星，随后双方显示同一颜色。';
    dom.opActions.onclick = function (ev) {
      var btn = ev.target.closest('[data-pact]');
      if (!btn) return;
      var yes = btn.getAttribute('data-pact') === 'yes';
      dom.opActions.onclick = null;
      state.factionView = 0;
      dom.orderPanel.hidden = true;
      sendIntent({ t: 'pactRespond', from: msg.from, accept: yes });
      pendingPactRequest = null;
    };
    sfx('pact');
    toast('收到来自 ' + (msg.fromName || '对方') + ' 的结盟请求');
  }

  function startLongPress(sx, sy) {
    clearTimeout(state.longPressTimer);
    state.longPressTimer = setTimeout(function () {
      // a little finger drift is normal: only a real drag cancels
      var moved = Math.hypot((state.pointer.x || sx) - sx, (state.pointer.y || sy) - sy);
      if (moved > 20) return;
      var hit = pickAt(sx, sy);
      if (!hit) { state.longPressFired = true; showOutpostPicker(sx, sy); return; }
      if (hit.kind !== 'planet') return;
      var pl = state.planets.get(hit.id);
      if (!pl || !pl.owner) return;
      if (pl.owner === state.selfId) {
        // own world: long press = destroy (needs 15+ ships and another place to park)
        if (pl.troops >= 15) {
          state.longPressFired = true;
          destroyPlanet(pl);
        } else {
          toast('驻军需 ≥ 15 才能摧毁');
        }
        return;
      }
      state.longPressFired = true;
      openDiploPanel(pl);
      sfx('click');
    }, 480);
  }

  function showDiplomacyConfirm(ownerId) {
    var p = state.players.get(ownerId);
    var me = selfPlayer();
    if (!p || !me) return;
    var allied = isAlly(ownerId);
    var cost = (state.rules && state.rules.socialCost) || 40;
    state.factionView = ownerId;
    dom.orderPanel.hidden = false;
    dom.orderPanel.classList.remove('collapsed');
    dom.opKicker.textContent = allied ? 'ALLIANCE · 已结盟' : 'DIPLOMACY · 外交接触';
    dom.opTitle.textContent = p.name;
    dom.opTags.innerHTML = '<span class="tag ' + (allied ? 'own' : 'ex') + '">' + (allied ? '盟友' : '尚未结盟') + '</span>'
      + (p.shielded ? '<span class="tag warn">保护期 ' + p.shieldIn + 's</span>' : '');
    dom.opStats.innerHTML =
      '<div class="stat"><span>星球</span><b>' + countPlanets(ownerId) + '</b></div>' +
      '<div class="stat"><span>飞船</span><b>' + countShips(ownerId) + '</b></div>' +
      '<div class="stat"><span>我的能量</span><b>' + Math.round(me.resource) + '</b></div>' +
      '<div class="stat"><span>结盟消耗</span><b>' + (allied ? '—' : cost) + '</b></div>';
    dom.opBars.innerHTML = '';
    dom.sliderBlock.hidden = true;
    dom.opProgress.hidden = true;
    if (allied) {
      dom.opActions.innerHTML = '<button class="btn danger wide" data-dip="break">确认解除盟约</button>'
        + '<button class="btn wide" data-dip="cancel">取消</button>';
      dom.opNote.textContent = '解除后各自恢复本阵营颜色；滞留在对方星球的舰队会自动撤回。';
    } else {
      dom.opActions.innerHTML = '<button class="btn primary wide" data-dip="ally">确认结盟（消耗 ' + cost + ' 能量）</button>'
        + '<button class="btn wide" data-dip="cancel">取消</button>';
      dom.opNote.textContent = '确认后从主星派出 1 艘社交舰队，抵达对方主星即结盟；结盟期间双方显示同一颜色。';
    }
    dom.opActions.onclick = function (e) {
      var btn = e.target.closest('[data-dip]');
      if (!btn) return;
      var act = btn.getAttribute('data-dip');
      dom.opActions.onclick = null;
      state.factionView = 0;
      if (act === 'ally') { sendIntent({ t: 'ally', id: ownerId }); toast('社交舰队已出发'); }
      else if (act === 'break') { sendIntent({ t: 'breakpact', id: ownerId }); toast('已请求解除盟约'); }
      dom.orderPanel.hidden = true;
      updateOrderPanel();
    };
    sfx('click');
  }

  /* ================= Stage 2 · Task B：客户端交互实现 ================= */

  // ---- 通用：星球在屏幕上的位置与环形半径（匹配 2/3 缩小后的 27px 六边形图标） ----
  function planetScreen(pl) {
    var z = state.cam.zoom;
    return {
      x: (pl.x - state.cam.x) * z + viewW() / 2,
      y: (pl.y - state.cam.y) * z + viewH() / 2,
      off: Math.max(38, (pl.r * 1.42 + 22) * z)
    };
  }

  // ---- B1：底部百分比派遣滑条 ----
  function updateDispatchUI() {
    var p = clamp(state.dispatchPct == null ? 1 : state.dispatchPct, 0, 1);
    if (dom.dispatchFill) dom.dispatchFill.style.width = (p * 100).toFixed(1) + '%';
    if (dom.dispatchThumb) dom.dispatchThumb.style.left = (p * 100).toFixed(1) + '%';
    if (dom.dispatchPctLabel) {
      var pl = planetById(state.selPlanet);
      var ships = pl ? Math.max(1, Math.round(Math.floor(pl.troops) * p)) : null;
      dom.dispatchPctLabel.textContent = Math.round(p * 100) + '%' + (ships != null ? ' · ' + ships + ' 艘' : '');
    }
    // 5.4 §6.2：精确数量输入框双向同步（仅在非聚焦时覆盖，避免打断输入）
    if (dom.dispatchCountInput) {
      var cnt = currentDispatchCount();
      if (cnt != null) {
        dom.dispatchCountInput.disabled = false;
        if (document.activeElement !== dom.dispatchCountInput) dom.dispatchCountInput.value = String(cnt);
      } else {
        dom.dispatchCountInput.disabled = true;
        if (document.activeElement !== dom.dispatchCountInput) dom.dispatchCountInput.value = '';
      }
    }
  }
  function pctFromPointer(e, rect) {
    var clientX = (e.touches && e.touches.length) ? e.touches[0].clientX : e.clientX;
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  }
  function bindDispatchBar() {
    if (!dom.dispatchTrack || dom.dispatchTrack.__bound) return;
    dom.dispatchTrack.__bound = true;
    var dragging = false;
    function apply(e) {
      var rect = dom.dispatchTrack.getBoundingClientRect();
      state.dispatchPct = pctFromPointer(e, rect);
      state.dispatchExactCount = null;   // 手动拖动滑条即恢复按百分比派遣
      updateDispatchUI();
      updateHints();
    }
    dom.dispatchTrack.addEventListener('pointerdown', function (e) {
      dragging = true; e.preventDefault(); e.stopPropagation(); apply(e);
      if (dom.dispatchTrack.setPointerCapture) { try { dom.dispatchTrack.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    window.addEventListener('pointermove', function (e) { if (dragging) { apply(e); } });
    window.addEventListener('pointerup', function () { dragging = false; });
    window.addEventListener('pointercancel', function () { dragging = false; });
    if (dom.dispatchTicks) {
      Array.prototype.forEach.call(dom.dispatchTicks.querySelectorAll('span'), function (sp) {
        sp.addEventListener('click', function (e) {
          e.stopPropagation();
          state.dispatchPct = clamp(Number(sp.getAttribute('data-v')) || 0, 0, 100) / 100;
          state.dispatchExactCount = null;
          updateDispatchUI(); updateHints();
        });
      });
    }
    updateDispatchUI();
  }

  // ---- B3：盟友在轨舰队与盟友滑条 ----
  function allyOrbitOwners(pl) {
    var out = [];
    if (!pl || !pl.orbitBy) return out;
    Object.keys(pl.orbitBy).forEach(function (k) {
      var oid = Number(k), n = pl.orbitBy[k];
      if (oid && oid !== state.selfId && n > 0.5 && isAlly(oid)) out.push(oid);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }
  function allyAllocations(srcId) {
    var pl = planetById(srcId);
    var out = [];
    if (!pl) return out;
    allyOrbitOwners(pl).forEach(function (oid) {
      var p = clamp(state.allyPct[oid] == null ? 0 : state.allyPct[oid], 0, 1);
      if (p > 0) out.push({ owner: oid, pct: p });
    });
    return out;
  }
  function renderAllyBars(force) {
    var wrap = dom.allyBars;
    if (!wrap) return;
    var pl = planetById(state.selPlanet);
    var owners = (pl && pl.owner === state.selfId) ? allyOrbitOwners(pl) : [];
    var keep = {};
    owners.forEach(function (oid) { keep[oid] = clamp(state.allyPct[oid] == null ? 0 : state.allyPct[oid], 0, 1); });
    state.allyPct = keep;
    var sig = owners.join(',');
    if (!force && wrap.__sig === sig) return;
    wrap.__sig = sig;
    if (!owners.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    wrap.hidden = false;
    wrap.innerHTML = owners.map(function (oid) {
      var col = displayColor(oid), v = Math.round((state.allyPct[oid] || 0) * 100);
      return '<div class="ally-bar" data-ally="' + oid + '" style="--c:' + esc(col) + '">' +
        '<div class="ally-head"><span class="ally-dot"></span><span class="ally-name">' + esc(factionName(oid)) + '</span>' +
        '<b class="ally-pct" data-allypct="' + oid + '">' + v + '%</b></div>' +
        '<input type="range" min="0" max="100" step="1" value="' + v + '" data-allyrange="' + oid + '">' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(wrap.querySelectorAll('[data-allyrange]'), function (inp) {
      inp.addEventListener('input', function () {
        var oid = Number(inp.getAttribute('data-allyrange'));
        var val = clamp(Number(inp.value) || 0, 0, 100) / 100;
        state.allyPct[oid] = val;
        var lab = wrap.querySelector('[data-allypct="' + oid + '"]');
        if (lab) lab.textContent = Math.round(val * 100) + '%';
        updateHints();
      });
    });
  }

  var HEX_ICONS = {
    // 转让（己方）：向外迁跃发射箭头图标
    transfer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7"/><polyline points="9 7 17 7 17 15"/><path d="M5 21h14"/></svg>',
    // 交易（他方）：双向循环互换箭头图标
    trade: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 2 21 6 17 10"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 22 3 18 7 14"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    // 摧毁（己方）：星核爆破准星图标
    destroy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/></svg>',
    // 外交（他方）：双星轨交汇同盟图标
    diplo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/></svg>'
  };

  // ---- B2：三枚六边形按钮逐帧定位（2/3 尺寸 + 纯矢量图标） ----
  function updateHexMenu() {
    var menu = dom.planetHexMenu;
    if (!menu) return;
    var target = state.selPlanet || state.inspectPlanet || 0;
    if (target !== state.hexTargetId) { state.hexTargetId = target; if (target) state.hexDismissed = false; }
    var pl = planetById(target);
    var blocked = state.mode !== 'game' || !pl || state.selFleet || state.hexDismissed ||
      state.factionView || (dom.confirmModal && !dom.confirmModal.hidden) ||
      (dom.dealModal && !dom.dealModal.hidden) || (dom.diploModal && !dom.diploModal.hidden) ||
      (state.dragOrder && state.dragOrder.active) || state.helpOpen;
    if (blocked) { if (!menu.hidden) menu.hidden = true; return; }
    menu.hidden = false;
    var sp = planetScreen(pl);
    var own = pl.owner === state.selfId;
    var other = pl.owner > 0 && pl.owner !== state.selfId;
    var midKey = own ? 'transfer' : 'trade';
    var lastKey = own ? 'destroy' : 'diplo';
    if (dom.hexMidLabel && dom.hexMidLabel.__ico !== midKey) {
      dom.hexMidLabel.__ico = midKey;
      dom.hexMidLabel.innerHTML = HEX_ICONS[midKey];
    }
    if (dom.hexLastLabel && dom.hexLastLabel.__ico !== lastKey) {
      dom.hexLastLabel.__ico = lastKey;
      dom.hexLastLabel.innerHTML = HEX_ICONS[lastKey];
    }
    if (dom.hexMid) { dom.hexMid.title = own ? '转让星球' : (other ? '交易星球' : '无可用操作'); dom.hexMid.classList.toggle('disabled', !(own || other)); }
    if (dom.hexLast) { dom.hexLast.title = own ? '摧毁星球' : (other ? '外交' : '无可用操作'); dom.hexLast.classList.toggle('disabled', !(own || other)); }
    var angs = [-30, 0, 30];
    var btns = [dom.hexInfo, dom.hexMid, dom.hexLast];
    for (var i = 0; i < 3; i++) {
      var b = btns[i]; if (!b) continue;
      var a = angs[i] * Math.PI / 180;
      b.style.left = (sp.x + Math.cos(a) * sp.off) + 'px';
      b.style.top = (sp.y + Math.sin(a) * sp.off) + 'px';
    }
    if (state.infoPlanet === pl.id) { refreshPlanetInfoIfOpen(); positionPlanetInfo(sp.x, sp.y, sp.off); }
  }
  function dismissHexMenu() {
    state.hexDismissed = true;
    if (dom.planetHexMenu) dom.planetHexMenu.hidden = true;
    closePlanetInfo();
  }
  function bindHexMenu() {
    if (!dom.hexInfo || dom.hexInfo.__bound) return;
    dom.hexInfo.__bound = true;
    dom.hexInfo.addEventListener('click', function (e) {
      e.stopPropagation();
      var pl = planetById(state.selPlanet || state.inspectPlanet); if (!pl) return;
      if (state.infoPlanet === pl.id) closePlanetInfo(); else openPlanetInfo(pl);
      sfx('click');
    });
    if (dom.hexMid) dom.hexMid.addEventListener('click', function (e) {
      e.stopPropagation();
      var pl = planetById(state.selPlanet || state.inspectPlanet); if (!pl) return;
      if (pl.owner === state.selfId) openTransferDialog(pl);
      else if (pl.owner > 0) openTradeDialog(pl);
      else toast('中立星球无法交易或转让');
      sfx('click');
    });
    if (dom.hexLast) dom.hexLast.addEventListener('click', function (e) {
      e.stopPropagation();
      var pl = planetById(state.selPlanet || state.inspectPlanet); if (!pl) return;
      if (pl.owner === state.selfId) destroyPlanet(pl);
      else if (pl.owner > 0) { openDiploPanel(pl); }
      else toast('中立星球没有外交对象');
      sfx('click');
    });
  }

  // ---- B2：紧凑信息浮窗 ----
  function renderPlanetInfo(pl) {
    if (!pl) return;
    if (dom.piKicker) dom.piKicker.textContent = pl.owner === state.selfId ? 'YOUR WORLD' : (isAlly(pl.owner) ? 'ALLY WORLD' : (pl.owner ? 'HOSTILE WORLD' : 'NEUTRAL WORLD'));
    if (dom.piTitle) dom.piTitle.textContent = pl.name || '星球';
    var rows = [
      ['驻军', Math.floor(pl.troops) + ' / ' + pl.cap],
      ['矿藏', Math.round(pl.resource) + ' / ' + Math.max(1, pl.maxResource || 180)],
      ['阵营化', (pl.owner ? Math.round((pl.purityProg == null ? 1 : pl.purityProg) * 100) : 0) + '%'],
      ['补充速率', (pl.reinforce && pl.owner && !pl.exhausted ? '+1 /秒' : '—')],
      ['占领', Math.round((pl.captureProg || 0) * 100) + '%']
    ];
    if (dom.piRows) dom.piRows.innerHTML = rows.map(function (r) {
      return '<div class="pi-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>';
    }).join('');
    var list = [];
    if (pl.orbitBy) Object.keys(pl.orbitBy).forEach(function (k) {
      var c = Math.floor(pl.orbitBy[k] || 0); if (c >= 1) list.push({ owner: Number(k), n: c });
    });
    list.sort(function (a, b) { return b.n - a.n; });
    if (dom.piFleets) {
      if (!list.length) dom.piFleets.innerHTML = '<div class="pi-empty">无驻留舰队</div>';
      else dom.piFleets.innerHTML = '<div class="pi-fleets-head">驻留舰队</div>' + list.map(function (x) {
        var col = x.owner ? displayColor(x.owner) : '#9aa7b0';
        return '<div class="pi-fleet"><span class="pi-fdot" style="--c:' + esc(col) + '"></span><span class="pi-fname">' +
          esc(x.owner ? factionName(x.owner) : '中立') + '</span><b>' + x.n + '</b></div>';
      }).join('');
    }
  }
  function positionPlanetInfo(px, py, off) {
    var el = dom.planetInfoPopup; if (!el || el.hidden) return;
    var w = el.offsetWidth || 220, h = el.offsetHeight || 150;
    var left = px + off + 40;
    if (left + w > viewW() - 8) left = px - off - 40 - w;
    if (left < 8) left = 8;
    var top = clamp(py - h / 2, 60, viewH() - h - 8);
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function refreshPlanetInfoIfOpen() {
    if (!state.infoPlanet) return;
    var pl = planetById(state.infoPlanet);
    if (!pl) { closePlanetInfo(); return; }
    var sig = pl.id + ':' + Math.floor(pl.troops) + ':' + Math.round(pl.resource) + ':' +
      Math.round((pl.purityProg == null ? (pl.owner ? 1 : 0) : pl.purityProg) * 100) + ':' + JSON.stringify(pl.orbitBy || {});
    if (sig === state.infoSig) return;
    state.infoSig = sig;
    renderPlanetInfo(pl);
  }
  function openPlanetInfo(pl) {
    if (!pl) return;
    state.infoPlanet = pl.id; state.infoSig = ''; state.hexDismissed = false;
    if (dom.planetInfoPopup) dom.planetInfoPopup.hidden = false;
    renderPlanetInfo(pl);
    var sp = planetScreen(pl);
    positionPlanetInfo(sp.x, sp.y, sp.off);
  }
  function closePlanetInfo() {
    state.infoPlanet = 0; state.infoSig = '';
    if (dom.planetInfoPopup) dom.planetInfoPopup.hidden = true;
  }

  // ---- 交易 / 转让（Task C 占位，结构预留） ----
  function requestTransfer(pl) {
    // 己方星球的「转让」：本轮仅 UI + toast 占位；Task C 将发送 intentTransfer
    toast('转让面板即将开放 · ' + pl.name);
  }
  function requestTrade(pl) {
    // 他方星球的「交易」：本轮仅 UI + toast 占位；Task C 将发送 intentTrade
    toast('交易面板即将开放 · ' + pl.name);
  }

  // ---- B2：自绘 DOM 确认框（禁止 window.confirm） ----
  function closeModalAnimated(el) {
    if (!el) return;
    try {
      if (el.classList) el.classList.add('closing');
      setTimeout(function () {
        try { el.hidden = true; if (el.classList) el.classList.remove('closing'); } catch (e) {}
      }, 160);
    } catch (e) { el.hidden = true; }
  }
  function showConfirm(opts) {
    opts = opts || {};
    state.confirmCb = typeof opts.onOk === 'function' ? opts.onOk : null;
    if (dom.confirmKicker) dom.confirmKicker.textContent = opts.kicker || 'CONFIRM · 确认';
    if (dom.confirmTitle) dom.confirmTitle.textContent = opts.title || '确认操作';
    if (dom.confirmBody) dom.confirmBody.textContent = opts.body || '';
    if (dom.confirmOk) {
      dom.confirmOk.textContent = opts.okText || '确认';
      dom.confirmOk.classList.toggle('danger', opts.danger !== false);
      dom.confirmOk.classList.toggle('primary', opts.danger === false);
    }
    if (dom.confirmModal) dom.confirmModal.hidden = false;
    sfx('click');
  }
  function closeConfirm(run) {
    var cb = state.confirmCb; state.confirmCb = null;
    if (dom.confirmModal) closeModalAnimated(dom.confirmModal);
    if (run && cb) { try { cb(); } catch (e) {} }
  }
  function bindConfirmModal() {
    if (!dom.confirmModal || dom.confirmModal.__bound) return;
    dom.confirmModal.__bound = true;
    if (dom.confirmOk) dom.confirmOk.addEventListener('click', function () { closeConfirm(true); });
    if (dom.confirmCancel) dom.confirmCancel.addEventListener('click', function () { closeConfirm(false); });
    dom.confirmModal.addEventListener('click', function (e) { if (e.target === dom.confirmModal) closeConfirm(false); });
  }
  function destroyPlanet(pl) {
    if (!pl) return;
    if (pl.troops < 15) { toast('驻军需 ≥ 15 才能摧毁', true); sfx('deny'); return; }
    var others = 0;
    state.planets.forEach(function (q) { if (q.id !== pl.id && q.owner === state.selfId) others++; });
    if (others === 0) { toast('这是你仅剩的星球，无法摧毁', true); sfx('deny'); return; }
    var payout = pl.exhausted ? '少量资源' : '大量资源';
    showConfirm({
      kicker: 'DESTROY · 摧毁星球',
      title: '摧毁「' + pl.name + '」',
      body: '读条 8 秒，期间驻军少于 15 艘会被打断。' +
        (pl.exhausted ? '这是枯竭星球，只能回收' : '这是一颗正常星球，摧毁可获得') + payout + '。',
      okText: '确认摧毁', danger: true,
      onOk: function () { if (sendIntent({ t: 'destroy', id: pl.id })) toast('摧毁读条已开始'); }
    });
  }

  // ---- B4：18 秒联合出兵（客户端 UI） ----
  function addJointRequest(msg) {
    if (!msg || msg.id == null) return;
    state.jointReqs[msg.id] = msg;
    addMailItem('joint', msg.id, (msg.fromName || '盟友') + ' 邀请联合出兵',
      '目标 ' + (msg.targetName || '?') + ' · 出发 ' + (msg.srcName || '—') + ' · 比例 ' + Math.round((msg.pct || 0) * 100) + '%',
      msg.deadline, msg);
    toast('收到来自 ' + (msg.fromName || '盟友') + ' 的联合出兵请求');
    sfx('pact');
  }
  function renderJointReqs() {
    var wrap = dom.jointReqList; if (!wrap) return;
    var ids = Object.keys(state.jointReqs);
    if (!ids.length) { wrap.hidden = true; wrap.innerHTML = ''; return; }
    wrap.hidden = false;
    var now = Date.now();
    wrap.innerHTML = ids.map(function (id) {
      var m = state.jointReqs[id];
      var left = Math.max(0, Math.ceil(((m.deadline || 0) - now) / 1000));
      return '<div class="joint-card panel" data-jid="' + esc(id) + '">' +
        '<div class="jc-head"><span class="micro-label">JOINT LAUNCH</span><button class="jc-x" data-jact="close" data-jid="' + esc(id) + '" type="button">×</button></div>' +
        '<div class="jc-title">' + esc(m.fromName || '盟友') + ' 邀请联合出兵</div>' +
        '<div class="jc-body">目标：<b>' + esc(m.targetName || '未知') + '</b> · 出发：<b>' + esc(m.srcName || '—') + '</b></div>' +
        '<div class="jc-meta">发起方比例 <b>' + Math.round((m.pct || 0) * 100) + '%</b> · 剩余 <b class="jc-left">' + left + 's</b></div>' +
        '<div class="jc-actions"><button class="btn primary" data-jact="yes" data-jid="' + esc(id) + '" type="button">同意</button>' +
        '<button class="btn danger" data-jact="no" data-jid="' + esc(id) + '" type="button">拒绝</button></div>' +
        '</div>';
    }).join('');
  }
  function updateJointState(msg) {
    if (!msg || msg.id == null) return;
    state.joints[msg.id] = state.joints[msg.id] || {};
    var j = state.joints[msg.id];
    j.id = msg.id; j.accepted = msg.accepted || []; j.deadline = msg.deadline; j.done = false;
    renderJointStatus();
  }
  function renderJointStatus() {
    var wrap = dom.jointStatus, body = dom.jointStatusBody;
    if (!wrap || !body) return;
    var ids = Object.keys(state.joints).filter(function (id) { return !state.joints[id].done; });
    if (!ids.length) { wrap.hidden = true; body.innerHTML = ''; return; }
    wrap.hidden = false;
    var now = Date.now();
    body.innerHTML = ids.map(function (id) {
      var j = state.joints[id];
      var left = Math.max(0, Math.ceil(((j.deadline || 0) - now) / 1000));
      return '<div class="js-row" data-jsid="' + esc(id) + '">' +
        '<div class="js-line">集结中 · 已同意 <b>' + (j.accepted || []).length + '</b> 方 · 剩余 <b class="js-left">' + left + 's</b></div>' +
        '<button class="btn primary wide" data-jgo="' + esc(id) + '" type="button">立即出动</button></div>';
    }).join('');
    Array.prototype.forEach.call(body.querySelectorAll('[data-jgo]'), function (b) {
      b.onclick = function () {
        var id = b.getAttribute('data-jgo');
        var jid = /^\d+$/.test(id) ? Number(id) : id;
        if (sendIntent({ t: 'jointGo', id: jid })) toast('已下达立即出动');
      };
    });
  }
  function removeJoint(id) {
    if (state.joints) delete state.joints[id];
    if (state.jointReqs) delete state.jointReqs[id];
    removeMailItem('joint:' + id);
    renderJointReqs();
    renderJointStatus();
  }
  var lastJointTick = 0;
  function updateJointCountdowns() {
    var now = Date.now();
    if (now - lastJointTick < 400) return;
    lastJointTick = now;
    if (dom.jointReqList && !dom.jointReqList.hidden) {
      Array.prototype.forEach.call(dom.jointReqList.querySelectorAll('.jc-left'), function (el) {
        var card = el.closest('[data-jid]'); var id = card && card.getAttribute('data-jid');
        var m = id != null && state.jointReqs[id];
        if (m) el.textContent = Math.max(0, Math.ceil(((m.deadline || 0) - now) / 1000)) + 's';
      });
    }
    if (dom.jointStatusBody && dom.jointStatus && !dom.jointStatus.hidden) {
      Array.prototype.forEach.call(dom.jointStatusBody.querySelectorAll('.js-left'), function (el) {
        var row = el.closest('[data-jsid]'); var id = row && row.getAttribute('data-jsid');
        var j = id != null && state.joints[id];
        if (j) el.textContent = Math.max(0, Math.ceil(((j.deadline || 0) - now) / 1000)) + 's';
      });
    }
  }
  function bindJointUI() {
    if (dom.jointReqList && !dom.jointReqList.__bound) {
      dom.jointReqList.__bound = true;
      dom.jointReqList.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-jact]'); if (!btn) return;
        var act = btn.getAttribute('data-jact');
        var id = btn.getAttribute('data-jid');
        var m = state.jointReqs[id];
        if (act === 'close') { delete state.jointReqs[id]; renderJointReqs(); return; }
        if (!m) return;
        var jid = /^\d+$/.test(id) ? Number(id) : id;
        sendIntent({ t: 'jointVote', id: jid, accept: act === 'yes' });
        delete state.jointReqs[id];
        renderJointReqs();
        toast(act === 'yes' ? '已同意联合出兵' : '已拒绝联合出兵');
      });
    }
    if (dom.piClose && !dom.piClose.__bound) {
      dom.piClose.__bound = true;
      dom.piClose.addEventListener('click', function (e) { e.stopPropagation(); closePlanetInfo(); });
    }
  }
  /* ================= Stage 2 · Task C：拖拽派遣 / 邮件球 / 交易转让 / 七态外交 ================= */

  // ---------- C1：拖拽连线派遣 ----------
  function dragEligible(pl) {
    if (!pl) return false;
    if (pl.owner === state.selfId && Math.floor(pl.troops) >= 1) return true;
    var own = pl.orbitBy ? pl.orbitBy[state.selfId] : 0;
    return (own || 0) >= 1;
  }
  function updateDragOrder(x, y) {
    var d = state.dragOrder; if (!d) return;
    d.x = x; d.y = y; d.active = true;
    state.pointer.x = x; state.pointer.y = y;
  }
  function finishDragOrder(x, y) {
    var d = state.dragOrder;
    if (!d || !d.active) return false;
    state.dragOrder = null; state.dragHover = null;
    var hit = pickAt(x, y);
    if (!hit) { toast('已取消派遣'); return true; }
    if (hit.kind === 'planet') {
      if (hit.id === d.srcId) { toast('已取消派遣'); return true; }
      orderLaunch(d.srcId, hit.id);   // 内部：盟友滑条>0 → jointLaunch，否则 launch(pct)
      return true;
    }
    if (hit.kind === 'node') {
      if (sendIntent({ t: 'gather', node: hit.id })) { toast('已派出采集舰队'); sfx('order'); }
      return true;
    }
    toast('已取消派遣');
    return true;
  }
  function applyDragEdgeScroll(dt) {
    var d = state.dragOrder; if (!d || !d.active) return;
    var margin = 48, speed = 420 / Math.max(0.2, state.cam.zoom);
    var vx = 0, vy = 0;
    if (d.x < margin) vx = -speed * (1 - d.x / margin);
    else if (d.x > viewW() - margin) vx = speed * (1 - (viewW() - d.x) / margin);
    if (d.y < margin) vy = -speed * (1 - d.y / margin);
    else if (d.y > viewH() - margin) vy = speed * (1 - (viewH() - d.y) / margin);
    if (vx || vy) { state.cam.tx += vx * dt; state.cam.ty += vy * dt; clampCam(); state.cam.x = state.cam.tx; state.cam.y = state.cam.ty; }
  }
  function drawDragOrder(t) {
    var d = state.dragOrder;
    if (!d || !d.active) { state.dragHover = null; return; }
    var src = state.planets.get(d.srcId);
    if (!src) { state.dragOrder = null; return; }
    var sp = planetScreen(src);
    var x = d.x, y = d.y;
    var hit = pickAt(x, y);
    var hover = (hit && hit.kind !== 'fleet' && hit.id !== d.srcId) ? hit : null;
    state.dragHover = hover;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(110,247,255,0.55)'; ctx.lineWidth = 2;
    ctx.shadowColor = '#6ef7ff'; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.shadowBlur = 0;
    var dx = x - sp.x, dy = y - sp.y, len = Math.hypot(dx, dy) || 1;
    // I2：双层流光能量航线（无任何垂直横杠）
    ctx.strokeStyle = 'rgba(110,247,255,0.28)'; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = 'rgba(180,255,255,0.9)'; ctx.lineWidth = 1.6;
    ctx.setLineDash([12, 10]); ctx.lineDashOffset = -t * 60;
    ctx.beginPath(); ctx.moveTo(sp.x, sp.y); ctx.lineTo(x, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(110,247,255,.9)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sp.x, sp.y, Math.max(10, src.r * state.cam.zoom) + 6, 0, TAU); ctx.stroke();
    if (hover && hover.kind === 'planet') {
      var hp = planetById(hover.id);
      if (hp) {
        var hsp = planetScreen(hp);
        var rr = Math.max(14, hp.r * state.cam.zoom) + 10;
        var pulse = 0.55 + 0.45 * Math.sin(t * 6);
        ctx.strokeStyle = 'rgba(120,255,220,' + pulse.toFixed(2) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(hsp.x, hsp.y, rr, 0, TAU); ctx.stroke();
      }
    } else if (hover && hover.kind === 'node') {
      var nd = state.nodes.get(hover.id);
      if (nd) {
        var nsp = { x: (nd.x - state.cam.x) * state.cam.zoom + viewW() / 2, y: (nd.y - state.cam.y) * state.cam.zoom + viewH() / 2 };
        var pr = 0.55 + 0.45 * Math.sin(t * 6);
        ctx.strokeStyle = 'rgba(255,199,102,' + pr.toFixed(2) + ')'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(nsp.x, nsp.y, 22, 0, TAU); ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(190,255,255,.95)';
    ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  // ---------- C2：邮件悬浮球与统一收件箱 ----------
  function mailKindLabel(kind) {
    return kind === 'pact' ? '结盟请求' : kind === 'trade' ? '交易' : kind === 'transfer' ? '转让' : kind === 'vote' ? '联盟投票' : kind === 'diplo' ? '外交请求' : kind === 'joint' ? '联合出兵' : '待办';
  }
  function addMailItem(kind, id, title, desc, expireAt, payload) {
    if (id == null) return;
    var key = kind + ':' + id;
    for (var i = 0; i < state.mail.length; i++) {
      if (state.mail[i].key === key && !state.mail[i].invalid) return;
    }
    state.mail.push({
      key: key, kind: kind, id: id, title: title || '', desc: desc || '',
      expireAt: expireAt || (Date.now() + 90000), at: Date.now(), read: false,
      invalid: false, statusText: '', payload: payload || {}
    });
    state.mailUnread++;
    renderMail(); updateMailBadge();
    bus.emit('mail:change', {});
  }
  function invalidateMailItem(key, reasonText) {
    var changed = false;
    for (var i = 0; i < state.mail.length; i++) {
      var it = state.mail[i];
      if (it.key === key && !it.invalid) {
        it.invalid = true;
        it.statusText = reasonText || '已失效';
        if (!it.read) { it.read = true; state.mailUnread = Math.max(0, (state.mailUnread || 0) - 1); }
        changed = true;
      }
    }
    if (changed) { renderMail(); updateMailBadge(); bus.emit('mail:change', {}); }
  }
  function removeMailItem(key) {
    state.mail = state.mail.filter(function (x) { return x.key !== key; });
    renderMail(); updateMailBadge();
    bus.emit('mail:change', {});
  }
  function findMail(key) {
    for (var i = 0; i < state.mail.length; i++) if (state.mail[i].key === key) return state.mail[i];
    return null;
  }
  function isMailItemInvalid(it, now) {
    if (!it) return true;
    if (it.invalid) return true;
    var left = Math.ceil(((it.expireAt || 0) - (now || Date.now())) / 1000);
    return left <= 0;
  }
  function updateMailBadge() {
    var b = dom.mailBadge; if (!b) return;
    var now = Date.now(), n = 0;
    for (var i = 0; i < state.mail.length; i++) {
      if (!state.mail[i].read && !isMailItemInvalid(state.mail[i], now)) n++;
    }
    state.mailUnread = n;
    if (n > 0) { b.hidden = false; b.textContent = String(n); } else b.hidden = true;
  }
  function renderMailCard(it, now) {
    var left = Math.max(0, Math.ceil(((it.expireAt || 0) - now) / 1000));
    var inv = isMailItemInvalid(it, now);
    var statusLabel = inv ? (it.statusText || '已失效') : (left + 's');
    return '<div class="mail-item' + (inv ? ' expired' : '') + '" data-mkey="' + esc(it.key) + '">' +
      '<div class="mi-head"><span class="mi-title">' + esc(it.title) + '</span><button class="mi-x" data-mailx="' + esc(it.key) + '" type="button" title="移除记录">×</button></div>' +
      (it.desc ? '<div class="mi-desc">' + esc(it.desc) + '</div>' : '') +
      '<div class="mi-meta"><span>' + esc(mailKindLabel(it.kind)) + '</span><span class="mi-left">' + esc(statusLabel) + '</span></div>' +
      (inv
        ? '<div class="mi-status-tag">已失效 · ' + esc(it.statusText || '已过期') + '</div>'
        : '<div class="mi-actions"><button class="btn primary" data-mailact="yes" data-mkey="' + esc(it.key) + '" type="button">同意</button>' +
          '<button class="btn danger" data-mailact="no" data-mkey="' + esc(it.key) + '" type="button">拒绝</button></div>') +
      '</div>';
  }
  function renderMail() {
    var list = dom.mailList; if (!list) return;
    if (!state.mail.length) { list.innerHTML = '<div class="mail-empty">暂无待办邮件</div>'; return; }
    var now = Date.now();
    var active = [], invalid = [];
    state.mail.forEach(function (it) { if (isMailItemInvalid(it, now)) invalid.push(it); else active.push(it); });
    active.sort(function (a, b) { return b.at - a.at; });
    invalid.sort(function (a, b) { return b.at - a.at; });
    var html = '';
    if (active.length) {
      html += '<div class="mail-group-sep">待处理 (' + active.length + ')</div>';
      html += active.map(function (it) { return renderMailCard(it, now); }).join('');
    }
    if (invalid.length) {
      html += '<div class="mail-group-sep invalid">已失效 (' + invalid.length + ')</div>';
      html += invalid.map(function (it) { return renderMailCard(it, now); }).join('');
    }
    list.innerHTML = html;
  }
  function mailRespond(item, accept) {
    if (!item || isMailItemInvalid(item, Date.now())) return;
    if (item.kind === 'pact') sendIntent({ t: 'pact', from: Number(item.id), accept: accept });
    else if (item.kind === 'trade' || item.kind === 'transfer') sendIntent({ t: 'tradeRespond', id: item.id, accept: accept });
    else if (item.kind === 'vote') sendIntent({ t: 'vote', id: item.id, accept: accept });
    else if (item.kind === 'diplo') sendIntent({ t: 'diploRespond', id: item.id, accept: accept });
    else if (item.kind === 'joint') sendIntent({ t: 'jointVote', id: item.id, accept: accept });
    invalidateMailItem(item.key, accept ? '已同意' : '已拒绝');
    toast(accept ? '已同意' : '已拒绝');
  }
  function openMail() {
    state.mailOpen = true;
    state.mailUnread = 0;
    for (var i = 0; i < state.mail.length; i++) state.mail[i].read = true;
    if (dom.mailPanel) dom.mailPanel.hidden = false;
    renderMail(); updateMailBadge();
  }
  function closeMail() { state.mailOpen = false; if (dom.mailPanel) dom.mailPanel.hidden = true; }
  var lastMailTick = 0;
  function updateMailCountdowns() {
    var now = Date.now();
    if (now - lastMailTick < 400) return;
    lastMailTick = now;
    var newlyExpired = false;
    for (var i = 0; i < state.mail.length; i++) {
      var it = state.mail[i];
      if (!it.invalid && (it.expireAt || 0) <= now) {
        it.invalid = true;
        it.statusText = '超时未决';
        newlyExpired = true;
      }
    }
    if (newlyExpired) {
      updateMailBadge();
      if (dom.mailPanel && !dom.mailPanel.hidden) renderMail();
      return;
    }
    if (!dom.mailList || !dom.mailPanel || dom.mailPanel.hidden) return;
    Array.prototype.forEach.call(dom.mailList.querySelectorAll('.mail-item:not(.expired)'), function (row) {
      var key = row.getAttribute('data-mkey');
      var it = findMail(key);
      if (!it) return;
      var left = Math.max(0, Math.ceil(((it.expireAt || 0) - now) / 1000));
      var le = row.querySelector('.mi-left'); if (le) le.textContent = left + 's';
    });
  }
  function bindMailOrb() {
    if (!dom.mailOrb || dom.mailOrb.__bound) return;
    dom.mailOrb.__bound = true;
    var dragged = false, startX = 0, startY = 0, ox = 0, oy = 0;
    if (state.mailPos) { dom.mailOrb.style.left = state.mailPos.x + 'px'; dom.mailOrb.style.top = state.mailPos.y + 'px'; dom.mailOrb.style.right = 'auto'; }
    dom.mailOrb.addEventListener('pointerdown', function (e) {
      e.stopPropagation(); e.preventDefault();
      dragged = false; startX = e.clientX; startY = e.clientY;
      var rect = dom.mailOrb.getBoundingClientRect();
      ox = e.clientX - rect.left; oy = e.clientY - rect.top;
      if (dom.mailOrb.setPointerCapture) { try { dom.mailOrb.setPointerCapture(e.pointerId); } catch (err) {} }
    });
    dom.mailOrb.addEventListener('pointermove', function (e) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > 5) dragged = true;
      if (!dragged) return;
      var x = clamp(e.clientX - ox, 4, Math.max(4, viewW() - 44 - 4));
      var y = clamp(e.clientY - oy, 4, Math.max(4, viewH() - 44 - 4));
      dom.mailOrb.style.left = x + 'px'; dom.mailOrb.style.top = y + 'px'; dom.mailOrb.style.right = 'auto';
      state.mailPos = { x: x, y: y };
    });
    dom.mailOrb.addEventListener('pointerup', function () {
      if (!dragged) { if (state.mailOpen) closeMail(); else openMail(); }
      dragged = false;
    });
    dom.mailOrb.addEventListener('pointercancel', function () { dragged = false; });
    if (dom.mailClose) dom.mailClose.addEventListener('click', function (e) { e.stopPropagation(); closeMail(); });
    if (dom.mailList) dom.mailList.addEventListener('click', function (e) {
      var x = e.target.closest('[data-mailx]');
      if (x) { removeMailItem(x.getAttribute('data-mailx')); return; }
      var b = e.target.closest('[data-mailact]');
      if (b) { var it = findMail(b.getAttribute('data-mkey')); if (it) mailRespond(it, b.getAttribute('data-mailact') === 'yes'); }
    });
    updateMailBadge();
  }

  // C2：服务端事件 → 收件箱
  function onTradeRequest(msg) {
    var kind = msg.kind === 'transfer' ? 'transfer' : 'trade';
    var pName = msg.planetName || planetName(msg.planet);
    var title = kind === 'transfer' ? ((msg.fromName || '对方') + ' 要转让「' + pName + '」给你') : ((msg.fromName || '对方') + ' 想交易「' + pName + '」');
    var desc = kind === 'transfer' ? ('附带驻军：' + (msg.withTroops ? '是' : '否') + ' · 回赠资源：' + (msg.wantResource || 0)) : ('报价资源：' + (msg.offerResource || 0));
    addMailItem(kind, msg.id, title, desc, msg.expireAt);
    toast('收到' + (kind === 'transfer' ? '转让' : '交易') + '请求');
    sfx('pact');
  }
  function onTradeResult(msg) {
    var ok = !!msg.ok;
    var reason = msg.reason === 'declined' ? '对方拒绝' : (msg.reason === 'planet-lost' ? '星球已易主' : '已取消');
    toast(ok ? '交易成立' : ('交易失败：' + reason), !ok);
    invalidateMailItem('trade:' + msg.id, ok ? '交易已完成' : ('失败：' + reason));
    invalidateMailItem('transfer:' + msg.id, ok ? '转让已完成' : ('失败：' + reason));
  }
  function onVoteRequest(msg) {
    var kl = { join: '加入联盟', invite: '邀请入盟', incite: '离间', expel: '提议驱逐' }[msg.kind] || '联盟投票';
    addMailItem('vote', msg.id, '联盟投票 · ' + kl, (msg.fromName ? ('发起：' + msg.fromName) : ''), msg.expireAt, msg);
    toast('收到联盟投票请求'); sfx('pact');
    openMail();   // C4：收到联盟投票请求即弹卡表决
  }
  function onVoteState(msg) {
    var it = findMail('vote:' + msg.id);
    if (it) { if (msg.yes) it.desc = '已同意 ' + (msg.yes.length || 0) + (msg.members ? ('/' + (msg.members.length || 0)) : ''); renderMail(); }
  }
  function onDiploResult(msg) { toast(msg && msg.ok === false ? '外交未通过' : '外交结果已更新', !!(msg && msg.ok === false)); }
  function onDiploRequest(msg) {
    var kl = msg.kind === 'incite' ? '离间' : '邀请入盟';
    addMailItem('diplo', msg.id, '外交请求 · ' + kl, (msg.fromName ? ('来自 ' + msg.fromName) : ''), msg.expireAt, msg);
    toast('收到外交请求'); sfx('pact');
    openMail();   // C4：收到外交最终确认请求即弹卡
  }

  // ---------- C3：交易 / 转让对话框 ----------
  function closeDeal() { state.deal = null; if (dom.dealModal) closeModalAnimated(dom.dealModal); }
  function openTransferDialog(pl) {
    if (!pl) return;
    if (myPlanets().length <= 1) { toast('仅剩最后一颗星球，无法转让', true); return; }
    if (pl.destroyTimer > 0) { toast('摧毁读条中的星球无法转让', true); return; }
    state.deal = { kind: 'transfer', planet: pl.id };
    var others = Array.from(state.players.values()).filter(function (p) { return p.id !== state.selfId; });
    var opts = others.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + (p.bot ? ' · AI' : '') + '</option>'; }).join('');
    if (dom.dealKicker) dom.dealKicker.textContent = 'TRANSFER · 转让';
    if (dom.dealTitle) dom.dealTitle.textContent = '转让「' + pl.name + '」';
    if (dom.dealBody) dom.dealBody.innerHTML =
      '<label class="deal-field">接收方<select id="dealTo">' + (opts || '<option value="">无其他指挥官</option>') + '</select></label>' +
      '<label class="deal-field"><input type="checkbox" id="dealTroops" checked> 附带驻军舰队</label>' +
      '<label class="deal-field">回赠资源<input type="number" id="dealWant" min="0" step="1" value="0"></label>' +
      '<p class="deal-hint">手续费 2 资源；仅剩 1 颗星球或摧毁读条中禁止转让。接收方可在同意前附加回赠资源。</p>';
    if (dom.dealModal) dom.dealModal.hidden = false;
    sfx('click');
  }
  function openTradeDialog(pl) {
    if (!pl) return;
    if (pl.destroyTimer > 0) { toast('摧毁读条中的星球无法交易', true); return; }
    state.deal = { kind: 'trade', planet: pl.id };
    if (dom.dealKicker) dom.dealKicker.textContent = 'TRADE · 交易';
    if (dom.dealTitle) dom.dealTitle.textContent = '交易「' + pl.name + '」';
    if (dom.dealBody) dom.dealBody.innerHTML =
      '<label class="deal-field">报价资源<input type="number" id="dealOffer" min="0" step="1" value="20"></label>' +
      '<p class="deal-hint">发起即预扣 2 手续费 + 报价资源，90 秒内对方同意成交；扣 10% 交易税；若等待期内星球易主则扣 20% 违约金后退还 80%。</p>';
    if (dom.dealModal) dom.dealModal.hidden = false;
    sfx('click');
  }
  function submitDeal() {
    var d = state.deal; if (!d) return;
    var pl = planetById(d.planet); if (!pl) { closeDeal(); return; }
    if (d.kind === 'transfer') {
      var toEl = dom.dealBody.querySelector('#dealTo');
      var to = toEl ? Number(toEl.value) : 0;
      var withEl = dom.dealBody.querySelector('#dealTroops');
      var wantEl = dom.dealBody.querySelector('#dealWant');
      var want = wantEl ? Math.max(0, Math.floor(Number(wantEl.value) || 0)) : 0;
      if (!to) { toast('请选择接收方', true); return; }
      if (sendIntent({ t: 'transfer', planet: d.planet, to: to, withTroops: !!(withEl && withEl.checked), wantResource: want })) toast('转让请求已发出');
    } else {
      var oEl = dom.dealBody.querySelector('#dealOffer');
      var offer = oEl ? Math.max(0, Math.floor(Number(oEl.value) || 0)) : 0;
      if (sendIntent({ t: 'trade', planet: d.planet, offerResource: offer })) toast('交易请求已发出');
    }
    closeDeal();
  }
  function bindDealDialog() {
    if (!dom.dealModal || dom.dealModal.__bound) return;
    dom.dealModal.__bound = true;
    if (dom.dealSubmit) dom.dealSubmit.addEventListener('click', submitDeal);
    if (dom.dealCancel) dom.dealCancel.addEventListener('click', closeDeal);
    dom.dealModal.addEventListener('click', function (e) { if (e.target === dom.dealModal) closeDeal(); });
  }

  // ---------- C4：七态外交面板 ----------
  function coalitionMembers(cid) { var n = 0; state.players.forEach(function (p) { if (p.coalition === cid) n++; }); return n; }
  function closeDiplo() { state.diplo = null; if (dom.diploModal) closeModalAnimated(dom.diploModal); }
  function openDiploPanel(pl) {
    if (!pl || !pl.owner || pl.owner === state.selfId) return;
    var me = selfPlayer(), target = state.players.get(pl.owner);
    if (!me || !target) return;
    state.diplo = { planet: pl.id, owner: pl.owner };
    var myC = me.coalition || 0, tC = target.coalition || 0;
    var members = myC ? coalitionMembers(myC) : 0;
    var acts = [];
    if (!myC && !tC) acts.push('ally');
    if (!myC && tC) acts.push('join');
    if (myC && !tC) acts.push('invite');
    if (myC && tC && myC !== tC) acts.push('incite');
    if (myC && myC === tC) { if (members >= 3) acts.push('expel'); if (members <= 2) acts.push('break'); }
    if (myC) acts.push('mark');
    if (!acts.length) acts.push('mark');
    var labels = { ally: '结盟', join: '加入对方联盟', invite: '邀请对方入盟', incite: '离间对方', expel: '提议驱逐', break: '解除盟约（断交）', mark: '标记坐标' };
    var costs = { ally: 2, join: 2, invite: 2, expel: 2, incite: 5, mark: 0, break: 0 };
    if (dom.diploKicker) dom.diploKicker.textContent = 'DIPLOMACY · 七态外交';
    if (dom.diploTitle) dom.diploTitle.textContent = '与 ' + (target.name || '对方') + ' 交涉';
    var st = '我方：<b>' + (myC ? ('联盟 ' + myC) : '无联盟') + '</b> · 对方：<b>' + (tC ? ('联盟 ' + tC) : '无联盟') + '</b>';
    if (myC && myC === tC) st += '<br>同盟成员数：<b>' + members + '</b>（≥50% 同意生效）';
    if (dom.diploState) dom.diploState.innerHTML = st;
    if (dom.diploActions) dom.diploActions.innerHTML = acts.map(function (a) {
      var cost = costs[a] || 0;
      return '<button class="btn ' + ((a === 'break' || a === 'incite') ? 'danger' : 'primary') + '" data-diplo="' + a + '" type="button">' + labels[a] + '<span class="cost">' + (cost ? (cost + ' 资源') : '免费') + '</span></button>';
    }).join('');
    if (dom.diploHint) dom.diploHint.textContent = '联盟类投票由发起人自动计 1 票同意，当前同意票数/联盟总人数 ≥ 50% 立即生效；90 秒未决按弃权结算。';
    if (dom.diploModal) dom.diploModal.hidden = false;
    sfx('click');
  }
  function sendDiplo(action) {
    var d = state.diplo; if (!d || !action) return;
    var planet = d.planet, owner = d.owner;
    closeDiplo();
    if (sendIntent({ t: 'diplo', action: action, targetPlayer: owner, targetPlanet: planet })) {
      var nm = { ally: '结盟', join: '加入联盟', invite: '邀请盟友', incite: '离间', expel: '提议驱逐', break: '断交', mark: '标记坐标' }[action] || action;
      toast('已发送外交：' + nm);
    }
  }
  function bindDiploPanel() {
    if (!dom.diploModal || dom.diploModal.__bound) return;
    dom.diploModal.__bound = true;
    if (dom.diploClose) dom.diploClose.addEventListener('click', closeDiplo);
    dom.diploModal.addEventListener('click', function (e) { if (e.target === dom.diploModal) closeDiplo(); });
    if (dom.diploActions) dom.diploActions.addEventListener('click', function (e) { var b = e.target.closest('[data-diplo]'); if (!b) return; sendDiplo(b.getAttribute('data-diplo')); });
  }

  /* ================= Stage 3 · Task E：房间/模式 UI ================= */
  function roomModeName() {
    return state.roomMode === 'elim' ? '淘汰模式' : state.roomMode === 'endless' ? '无尽模式' : state.roomMode === 'normal' ? '普通模式' : (state.roomMode || '—');
  }
  function roomStatusName() {
    return state.roomStatus === 'waiting' ? '候场' : state.roomStatus === 'running' ? '进行中' : state.roomStatus === 'settled' ? '已结算' : (state.roomStatus || '—');
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function applyRoomMeta(d, isHello) {
    if (!d) return;
    if (d.roomId != null) state.roomId = d.roomId;
    if (d.mode != null) state.roomMode = d.mode;
    if (isHello && d.name != null) state.roomName = d.name;
    if (d.status != null) state.roomStatus = d.status;
    if (typeof d.maxPlayers === 'number') state.roomMaxPlayers = d.maxPlayers;
    if (d.hostId != null) state.roomHostId = d.hostId;
    if (Array.isArray(d.mods)) state.roomMods = d.mods;
    if (d.noJoin != null) state.noJoin = !!d.noJoin;
    if (d.spectating != null) state.spectating = !!d.spectating;
    if (typeof d.remainingMs === 'number') state.remainingMs = d.remainingMs;
    state.countdownSec = (typeof d.countdownSec === 'number') ? d.countdownSec : null;
    state.leaderboard = Array.isArray(d.leaderboard) ? d.leaderboard : [];
    if (isHello) state.roomSettled = null;
  }
  function updateRoomUI() {
    updateCountdownBar();
    renderScoreBoard();
    renderLobbyPanel();
    if (dom.spectateBadge) dom.spectateBadge.hidden = !state.spectating;
    if (dom.statusDialog && !dom.statusDialog.hidden) { try { openStatusDialog(); } catch (e) {} }
  }
  function updateCountdownBar() {
    var el = dom.countdownBar; if (!el) return;
    var sec = state.countdownSec;
    var show = (state.roomStatus === 'running') && (typeof sec === 'number') && sec >= 0;
    if (!show) { el.hidden = true; return; }
    el.hidden = false;
    if (dom.countdownText) dom.countdownText.textContent = '剩余 ' + fmtClock(sec);
    el.classList.toggle('urgent', sec <= 60);
  }
  function renderScoreBoard() {
    var el = dom.scoreBoard; if (!el) return;
    var lb = Array.isArray(state.leaderboard) ? state.leaderboard : [];
    if (!lb.length) { el.hidden = true; return; }
    el.hidden = false;
    var rows = lb.slice().sort(function (a, b) { return (b.score || 0) - (a.score || 0); }).map(function (x, i) {
      var off = x.online === false;
      return '<div class="sb-row"><span class="sb-rank">' + (i + 1) + '</span>' +
        '<span class="sb-name' + (off ? ' off' : '') + '">' + esc(x.name || ('#' + x.id)) + (off ? ' [掉线]' : '') + '</span>' +
        '<span class="sb-score">' + Math.round(x.score || 0) + '</span></div>';
    }).join('');
    if (dom.scoreBoardBody) dom.scoreBoardBody.innerHTML = rows;
  }
  function renderLobbyPanel() {
    var el = dom.lobbyPanel; if (!el) return;
    var show = (state.roomMode === 'elim' && state.roomStatus === 'waiting');
    if (!show) { el.hidden = true; return; }
    el.hidden = false;
    var hostId = state.roomHostId || 0;
    var hostP = state.players.get(hostId);
    var isHost = (state.selfId === hostId) && !state.spectating;
    if (dom.lobbyTitle) dom.lobbyTitle.textContent = (state.roomName || '淘汰房') + ' · 候场';
    var players = Array.from(state.players.values());
    players.sort(function (a, b) {
      var ah = a.id === hostId ? 0 : 1, bh = b.id === hostId ? 0 : 1;
      if (ah !== bh) return ah - bh;
      if (!!a.bot !== !!b.bot) return a.bot ? 1 : -1;
      return a.id - b.id;
    });
    if (dom.lobbyPlayers) dom.lobbyPlayers.innerHTML = players.length ? players.map(function (p) {
      var tags = [];
      if (p.id === hostId) tags.push('房主');
      if (p.bot) tags.push('AI');
      if (p.online === false) tags.push('掉线');
      return '<div class="lobby-row"><span class="lobby-dot" style="--c:' + esc(displayColor(p.id)) + '"></span>' +
        '<span class="lobby-name">' + esc(p.name) + '</span><span class="lobby-tags">' + esc(tags.join(' · ')) + '</span></div>';
    }).join('') : '<div class="lobby-empty">暂无玩家</div>';
    if (dom.lobbyHost) dom.lobbyHost.textContent = '房主：' + (hostP ? hostP.name : '—') + ' · 在场 ' + players.length + ' / ' + state.roomMaxPlayers;
    if (dom.lobbyControls) dom.lobbyControls.hidden = !isHost;
    if (dom.lobbyStart) dom.lobbyStart.disabled = players.length < 2;
    if (dom.lobbyNote) dom.lobbyNote.textContent = isHost ? '你是房主：可添加 / 移除 AI，或在 ≥2 人时开始对局。' : (state.spectating ? '观战中，等待房主开始对局…' : '等待房主开始对局…');
  }
  function showRoomSettled(msg) {
    state.roomStatus = 'settled';
    state.roomSettled = msg || {};
    state.leaderboard = [];
    state.countdownSec = null;
    updateRoomUI();
    if (dom.rsTitle) dom.rsTitle.textContent = roomModeName() + ' · 战报';
    var reasonMap = { timeup: '时间到', 'only-ai': '仅剩 AI', 'last-standing': '唯一幸存者', elim: '淘汰赛结束' };
    if (dom.rsReason) dom.rsReason.textContent = reasonMap[msg && msg.reason] || ((msg && msg.reason) || '对局结束');
    var rankings = (msg && (msg.rankings || msg.leaderboard)) || [];
    rankings = rankings.slice().sort(function (a, b) {
      var ra = a.rank != null ? a.rank : 1e9, rb = b.rank != null ? b.rank : 1e9;
      if (ra !== rb) return ra - rb;
      return (b.score || 0) - (a.score || 0);
    });
    if (dom.rsBody) dom.rsBody.innerHTML = rankings.length ? rankings.map(function (x, i) {
      var rank = (x.rank != null) ? x.rank : (i + 1);
      return '<tr><td>' + rank + '</td><td>' + esc(x.name || ('#' + x.id)) + (x.online === false ? ' [掉线]' : '') + '</td>' +
        '<td>' + Math.round(x.score || 0) + '</td><td>' + (x.planets != null ? x.planets : '-') + '</td><td>' + (x.ships != null ? x.ships : '-') + '</td></tr>';
    }).join('') : '<tr><td colspan="5">无排行数据</td></tr>';
    if (dom.roomSettledModal) dom.roomSettledModal.hidden = false;
    sfx('capture');
  }
  function bindRoomUI() {
    if (dom.lobbyAddAI && !dom.lobbyAddAI.__rb) { dom.lobbyAddAI.__rb = true; dom.lobbyAddAI.addEventListener('click', function () { sendIntent({ t: 'roomAddAI' }); }); }
    if (dom.lobbyRemoveAI && !dom.lobbyRemoveAI.__rb) { dom.lobbyRemoveAI.__rb = true; dom.lobbyRemoveAI.addEventListener('click', function () { sendIntent({ t: 'roomRemoveAI' }); }); }
    if (dom.lobbyStart && !dom.lobbyStart.__rb) { dom.lobbyStart.__rb = true; dom.lobbyStart.addEventListener('click', function () { sendIntent({ t: 'roomStart' }); }); }
    if (dom.rsClose && !dom.rsClose.__rb) { dom.rsClose.__rb = true; dom.rsClose.addEventListener('click', function () { if (dom.roomSettledModal) dom.roomSettledModal.hidden = true; }); }
    if (dom.rsLobby && !dom.rsLobby.__rb) { dom.rsLobby.__rb = true; dom.rsLobby.addEventListener('click', function () { if (dom.roomSettledModal) dom.roomSettledModal.hidden = true; leaveToLobby(); }); }
    if (dom.roomSettledModal && !dom.roomSettledModal.__rb) { dom.roomSettledModal.__rb = true; dom.roomSettledModal.addEventListener('click', function (e) { if (e.target === dom.roomSettledModal) dom.roomSettledModal.hidden = true; }); }
    if (dom.scoreBoardToggle && !dom.scoreBoardToggle.__rb) { dom.scoreBoardToggle.__rb = true; dom.scoreBoardToggle.addEventListener('click', function (e) { e.stopPropagation(); if (dom.scoreBoard) dom.scoreBoard.classList.toggle('collapsed'); }); }
  }

  function bindStage2UI() {
    bindDispatchBar();
    bindHexMenu();
    bindConfirmModal();
    bindJointUI();
    bindMailOrb();
    bindDealDialog();
    bindDiploPanel();
    renderAllyBars(true);
    updateDispatchUI();
    renderMail();
    updateMailBadge();
    bindRoomUI();
    updateRoomUI();
  }

  function bindPointerGestures() {
    if (state.pointerBound) return;
    state.pointerBound = true;
    // ---- touch/pointer gestures: drag to pan, two-finger pinch to zoom, double tap to zoom in
    state.pointers = new Map();
    state.pinch = null;
    state.pointer = { down: false, moved: false, sx: 0, sy: 0, cx: 0, cy: 0, id: 0, type: 'mouse', x: 0, y: 0 };
    var lastTouchTap = { t: 0, x: 0, y: 0 };

    function zoomAt(clientX, clientY, factor) {
      var before = screenToWorld(clientX, clientY);
      state.cam.zoom = clamp(state.cam.zoom * factor, minZoom(), 1.8);
      clampCam();
      var after = screenToWorld(clientX, clientY);
      state.cam.tx += before.x - after.x;
      state.cam.ty += before.y - after.y;
      clampCam();
      state.cam.x = state.cam.tx;
      state.cam.y = state.cam.ty;
    }

    canvas.addEventListener('pointerdown', function (e) {
      initAudio();
      if (e.pointerType !== 'mouse') e.preventDefault();
      state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pointers.size === 2) {
        var pts = Array.from(state.pointers.values());
        state.pinch = { d: Math.max(10, dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y)), zoom: state.cam.zoom, cx: (pts[0].x + pts[1].x) / 2, cy: (pts[0].y + pts[1].y) / 2 };
        state.pointer.down = false;
        state.dragOrder = null;
        return;
      }
      if (state.pointers.size > 2) return;
      state.pointer = { down: true, moved: false, sx: e.clientX, sy: e.clientY, cx: e.clientX, cy: e.clientY, id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY };
      state.longPressFired = false;
      state.dragOrder = null;   // 新手势开始：重置残留拖拽派遣
      if (e.pointerType !== 'mouse') startLongPress(e.clientX, e.clientY);
    });

    canvas.addEventListener('pointermove', function (e) {
      state.pointer.x = e.clientX;
      state.pointer.y = e.clientY;
      if (state.pointers.has(e.pointerId)) state.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (state.pinch && state.pointers.size >= 2) {
        var pts = Array.from(state.pointers.values());
        var d = dist(pts[0].x, pts[0].y, pts[1].x, pts[1].y);
        var mx = (pts[0].x + pts[1].x) / 2, my = (pts[0].y + pts[1].y) / 2;
        if (d > 4) zoomAt(mx, my, (state.pinch.zoom * (d / state.pinch.d)) / state.cam.zoom);
        state.cam.tx -= (mx - state.pinch.cx) / state.cam.zoom;
        state.cam.ty -= (my - state.pinch.cy) / state.cam.zoom;
        state.pinch.cx = mx; state.pinch.cy = my;
        clampCam();
        state.cam.x = state.cam.tx;
        state.cam.y = state.cam.ty;
        return;
      }
      if (!state.pointer.down) return;
      if (state.pointer.id && e.pointerId !== state.pointer.id) return;
      dragTo(e.clientX, e.clientY);
    });

    function endPointer(e) {
      clearTimeout(state.longPressTimer);
      state.pointers.delete(e.pointerId);
      if (state.pointers.size < 2) state.pinch = null;
      if (!state.pointer.down || e.pointerId !== state.pointer.id) return;
      state.pointer.down = false;
      if (e.type !== 'pointerup') { state.dragOrder = null; return; }
      if (state.dragOrder && state.dragOrder.active) { finishDragOrder(e.clientX, e.clientY); return; }
      if (state.pointer.moved) return;
      if (state.longPressFired) { state.longPressFired = false; return; }
      var now = performance.now();
      if (state.pointer.type !== 'mouse' && now - lastTouchTap.t < 300 && dist(e.clientX, e.clientY, lastTouchTap.x, lastTouchTap.y) < 40) {
        // double tap on the map: zoom in (out if already close in)
        zoomAt(e.clientX, e.clientY, state.cam.zoom < 0.35 ? 1.9 : 0.5);
        lastTouchTap.t = 0;
        return;
      }
      if (state.pointer.type !== 'mouse') lastTouchTap = { t: now, x: e.clientX, y: e.clientY };
      handleTap(e.clientX, e.clientY);
    }
    dbg('gesture path: pointer');
    window.addEventListener('pointerup', endPointer);
    window.addEventListener('pointercancel', endPointer);
    window.addEventListener('pointerleave', function (e) { if (e.pointerId === state.pointer.id) state.pointer.down = false; });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.14 : 0.88);
    }, { passive: false });
    // some mobile browsers fire touch events without pointer events
    canvas.addEventListener('touchmove', function (e) { e.preventDefault(); }, { passive: false });
    canvas.addEventListener('dblclick', function (e) {
      var hit = pickAt(e.clientX, e.clientY);
      if (!hit) zoomAt(e.clientX, e.clientY, 1.6);
    });
  }

  function bindKeyboardAndMenus() {
    if (state.menusBound) return;
    state.menusBound = true;
    window.addEventListener('keydown', function (e) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.code === 'Escape') { if (state.chatOpen) closeChat(); if (state.helpOpen) closeHelp(); document.activeElement.blur(); }
        return;
      }
      if (e.code === 'Escape') { if (state.chatOpen) closeChat(); else if (state.helpOpen) closeHelp(); else { state.factionView = 0; selectPlanet(0); dom.orderPanel.hidden = true; } return; }
      if (e.code === 'Enter') { e.preventDefault(); if (state.joined) openChat(); return; }
      if (e.code === 'KeyM') { toggleSound(); return; }
      if (e.code === 'KeyH') { toggleHelp(); return; }
      if (e.code === 'KeyF') { var meP = selfPlayer(); var hpP = meP && state.planets.get(meP.homePlanet); if (hpP) { state.cam.tx = hpP.x; state.cam.ty = hpP.y; } clampCam(); return; }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') { zoomAt(viewW() / 2, viewH() / 2, 1.2); return; }
      if (e.code === 'Minus' || e.code === 'NumpadSubtract') { zoomAt(viewW() / 2, viewH() / 2, 0.83); return; }
      var pl = planetById(state.selPlanet);
      if (!pl || pl.owner !== state.selfId) return;
      if (e.code === 'ArrowRight' || e.code === 'ArrowUp') { state.sliderValue = sliderCount(pl) + (e.shiftKey ? 10 : 1); updateOrderPanel(); e.preventDefault(); }
      if (e.code === 'ArrowLeft' || e.code === 'ArrowDown') { state.sliderValue = sliderCount(pl) - (e.shiftKey ? 10 : 1); updateOrderPanel(); e.preventDefault(); }
    });
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', function () { setTimeout(resize, 250); });
    window.addEventListener('beforeunload', function () { if (state.ws && state.joined) { try { state.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {} } });

    var me = function () { var p = selfPlayer(); return p; };
    if (dom.minimap) {
      dom.minimap.addEventListener('pointerdown', function (e) {
        var r = dom.minimap.getBoundingClientRect();
        var w = dom.minimap.width, h = dom.minimap.height;
        var pad = 4;
        var sc = Math.min((w - pad * 2) / state.world.w, (h - pad * 2) / state.world.h);
        var ox = (w - state.world.w * sc) / 2, oy = (h - state.world.h * sc) / 2;
        var wx = ((e.clientX - r.left) / r.width * w - ox) / sc;
        var wy = ((e.clientY - r.top) / r.height * h - oy) / sc;
        state.cam.tx = clamp(wx, 0, state.world.w);
        state.cam.ty = clamp(wy, 0, state.world.h);
        clampCam();
        e.stopPropagation();
      });
    }
    // menu toggle is click-only so pointerdown/outlining cannot cancel it
    if (dom.menuBtn && !dom.menuBtn.__menuBound) {
      dom.menuBtn.__menuBound = true;
      dom.menuBtn.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); dom.hudMenu.hidden = !dom.hudMenu.hidden; });
    }
    if (dom.hudMenu) {
      dom.hudMenu.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-menu]');
        if (!btn) return;
        var act = btn.getAttribute('data-menu');
        dom.hudMenu.hidden = true;
        if (act === 'chat') { if (state.chatOpen) closeChat(); else openChat(); }
        else if (act === 'sound') { toggleSound(); }
        else if (act === 'settings') { openSettings(); }
        else if (act === 'help') toggleHelp();
        else if (act === 'home') { var meP = selfPlayer(); var hpP = meP && state.planets.get(meP.homePlanet); if (hpP) { state.cam.tx = hpP.x; state.cam.ty = hpP.y; } clampCam(); }
        else if (act === 'zoomIn') zoomAt(viewW() / 2, viewH() / 2, 1.25);
        else if (act === 'zoomOut') zoomAt(viewW() / 2, viewH() / 2, 0.8);
        else if (act === 'factions') {
          if (dom.factionPanel) {
            dom.factionPanel.hidden = !dom.factionPanel.hidden;
            if (!dom.factionPanel.hidden && dom.tabFactions) dom.tabFactions.click();
          }
        }
        else if (act === 'status') openStatusDialog();
        else if (act === 'exportSave') { exportSandboxSave(); }
        else if (act === 'leave') { leaveToLobby(); }
      });
      document.addEventListener('pointerdown', function (e) {
        setTimeout(function () {
          if (dom.hudMenu.hidden) return;
          if (dom.hudMenu.contains(e.target) || dom.menuBtn.contains(e.target) || (e.target && e.target.closest && e.target.closest('#menuBtn'))) return;
          dom.hudMenu.hidden = true;
        }, 0);
      });
    }
    if (dom.statusClose) dom.statusClose.addEventListener('click', function () { closeModalAnimated(dom.statusDialog); });
    dom.helpClose.addEventListener('click', closeHelp);
    dom.chatForm.addEventListener('submit', function (e) { e.preventDefault(); sendChat(); });
    dom.chatInput.addEventListener('focus', function () { state.typing = true; });
    dom.chatInput.addEventListener('blur', function () { state.typing = false; });
    dom.chatPanel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    bindChatChannels();
    bindPanelActions();
  }


  function bindZoomButtons() {
    var zi = document.getElementById('zoomIn'), zo = document.getElementById('zoomOut'), zf = document.getElementById('zoomFit');
    if (zi) zi.addEventListener('click', function (e) { e.stopPropagation(); zoomAt(viewW() / 2, viewH() / 2, 1.3); });
    if (zo) zo.addEventListener('click', function (e) { e.stopPropagation(); zoomAt(viewW() / 2, viewH() / 2, 0.77); });
    if (zf) zf.addEventListener('click', function (e) { e.stopPropagation(); state.cam.zoom = minZoom(); clampCam(); state.cam.x = state.cam.tx; state.cam.y = state.cam.ty; });
  }

  function toggleSound() {
    state.muted = !state.muted;
    storeSet('of.muted', state.muted ? '1' : '0');
    if (!state.muted) initAudio();
    syncSoundBtn();
    if (!state.muted) sfx('click');
  }
  /* ---- Task D：双通道聊天 + 折叠 + 冷却 + #截获 ---- */
  function renderChatChannelButtons() {
    var ch = state.chatChannel === 'ally' ? 'ally' : 'global';
    if (dom.chatChGlobal) dom.chatChGlobal.classList.toggle('on', ch === 'global');
    if (dom.chatChAlly) dom.chatChAlly.classList.toggle('on', ch === 'ally');
    if (dom.chatInput) dom.chatInput.placeholder = ch === 'ally' ? '向联盟频道发送密讯…' : '向全局频道发送讯息…';
  }
  function setChatChannel(ch) {
    state.chatChannel = ch === 'ally' ? 'ally' : 'global';
    renderChatChannelButtons();
    applyChatFilter();
    sfx('click');
  }
  function applyChatFilter() {
    if (!dom.chatLog) return;
    var ch = state.chatChannel === 'ally' ? 'ally' : 'global';
    Array.prototype.forEach.call(dom.chatLog.children, function (line) {
      var lc = line.getAttribute('data-channel') || 'global';
      var show = (lc === 'sys') || (ch === 'ally' ? lc === 'ally' : lc === 'global');
      line.style.display = show ? '' : 'none';
    });
  }
  function toggleChatCollapse() {
    state.chatCollapsed = !state.chatCollapsed;
    if (dom.chatPanel) dom.chatPanel.classList.toggle('collapsed', state.chatCollapsed);
    if (dom.chatCollapse) dom.chatCollapse.textContent = state.chatCollapsed ? '▸' : '▾';
    if (!state.chatCollapsed && state.chatOpen) { try { dom.chatInput.focus(); } catch (e) {} }
    sfx('click');
  }
  function updateChatCooldownUI() {
    var remain = Math.max(0, 2000 - (Date.now() - (state.lastChatAt || 0)));
    if (dom.chatSend) dom.chatSend.disabled = remain > 0;
    if (dom.chatCool) dom.chatCool.textContent = remain > 0 ? ('冷却 ' + (remain / 1000).toFixed(1) + 's') : '';
  }
  function bindChatChannels() {
    if (dom.chatChannels && !dom.chatChannels.__bound) {
      dom.chatChannels.__bound = true;
      dom.chatChannels.addEventListener('click', function (e) {
        var b = e.target.closest('[data-ch]'); if (!b) return;
        setChatChannel(b.getAttribute('data-ch'));
      });
    }
    if (dom.chatCollapse && !dom.chatCollapse.__bound) {
      dom.chatCollapse.__bound = true;
      dom.chatCollapse.addEventListener('click', function (e) { e.stopPropagation(); toggleChatCollapse(); });
    }
    if (!state.chatCoolTimer) state.chatCoolTimer = setInterval(updateChatCooldownUI, 200);
    renderChatChannelButtons();
    updateChatCooldownUI();
  }
  function sendChat() {
    var text = ((dom.chatInput && dom.chatInput.value) || '').trim();
    if (!text) return;
    var ch = state.chatChannel === 'ally' ? 'ally' : 'global';
    var me = selfPlayer();
    if (ch === 'ally' && (!me || !me.coalition)) { toast('尚未加入联盟，无法发送联盟频道', true); return; }
    if (!wsOpen() || !state.joined) { toast('链路未连接', true); return; }
    var remain = 2000 - (Date.now() - (state.lastChatAt || 0));
    if (remain > 0) { toast('发言冷却中 · ' + (remain / 1000).toFixed(1) + 's', true); return; }
    if (sendIntent({ t: 'chat', text: text, channel: ch })) {
      dom.chatInput.value = '';
      state.lastChatAt = Date.now();
      updateChatCooldownUI();
    }
  }
  function openChat() {
    state.chatOpen = true;
    dom.chatPanel.hidden = false;
    state.unread = 0; dom.chatBadge.hidden = true;
    if (state.helpOpen) closeHelp();
    state.chatCollapsed = false;   // 打开聊天即展开，便于直接用键盘输入
    if (dom.chatPanel) dom.chatPanel.classList.remove('collapsed');
    if (dom.chatCollapse) dom.chatCollapse.textContent = '▾';
    renderChatChannelButtons();
    applyChatFilter();
    updateChatCooldownUI();
    setTimeout(function () { try { dom.chatInput.focus(); } catch (e) {} }, 30);
  }
  function closeChat() { state.chatOpen = false; dom.chatPanel.hidden = true; dom.chatInput.blur(); state.typing = false; }
  function toggleHelp() { if (state.helpOpen) closeHelp(); else { state.helpOpen = true; dom.helpPanel.hidden = false; if (state.chatOpen) closeChat(); } }
  function closeHelp() { state.helpOpen = false; if (dom.helpPanel) closeModalAnimated(dom.helpPanel); }

  function addChat(msg) {
    if (!msg) return;
    var isIntercept = !!msg.intercept;
    var ch = msg.sys ? 'sys' : (msg.channel === 'ally' ? 'ally' : 'global');
    var line = document.createElement('div');
    line.className = 'chat-line' + (msg.sys ? ' sys' : '') + (isIntercept ? ' intercept' : '');
    line.setAttribute('data-channel', ch);
    if (msg.sys) {
      line.textContent = msg.text;
    } else if (isIntercept) {
      // #截获：醒目琥珀色、隐藏发送者
      var ico = document.createElement('span'); ico.className = 'ico'; ico.textContent = '[#截获]';
      var txtI = document.createElement('span'); txtI.className = 'txt';
      txtI.textContent = String(msg.text || '').replace(/^\s*\[#截获\]\s*/, '');
      line.appendChild(ico); line.appendChild(txtI);
    } else {
      var who = document.createElement('span'); who.className = 'who';
      var p = state.players.get(msg.id); who.style.color = p ? displayColor(p.id) : '#8bdde8';
      who.textContent = msg.name || '未知';
      var txt = document.createElement('span'); txt.className = 'txt'; txt.textContent = msg.text;
      line.appendChild(who); line.appendChild(txt);
    }
    dom.chatLog.appendChild(line);
    while (dom.chatLog.children.length > 60) dom.chatLog.removeChild(dom.chatLog.firstChild);
    applyChatFilter();
    dom.chatLog.scrollTop = dom.chatLog.scrollHeight;
    if (!msg.sys && !state.chatOpen) {
      state.unread = Math.min(9, state.unread + 1);
      if (dom.chatBadge) { dom.chatBadge.hidden = false; dom.chatBadge.textContent = String(state.unread); }
    }
  }

  /* ---------------- boot ---------------- */
  function installProbe() {
    if (!/(^|[?&])probe=1/.test(location.search)) return;
    state.probe = { down: 0, move: 0, up: 0, drag: 0, wheel: 0, zoomIn: 0, pinch: 0 };
    var el = document.createElement('pre');
    el.id = 'probeBox';
    el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:999;margin:0;padding:8px 10px;font:11px/1.45 monospace;color:#9ff;background:rgba(0,0,0,.78);border:1px solid #2ee;pointer-events:none;white-space:pre;';
    document.body.appendChild(el);
    var p = state.probe;
    setInterval(function () {
      el.textContent = 'cam x=' + Math.round(state.cam.x) + ' y=' + Math.round(state.cam.y) +
        ' zoom=' + state.cam.zoom.toFixed(3) + ' min=' + minZoom().toFixed(3) +
        '\nview ' + viewW() + 'x' + viewH() + ' dpr=' + state.dpr +
        '\ndown=' + p.down + ' move=' + p.move + ' up=' + p.up + ' drag=' + p.drag +
        '\nwheel=' + p.wheel + ' zoomEvents=' + p.zoomIn + ' pinch=' + p.pinch +
        '\npt.type=' + (state.pointer && state.pointer.type) + ' bound=' + (state.inputBound ? 'y' : 'n');
    }, 250);
    var tg = function (name, hook) {
      canvas.addEventListener(name, function (e) { p[hook] = (p[hook] || 0) + 1; }, { passive: true, capture: true });
    };
    tg('touchstart', 'down'); tg('touchmove', 'move'); tg('touchend', 'up');
    tg('pointerdown', 'down'); tg('pointermove', 'move'); tg('pointerup', 'up');
    tg('wheel', 'wheel');
    var b = document.getElementById('menuBtn');
    if (b) b.addEventListener('click', function () { /* reserved for future counters */ });
  }

  function exposeDebug() {
    window.__of = {
      state: state,
      pickAt: pickAt,
      handleTap: handleTap,
      screenOf: function (pl) {
        var z = state.cam.zoom;
        return { x: (pl.x - state.cam.x) * z + viewW() / 2, y: (pl.y - state.cam.y) * z + viewH() / 2 };
      },
      focus: function (x, y) { state.cam.x = state.cam.tx = x; state.cam.y = state.cam.ty = y; },
      longPress: function (x, y) { startLongPress(x, y); }
    };
    window.__modSandbox = ModSandbox;   // Task G：QA 可测试入口
    window.__portal = { state: portal, showView: showPortalView, refreshHall: refreshHall, joinRoom: joinRoom, leaveToLobby: leaveToLobby, portalBoot: portalBoot, connectRoom: connectRoom, resolveGameWsUrl: resolveGameWsUrl, updateServerChip: updateServerChip, startHallPoll: startHallPoll, stopHallPoll: stopHallPoll };   // H3/H4.1：QA 入口
  }

  /* ================= Stage 4 · H3：门户四视图 + 房间大厅 ================= */
  var portal = {
    session: storeGet('of.session') || '',
    profile: (function () { try { return JSON.parse(storeGet('of.profile') || 'null'); } catch (e) { return null; } })(),
    version: '', mods: [], rooms: [], endless: null, view: 'auth', afterRecovery: null,
    hallFilter: 'all', selectedRoom: null, announcement: '', lastNodeOk: true, lastHumans: 0, adminData: null
  };
  function apiJson(path, opts) {
    opts = opts || {};
    var headers = Object.assign({}, opts.headers || {});
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (portal.session) headers['Authorization'] = 'Bearer ' + portal.session;
    var init = { method: opts.method || 'GET', headers: headers, cache: 'no-store' };
    if (opts.body) init.body = JSON.stringify(opts.body);
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { status: r.status, ok: r.ok, data: d || {} }; });
    }).catch(function (e) { return { status: 0, ok: false, data: { error: String((e && e.message) || e) } }; });
  }
  function errText(res) {
    var d = (res && res.data) || {};
    if (d.error === 'already_initialized') return '系统已完成初始化';
    if (d.error === 'invalid_bootstrap_token') return 'Bootstrap Token 无效';
    if (d.error === 'invalid_credentials') return '用户名或密码错误';
    if (d.error === 'rate_limited' || (res && res.status === 429)) return '操作过于频繁，请稍后再试';
    return d.message || d.error || ('请求失败 HTTP ' + ((res && res.status) || '0'));
  }
  function pval(el) { return el ? String(el.value || '').trim() : ''; }
  function setMsg(el, text, ok) { if (!el) return; el.textContent = text || ''; el.classList.toggle('ok', !!ok); }
  function resolveGameWsUrl(raw) {
    var s = String(raw || '').trim();
    var isHttps = (typeof location !== 'undefined') && location.protocol === 'https:';
    var proto = isHttps ? 'wss://' : 'ws://';
    var host = (typeof location !== 'undefined' && location.host) ? location.host : '';
    var hostname = (typeof location !== 'undefined' && location.hostname) ? location.hostname : '';
    if (s.indexOf('/') === 0) return proto + host + s;
    if (s.indexOf('{host}') >= 0) return s.replace(/\{host\}/g, host);
    if (/^wss?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(s) && !/^(127\.0\.0\.1|localhost)$/i.test(hostname)) {
      return proto + host + '/ws';
    }
    if (!s) return proto + host + '/ws';
    return s;
  }
  function normRecoveryCode(code) {
    var a = String(code || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
    if (a.length === 12) return a.slice(0, 4) + '-' + a.slice(4, 8) + '-' + a.slice(8, 12);
    return String(code || '');
  }
  function updateServerChip(portalOk, nodeOk, humans) {
    if (dom.chip) dom.chip.classList.toggle('offline', !portalOk);
    if (dom.chipText) dom.chipText.textContent = portalOk ? ('门户在线 · ' + (nodeOk ? '节点在线' : '节点离线') + ' · 在线指挥官 ' + (humans || 0) + ' 人') : '门户离线';
    if (dom.chipCount) dom.chipCount.textContent = '';
  }
  function savePortalSession(token, profile) {
    portal.session = token || '';
    portal.profile = profile || null;
    if (token) storeSet('of.session', token); else { try { localStorage.removeItem('of.session'); } catch (e) {} }
    if (profile) storeSet('of.profile', JSON.stringify(profile)); else { try { localStorage.removeItem('of.profile'); } catch (e) {} }
  }
  function loadSettings() { try { var s = JSON.parse(storeGet('of.settings') || 'null'); if (s) Object.assign(state.settings, s); } catch (e) {} }
  function saveSettings() { storeSet('of.settings', JSON.stringify(state.settings)); }
  function applySettings() {
    state.settings.volume = clamp(Number(state.settings.volume) || 0, 0, 100);
    state.settings.nebula = clamp(Number(state.settings.nebula) || 100, 20, 100);
    if (audio.master) audio.master.gain.value = state.muted ? 0 : (state.settings.volume / 100 * 0.3);
    if (dom.fpsBadge) dom.fpsBadge.hidden = !state.settings.showFps;
    try { resize(); } catch (e) {}
  }
  function openSettings() {
    if (!dom.settingsModal) return;
    if (dom.setVolume) dom.setVolume.value = String(state.settings.volume);
    if (dom.setUiSfx) dom.setUiSfx.checked = !!state.settings.uiSfx;
    if (dom.setQuality) dom.setQuality.value = state.settings.quality;
    if (dom.setNebula) dom.setNebula.value = String(state.settings.nebula);
    if (dom.setShowFps) dom.setShowFps.checked = !!state.settings.showFps;
    if (dom.setRotPlanet) dom.setRotPlanet.checked = state.settings.planetRotate !== false;
    if (dom.setNebulaFlow) dom.setNebulaFlow.checked = state.settings.nebulaFlow !== false;
    if (dom.setParticles) dom.setParticles.checked = state.settings.particles !== false;
    if (dom.setEngineTrails) dom.setEngineTrails.checked = state.settings.engineTrails !== false;
    if (dom.setPlanetRings) dom.setPlanetRings.checked = state.settings.planetRings !== false;
    dom.settingsModal.hidden = false; sfx('modalOpen');
  }
  function closeSettings() { if (dom.settingsModal) closeModalAnimated(dom.settingsModal); sfx('modalClose'); }
  function bindSettings() {
    if (!dom.settingsModal || dom.settingsModal.__b) return; dom.settingsModal.__b = true;
    if (dom.settingsClose) dom.settingsClose.addEventListener('click', closeSettings);
    dom.settingsModal.addEventListener('click', function (e) { if (e.target === dom.settingsModal) closeSettings(); });
    function ch() {
      if (dom.setVolume) state.settings.volume = Number(dom.setVolume.value) || 0;
      if (dom.setUiSfx) state.settings.uiSfx = !!dom.setUiSfx.checked;
      if (dom.setQuality) state.settings.quality = dom.setQuality.value;
      if (dom.setNebula) state.settings.nebula = Number(dom.setNebula.value) || 100;
      if (dom.setShowFps) state.settings.showFps = !!dom.setShowFps.checked;
      if (dom.setRotPlanet) state.settings.planetRotate = !!dom.setRotPlanet.checked;
      if (dom.setNebulaFlow) state.settings.nebulaFlow = !!dom.setNebulaFlow.checked;
      if (dom.setParticles) state.settings.particles = !!dom.setParticles.checked;
      if (dom.setEngineTrails) state.settings.engineTrails = !!dom.setEngineTrails.checked;
      if (dom.setPlanetRings) state.settings.planetRings = !!dom.setPlanetRings.checked;
      applySettings(); saveSettings();
    }
    ['setVolume', 'setUiSfx', 'setQuality', 'setNebula', 'setShowFps', 'setRotPlanet', 'setNebulaFlow', 'setParticles', 'setEngineTrails', 'setPlanetRings'].forEach(function (k) { if (dom[k]) { dom[k].addEventListener('input', ch); dom[k].addEventListener('change', ch); } });
  }
  function updateHomeHeader() {
    var p = portal.profile || {};
    if (dom.homeUser) dom.homeUser.textContent = p.username || '指挥官';
    var role = p.role === 'admin' ? 'ADMIN' : 'COMMANDER';
    if (dom.homeRole) { dom.homeRole.textContent = role; dom.homeRole.classList.toggle('admin', p.role === 'admin'); }
    if (dom.homeAvatar) dom.homeAvatar.textContent = String(p.username || 'CMD').slice(0, 2).toUpperCase();
    if (dom.homeNoticeBtn) dom.homeNoticeBtn.hidden = false;
    var ann = portal.announcement || '';
    if (dom.homeAnnounce) { dom.homeAnnounce.hidden = !ann; dom.homeAnnounce.textContent = ann ? ('· ' + ann) : ''; }
  }
  function updateHomeStatus() {
    if (!dom.homeStatus) return;
    var humans = portal.lastHumans || 0, nodeOk = portal.lastNodeOk !== false;
    dom.homeStatus.textContent = '● 门户在线 · ' + (nodeOk ? '节点在线' : '节点离线') + ' · ' + humans + ' 人在战';
  }
  function enterHome() {
    if (!portal.session) { showPortalView('auth'); return; }
    showPortalView('home');
    updateHomeHeader(); updateHomeStatus(); refreshHall(true);
    // 5.4 §2.1：登录后按「距上次活跃是否超过 5 分钟」决定 居中待机 还是 直接进菜单
    state.heroStage = resolveHeroStage();
    if (state.heroStage === 'menu') touchActive();
    applyHeroStage();
    showPortraitHintOnce();
  }
  function quickMatch() {
    var list = (portal.rooms || []).filter(function (r) { return r.mode === 'normal' && r.canJoin !== false; });
    if (!list.length) { toast('当前没有可快速加入的普通房，请前往房间大厅刷新', true); return; }
    joinRoom(list[0].roomId, false);
  }
  function showPortalView(name) {
    portal.view = name;
    if (name !== 'hall') stopHallPoll();
    if (dom.start) { dom.start.hidden = false; dom.start.classList.remove('leaving'); }
    if (dom.hud) dom.hud.hidden = true;
    if (dom.bootstrapView) dom.bootstrapView.hidden = name !== 'bootstrap';
    if (dom.authView) dom.authView.hidden = name !== 'auth';
    if (dom.homeView) dom.homeView.hidden = name !== 'home';
    if (dom.lobbyHallView) dom.lobbyHallView.hidden = name !== 'hall';
  }
  function showRecovery(code, afterFn, tempPassword) {
    portal.afterRecovery = typeof afterFn === 'function' ? afterFn : null;
    if (dom.recoveryCode) dom.recoveryCode.textContent = code || '—';
    if (dom.recoveryTemp) {
      if (tempPassword) { dom.recoveryTemp.hidden = false; dom.recoveryTemp.innerHTML = '临时密码：<b>' + esc(tempPassword) + '</b>'; }
      else { dom.recoveryTemp.hidden = true; dom.recoveryTemp.innerHTML = ''; }
    }
    if (dom.recoveryModal) dom.recoveryModal.hidden = false;
  }
  function hideRecovery() {
    if (dom.recoveryModal) dom.recoveryModal.hidden = true;
    var cb = portal.afterRecovery; portal.afterRecovery = null;
    if (cb) { try { cb(); } catch (e) {} }
  }

  // ---- 视图① 首启初始化 ----
  function doBootstrap(ev) {
    if (ev) ev.preventDefault();
    var token = pval(dom.bootToken), user = pval(dom.bootUser), pass = pval(dom.bootPass);
    if (!token || !user || !pass) { setMsg(dom.bootMsg, '请完整填写 Token / 呼号 / 密码', false); return; }
    setMsg(dom.bootMsg, '正在初始化…', true);
    apiJson('/api/bootstrap/init', { method: 'POST', body: { token: token, username: user, password: pass } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        savePortalSession(res.data.sessionToken || '', { uid: res.data.uid, username: res.data.username || user, role: res.data.role || 'admin' });
        setMsg(dom.bootMsg, '初始化成功', true);
        showRecovery(res.data.recoveryCode, function () { enterHome(); });
      } else {
        setMsg(dom.bootMsg, errText(res), false);
      }
    });
  }

  // ---- 视图② 认证 ----
  function setAuthTab(name) {
    if (dom.tabLogin) dom.tabLogin.classList.toggle('on', name === 'login');
    if (dom.tabRegister) dom.tabRegister.classList.toggle('on', name === 'register');
    if (dom.tabReset) dom.tabReset.classList.toggle('on', name === 'reset');
    if (dom.loginForm) dom.loginForm.hidden = name !== 'login';
    if (dom.regForm) dom.regForm.hidden = name !== 'register';
    if (dom.resetForm) dom.resetForm.hidden = name !== 'reset';
    setMsg(dom.authMsg, '', false);
  }
  function doLoginWith(user, pass) {
    apiJson('/api/login', { method: 'POST', body: { username: user, password: pass } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        savePortalSession(res.data.sessionToken || '', { uid: res.data.uid, username: user, role: res.data.role || 'user', activeRoom: res.data.activeRoom });
        setMsg(dom.authMsg, '登录成功', true);
        enterHome();
      } else {
        setMsg(dom.authMsg, errText(res), false);
      }
    });
  }
  function doLogin(ev) { if (ev) ev.preventDefault(); doLoginWith(pval(dom.loginUser), pval(dom.loginPass)); }
  function doRegister(ev) {
    if (ev) ev.preventDefault();
    var user = pval(dom.regUser), pass = pval(dom.regPass);
    if (!user || !pass) { setMsg(dom.authMsg, '请输入用户名与密码', false); return; }
    setMsg(dom.authMsg, '正在注册…', true);
    apiJson('/api/register', { method: 'POST', body: { username: user, password: pass } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        setMsg(dom.authMsg, '注册成功 · 请保存恢复码', true);
        showRecovery(res.data.recoveryCode, null);
        doLoginWith(user, pass);   // 自动登录
      } else {
        setMsg(dom.authMsg, errText(res), false);
      }
    });
  }
  function doReset(ev) {
    if (ev) ev.preventDefault();
    var user = pval(dom.resetUser), code = pval(dom.resetCode), pass = pval(dom.resetPass);
    if (!user || !code || !pass) { setMsg(dom.authMsg, '请完整填写用户名 / 恢复码 / 新密码', false); return; }
    setMsg(dom.authMsg, '正在重置…', true);
    apiJson('/api/reset-password', { method: 'POST', body: { username: user, recoveryCode: code, newPassword: pass } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        setMsg(dom.authMsg, '重置成功 · 已生成新恢复码', true);
        showRecovery(res.data.recoveryCode, null);
      } else {
        setMsg(dom.authMsg, errText(res), false);
      }
    });
  }

  // ---- 视图③ 房间大厅 ----
  function updateHallHeader() {
    var p = portal.profile || {};
    if (dom.hallUser) dom.hallUser.textContent = p.username || '指挥官';
    var role = p.role === 'admin' ? 'ADMIN' : 'COMMANDER';
    if (dom.hallRole) { dom.hallRole.textContent = role; dom.hallRole.classList.toggle('admin', p.role === 'admin'); }
    if (dom.hallAvatar) dom.hallAvatar.textContent = String(p.username || 'CMD').slice(0, 2).toUpperCase();
    if (dom.hallVersion) dom.hallVersion.textContent = portal.version ? ('v' + portal.version) : 'v—';
    var __modsVisible = (portal.mods || []).filter(function (m) { return m.id !== 'nebula-overdrive' && m.builtin !== true; });
    if (dom.hallMods) dom.hallMods.textContent = __modsVisible.length ? ('Mod: ' + __modsVisible.map(function (m) { return (m.name || m.id) + (m.version ? (' v' + m.version) : ''); }).join(' / ')) : '';
    if (dom.adminBtn) dom.adminBtn.hidden = p.role !== 'admin';
  }
  function roomCardHtml(r) {
    var isAdmin = portal.profile && portal.profile.role === 'admin';
    var canJoin = r.canJoin !== false;
    var name = r.name || r.roomId || '房间';
    var statusName = r.status === 'waiting' ? '候场' : r.status === 'running' ? '进行中' : r.status === 'settled' ? '已结算' : (r.status || '');
    var remMs = (typeof r.remainingMs === 'number') ? r.remainingMs : null;
    var rem = (remMs != null && remMs > 0) ? (' · 剩余 ' + fmtClock(Math.floor(remMs / 1000))) : '';
    var closing = (r.mode === 'normal' && remMs != null && remMs <= 300000 && remMs > 0);
    var warn = closing ? ' <span class="rc-warn">禁入期</span>' : '';
    var sub = '真人 ' + (r.humans || 0) + '/' + (r.maxPlayers || 8) + (r.bots ? (' · AI ' + r.bots) : '') + rem + ' · ' + statusName;
    var extra = '';
    if (r.mode === 'elim') {
      var hostLabel = '房主：' + (r.hostName || (r.hostId ? ('#' + r.hostId) : '候场中'));
      extra += '<div class="rc-host">' + esc(hostLabel) + ' · 席位 ' + (r.humans || 0) + '/' + (r.maxPlayers || 8) + '</div>';
      var total = r.maxPlayers || 8, seats = '';
      for (var si = 0; si < total; si++) {
        var cls = 'rc-seat';
        if (si < (r.humans || 0)) cls += ' on';
        if (r.hostId && si === 0) cls += ' host';
        seats += '<span class="' + cls + '"></span>';
      }
      extra += '<div class="rc-seats">' + seats + '</div>';
    }
    var actions = canJoin ? '<button class="btn primary" data-enter="' + esc(r.roomId) + '">进入星域</button>' : '<button class="btn" disabled>满员/禁入</button>';
    if (isAdmin) actions += '<button class="btn" data-spectate="' + esc(r.roomId) + '">上帝观战</button>';
    return '<div class="room-card' + (closing ? ' closing' : '') + '"><div class="rc-name">' + esc(name) + warn + '</div><div class="rc-sub">' + esc(sub) + '</div>' + extra + '<div class="rc-actions">' + actions + '</div></div>';
  }
  function mcPingBars() {
    var n = 3 + Math.floor(Math.random() * 3), s = '';
    for (var i = 0; i < 5; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return s;
  }
  function mcRowHtml(r) {
    var mode = r.mode || 'normal';
    var sel = (portal.selectedRoom === r.roomId);
    var iconCls = mode === 'elim' ? 'elim' : mode === 'endless' ? 'endless' : '';
    var pill = mode === 'elim' ? '<span class="mc-pill elim">淘汰 25m</span>' : (mode === 'endless' ? '<span class="mc-pill endless">无尽</span>' : '<span class="mc-pill">普通 40m</span>');
    var node = r.nodeId ? ('<span class="mc-node">' + esc(r.nodeId) + '</span>') : '';
    var remMs = (typeof r.remainingMs === 'number') ? r.remainingMs : null;
    var rem = (remMs != null && remMs > 0) ? ('剩余 ' + fmtClock(Math.floor(remMs / 1000))) : '';
    var closing = (mode === 'normal' && remMs != null && remMs <= 300000 && remMs > 0);
    var motd;
    if (mode === 'elim') {
      motd = '房主 ' + (r.hostName || (r.hostId ? ('#' + r.hostId) : '候场中')) + ' 候场中 · 满 2 人开局 · 个人死斗禁结盟';
    } else if (mode === 'endless') {
      motd = '无尽模式 · 敬请期待（持久化 Mod 专服）';
    } else {
      motd = '星域激战中' + (rem ? (' · ' + rem) : '');
    }
    if (closing) motd += ' <span class="warn">决战禁入期</span>';
    var humans = r.humans || 0, max = r.maxPlayers || 8, bots = r.bots || 0;
    var seatdots = '';
    if (mode === 'elim') {
      for (var i = 0; i < max; i++) {
        var cls = 'mc-seatdot' + (i < humans ? ' on' : '') + (r.hostId && i === 0 ? ' host' : '');
        seatdots += '<span class="' + cls + '"></span>';
      }
    }
    var ping = 3 + Math.floor(Math.random() * 3), bars = '';
    for (var b = 0; b < 5; b++) bars += '<i class="' + (b < ping ? 'on' : '') + '"></i>';
    var canJoin = r.canJoin !== false && mode !== 'endless' && !r.locked;
    var denyLabel = closing ? '决战禁入' : (humans >= max ? '已满员' : '满员/禁入');
    var enter = canJoin ? '<button class="mc-enter" data-enter="' + esc(r.roomId) + '">进入 ▶</button>' : '<span class="mc-node">' + denyLabel + '</span>';
    return '<div class="mc-room-row' + (sel ? ' selected' : '') + '" data-rid="' + esc(r.roomId) + '" data-mode="' + mode + '">' +
      '<div class="mc-room-icon ' + iconCls + '"></div>' +
      '<div class="mc-room-main"><div class="mc-room-name">' + esc(r.name || r.roomId) + pill + node + '</div>' +
      '<div class="mc-motd">' + motd + '</div>' + (seatdots ? '<div class="mc-seatdots">' + seatdots + '</div>' : '') + '</div>' +
      '<div class="mc-room-right"><div class="mc-seats"><b>' + (humans + bots) + '</b>/' + max + (bots ? '<span class="mc-ai"> +' + bots + ' AI</span>' : '') + '</div>' +
      '<div class="mc-ping-bars">' + bars + '</div><span class="mc-ping-num">' + (30 + Math.floor(Math.random() * 90)) + 'ms</span>' + enter + '</div></div>';
  }
  function renderRooms() {
    if (!dom.mcRoomList) return;
    var list = (portal.rooms || []).filter(function (r) { return r && r.status !== 'settled' && r.status !== 'destroyed' && r.settled !== true; });
    var f = portal.hallFilter || 'all';
    if (f === 'normal' || f === 'elim') list = list.filter(function (r) { return r.mode === f; });
    if (f === 'endless') {
      dom.mcRoomList.innerHTML = '<div class="mc-room-row locked"><div class="mc-room-icon endless"></div><div class="mc-room-main"><div class="mc-room-name">无尽模式<span class="mc-pill endless">敬请期待</span></div><div class="mc-motd">无尽模式 · 敬请期待（将在全平台客户端与持久化 Mod 专服开放）</div></div><div class="mc-room-right"><span class="mc-node">未开放</span></div></div>';
      return;
    }
    if (portal.selectedRoom && !list.some(function (r) { return r.roomId === portal.selectedRoom; })) portal.selectedRoom = null;
    dom.mcRoomList.innerHTML = list.length ? list.map(mcRowHtml).join('') : '<div class="mc-room-empty">暂无房间，点击「刷新列表」</div>';
  }
  function setHallFilter(f) {
    portal.hallFilter = f || 'all';
    var map = { all: dom.hallFilterAll, normal: dom.hallFilterNormal, elim: dom.hallFilterElim, endless: dom.hallFilterEndless };
    Object.keys(map).forEach(function (k) { if (map[k]) map[k].classList.toggle('on', k === portal.hallFilter); });
    renderRooms();
  }
  function startHallPoll() {
    stopHallPoll();
    state.hallPollTimer = setInterval(function () { if (portal.view === 'hall' && portal.session && !state.joined) refreshHall(true); }, 5000);
  }
  function stopHallPoll() { if (state.hallPollTimer) { clearInterval(state.hallPollTimer); state.hallPollTimer = null; } }
  function refreshHall(silent) {
    if (!portal.session) { showPortalView('auth'); stopHallPoll(); return; }
    if (!silent) setMsg(dom.hallMsg, '正在载入房间…', true);
    Promise.all([apiJson('/api/rooms'), apiJson('/api/portal/status')]).then(function (arr) {
      var roomRes = arr[0], stRes = arr[1];
      if (roomRes.status === 401 || roomRes.status === 403) { savePortalSession('', null); showPortalView('auth'); stopHallPoll(); setMsg(dom.authMsg, '会话已过期，请重新登录', false); return; }
      if (stRes.ok && stRes.data) portal.version = stRes.data.version || portal.version;
      if (roomRes.ok && roomRes.data && roomRes.data.ok !== false) {
        portal.rooms = roomRes.data.rooms || [];
        portal.endless = roomRes.data.endless || null;
      } else { portal.rooms = []; }
      // 5.5 修复9：不再在大厅预提取 mods（仅进房 hello 时由 ModSandbox.load 注入）
      var nodes = (stRes.data && stRes.data.nodes) || [];
      var nodeOk = !!(stRes.ok && (nodes.length ? nodes.some(function (n) { return !n.draining; }) : true));
      var humans = 0; portal.rooms.forEach(function (r) { humans += (r.humans || 0); });
      updateServerChip(!!stRes.ok, nodeOk, humans);
      updateHallHeader(); renderRooms();
      if (!silent) setMsg(dom.hallMsg, '', true);
    });
  }
  function enterHall() { if (!portal.session) { showPortalView('auth'); return; } showPortalView('hall'); updateHallHeader(); refreshHall(); startHallPoll(); }
  function joinRoom(roomId, spectate) {
    if (!roomId) return;
    setMsg(dom.hallMsg, '正在获取房间票据…', true);
    apiJson('/api/rooms/join', { method: 'POST', body: { roomId: roomId, spectate: !!spectate } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        var d = res.data;
        connectRoom(d.wsUrl, d.roomId || roomId, d.ticket, !!spectate, (portal.profile && portal.profile.username) || '指挥官');
      } else {
        setMsg(dom.hallMsg, '加入失败：' + errText(res), false);
        renderRooms();
      }
    });
  }
  function doCreateElim(ev) {
    if (ev) ev.preventDefault();
    var name = pval(dom.elimName) || ('淘汰房-' + (Math.floor(Math.random() * 900) + 100));
    var max = Number(pval(dom.elimMax)) || 8;
    if (max < 2) max = 2; if (max > 8) max = 8;
    var subBtn = (ev && ev.target && ev.target.querySelector) ? ev.target.querySelector('button[type="submit"]') : null;
    if (subBtn) { subBtn.disabled = true; subBtn.classList.add('loading'); }
    setMsg(dom.hallMsg, '正在创建淘汰房…', true);
    apiJson('/api/rooms/create', { method: 'POST', body: { name: name, maxPlayers: max, mode: 'elim' } }).then(function (res) {
      if (res.ok && res.data && res.data.ok) {
        var room = res.data.room || {};
        joinRoom(room.roomId, false);
      } else {
        setMsg(dom.hallMsg, '创建失败：' + errText(res), false);
        if (subBtn) { subBtn.disabled = false; subBtn.classList.remove('loading'); }
      }
    });
  }

  function logoutPortal() {
    stopHallPoll();
    savePortalSession('', null);
    state.token = '';
    portal.rooms = []; portal.mods = [];
    showPortalView('auth'); setAuthTab('login'); setMsg(dom.authMsg, '已退出登录', true);
  }

  // ---- 进入 / 退出游戏房间 ----
  function closeGameSocket() {
    clearTimeout(state.reconnectTimer); state.reconnectTimer = null;
    var s = state.ws; state.ws = null;
    if (s) { try { s.onopen = s.onmessage = s.onclose = s.onerror = null; s.close(); } catch (e) {} }
    state.connected = false; state.joining = false;
  }
  function resetGameState() {
    state.players.clear(); state.planets.clear(); state.fleets.clear(); state.nodes.clear(); state.outposts.clear();
    state.fleetShips.clear(); state.pacts = []; state.coalitions = [];
    state.selPlanet = 0; state.selFleet = 0; state.inspectPlanet = 0; state.orderSrc = 0; state.factionView = 0;
    state.joined = false; state.joining = true; state.connected = false; state.everJoined = true;
    state.eliminatedAt = 0; state.camInit = false; state.dataKey = ''; state.renderedKey = null;
    state.mail = []; state.jointReqs = {}; state.joints = {}; state.leaderboard = [];
  }
  function connectRoom(wsUrl, roomId, ticket, spectate, name) {
    if (!wsUrl) { setMsg(dom.hallMsg, '服务器未返回 wsUrl', false); return; }
    stopHallPoll();
    closeGameSocket();
    resetGameState();
    try { ModSandbox.unloadAll(); } catch (e) {}
    var finalUrl = resolveGameWsUrl(wsUrl);
    state.roomConnect = { wsUrl: wsUrl, roomId: roomId, ticket: ticket, spectate: !!spectate, name: name || '指挥官' };
    state.pendingSpectate = !!spectate;
    state.name = name || '指挥官';
    setMsg(dom.hallMsg, '正在连接游戏服…', true);
    var sock = null;
    try { sock = (typeof WebSocket === 'function') ? new WebSocket(finalUrl) : null; } catch (e) { sock = null; }
    if (!sock) { setMsg(dom.hallMsg, '无法连接游戏服：' + finalUrl, false); state.joining = false; return; }
    state.ws = sock; state.joining = true; state.connected = false;
    sock.onopen = function () {
      state.connected = true;
      try { sock.send(JSON.stringify({ t: 'join', name: state.roomConnect.name, ticket: ticket, token: state.token || null, roomId: roomId, spectate: !!spectate })); } catch (e) {}
    };
    sock.onmessage = function (ev) { var m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    sock.onclose = function () {
      state.connected = false;
      try { ModSandbox.unloadAll(); } catch (e) {}
      if (state.everJoined && state.roomConnect) { dom.netBanner.hidden = false; scheduleReconnect(); }
    };
    sock.onerror = function () {};
  }
  function reconnectRoom() {
    var c = state.roomConnect;
    if (c && c.wsUrl) { connectRoom(c.wsUrl, c.roomId, c.ticket, c.spectate, c.name); }
    else { openSocket(); }
  }
  function leaveToLobby() {
    showConfirm({
      kicker: 'LEAVE · 退出对局', title: '退出当前对局', body: '退出当前对局？你的星球会保留但进入离线状态。',
      okText: '返回大厅', danger: true,
      onOk: function () {
        try { if (state.ws && wsOpen()) state.ws.send(JSON.stringify({ t: 'leave', keepSeat: true })); } catch (e) {}
        state.everJoined = false;
        closeGameSocket();
        stopHallPoll();
        try { ModSandbox.unloadAll(); } catch (e) {}
        if (dom.elimOverlay) dom.elimOverlay.hidden = true;
        if (dom.roomSettledModal) dom.roomSettledModal.hidden = true;
        state.mode = 'start'; state.joined = false; state.joining = false; state.connected = false;
        state.roomConnect = null;
        state.sandbox = false; syncSandboxMenu();
        state.heroStage = 'menu'; applyHeroStage();
        if (dom.hud) {
          dom.hud.classList.add('hud-fading');
          setTimeout(function () { if (dom.hud) { dom.hud.hidden = true; dom.hud.classList.remove('hud-fading'); } }, 300);
        }
        if (dom.start) { dom.start.hidden = false; dom.start.classList.remove('leaving'); }
        enterHall();
      }
    });
  }

  function bindPortalUI() {
    // ---- 认证 / 首启（表单直接绑定）----
    if (dom.bootstrapForm && !dom.bootstrapForm.__p) { dom.bootstrapForm.__p = true; dom.bootstrapForm.addEventListener('submit', doBootstrap); }
    if (dom.tabLogin && !dom.tabLogin.__p) { dom.tabLogin.__p = true; dom.tabLogin.addEventListener('click', function () { setAuthTab('login'); }); }
    if (dom.tabRegister && !dom.tabRegister.__p) { dom.tabRegister.__p = true; dom.tabRegister.addEventListener('click', function () { setAuthTab('register'); }); }
    if (dom.tabReset && !dom.tabReset.__p) { dom.tabReset.__p = true; dom.tabReset.addEventListener('click', function () { setAuthTab('reset'); }); }
    if (dom.loginForm && !dom.loginForm.__p) { dom.loginForm.__p = true; dom.loginForm.addEventListener('submit', doLogin); }
    if (dom.regForm && !dom.regForm.__p) { dom.regForm.__p = true; dom.regForm.addEventListener('submit', doRegister); }
    if (dom.resetForm && !dom.resetForm.__p) { dom.resetForm.__p = true; dom.resetForm.addEventListener('submit', doReset); }
    if (dom.recoveryDone && !dom.recoveryDone.__p) { dom.recoveryDone.__p = true; dom.recoveryDone.addEventListener('click', hideRecovery); }
    if (dom.recoveryCopy && !dom.recoveryCopy.__p) {
      dom.recoveryCopy.__p = true;
      dom.recoveryCopy.addEventListener('click', function () {
        var code = normRecoveryCode(dom.recoveryCode ? dom.recoveryCode.textContent : '');
        function done() { toast('已复制到剪贴板'); if (dom.recoveryCopy) { var old = dom.recoveryCopy.textContent; dom.recoveryCopy.textContent = '已复制'; setTimeout(function () { if (dom.recoveryCopy) dom.recoveryCopy.textContent = old || '复制恢复码'; }, 1200); } }
        try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done).catch(function () { toast('复制失败，请手动选择复制', true); }); else done(); } catch (e) { done(); }
      });
    }

    // ---- #homeView 事件委托 ----
    function onHomeClick(e) {
      var b = e.target.closest('button[id]'); if (!b) return;
      switch (b.id) {
        case 'homeNoticeBtn': break;
        case 'homeLobby': enterHall(); break;
        case 'homeSettings': openSettings(); break;
        case 'homeNoticeBtn2': break;
        case 'homeExpButton': break;
        case 'homeSwitch': logoutPortal(); break;
        case 'homeSound': toggleSound(); break;
      }
    }
    if (dom.homeView && !dom.homeView.__p) { dom.homeView.__p = true; dom.homeView.addEventListener('click', onHomeClick); }

    // ---- #lobbyHallView 事件委托 ----
    function onLobbyClick(e) {
      var b = e.target.closest('button[id]'); if (!b) return;
      switch (b.id) {
        case 'mcJoinSelected': if (portal.selectedRoom) joinRoom(portal.selectedRoom, false); else toast('请先选择一个房间', true); break;
        case 'mcCreateElim': if (dom.createElimForm) dom.createElimForm.hidden = !dom.createElimForm.hidden; break;
        case 'mcSpectate': if (portal.selectedRoom) joinRoom(portal.selectedRoom, true); else toast('请先选择一个房间', true); break;
        case 'mcRefresh': refreshHall(); break;
        case 'mcLogout': logoutPortal(); break;
        case 'hallRefresh': refreshHall(); break;
        case 'hallLogout': logoutPortal(); break;
        case 'hallBackHome': enterHome(); break;
        case 'adminBtn': openAdmin(); break;
      }
    }
    if (dom.lobbyHallView && !dom.lobbyHallView.__p) { dom.lobbyHallView.__p = true; dom.lobbyHallView.addEventListener('click', onLobbyClick); }
    function onRoomRowClick(e) {
      var row = e.target.closest('.mc-room-row'); if (!row || row.classList.contains('locked')) return;
      var rid = row.getAttribute('data-rid'); portal.selectedRoom = rid; renderRooms();
      if (e.target.closest('[data-enter]')) joinRoom(rid, false);
    }
    if (dom.mcRoomList && !dom.mcRoomList.__p) { dom.mcRoomList.__p = true; dom.mcRoomList.addEventListener('click', onRoomRowClick); dom.mcRoomList.addEventListener('dblclick', function (e) { var row = e.target.closest('.mc-room-row'); if (row && !row.classList.contains('locked')) { portal.selectedRoom = row.getAttribute('data-rid'); sfx('joinRoom'); joinRoom(portal.selectedRoom, false); } }); }
    if (dom.hallFilters && !dom.hallFilters.__p) { dom.hallFilters.__p = true; dom.hallFilters.addEventListener('click', function (e) { var f = e.target.closest('[data-filter]'); if (f) { sfx('tab'); setHallFilter(f.getAttribute('data-filter')); } }); }
    if (dom.createElimForm && !dom.createElimForm.__p) { dom.createElimForm.__p = true; dom.createElimForm.addEventListener('submit', doCreateElim); }

    if (dom.factionSheetClose && !dom.factionSheetClose.__p) { dom.factionSheetClose.__p = true; dom.factionSheetClose.addEventListener('click', function () { if (dom.factionPanel) dom.factionPanel.hidden = true; }); }
    if (!state.helpOutsideBound) {
      state.helpOutsideBound = true;
      document.addEventListener('pointerdown', function (e) {
        if (!state.helpOpen) return;
        if (dom.helpPanel && dom.helpPanel.contains(e.target)) return;
        if (e.target && e.target.closest && e.target.closest('#homeNoticeBtn')) return;
        closeHelp();
      });
    }
  }
  function portalBoot() {
    if (dom.chipText) dom.chipText.textContent = '正在连接门户…';
    apiJson('/api/bootstrap/status').then(function (res) {
      if (res.ok && res.data && res.data.initialized === false) { showPortalView('bootstrap'); return; }
      if (portal.session) { enterHome(); }
      else { showPortalView('auth'); setAuthTab('login'); }
    });
  }

  // AUTO_RESUME：有令牌就在加载时直接接管席位
  function boot() {
    installProbe();
    resize();
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { sendPing(); state.lastFrame = performance.now(); } });
    buildStars();
    loadAssets();
    bindMicroUx();
    syncSoundBtn();
    loadSettings();
    bindInput();
    bindStage2UI();
    bindStage53UI();
    bindSettings();
    applySettings();
    bindPortalUI();
    exposeDebug();
    if (navigator.connection && navigator.connection.addEventListener) {
      navigator.connection.addEventListener('change', function () { if (state.everJoined && !state.connected) reconnectRoom(); });
    }
    portalBoot();
    // 事件驱动订阅刷新：当状态、星球或外交事件广播到达时按需触发对应面板刷新，告别无脑定时器轮询
    bus.on('state:change', function () {
      if (state.mode !== 'game' || !state.joined) return;
      updateElimination();
      updateHeader();
      if (!dom.statusDialog.hidden) openStatusDialog();
      if (state.factionView > 0) { showDiplomacyConfirm(state.factionView, true); return; }
      if (state.factionView < 0) return;
      if (!state.selPlanet && !state.selFleet && !state.inspectPlanet) { dom.orderPanel.hidden = true; return; }
      updateOrderPanel();
    });
    bus.on('diplomacy:change', function () {
      if (state.mode !== 'game' || !state.joined) return;
      updateLists();
      if (state.factionView > 0) showDiplomacyConfirm(state.factionView, true);
      else if (!state.factionView) updateOrderPanel();
    });
    bus.on('planet:change', function (ev) {
      if (state.mode !== 'game' || !state.joined) return;
      if (!ev || ev.planet === state.selPlanet || ev.planet === state.inspectPlanet) updateOrderPanel();
    });
    requestAnimationFrame(render);
    window.__ORBITAL__ = { state: state, version: '2.0.0' };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
