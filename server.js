'use strict';
/*
 * 星海边境 · ORBITAL FRONTIER — fleet strategy server (v2)
 * Zero dependency. Node >= 18. Start: node server.js
 *
 * The server simulates planets, fleets and alliances in 0.2s grid steps and broadcast state at 5Hz.
 * Clients render that deterministic state and may only send intents (launch / gather / merge / split /
 * rename / reinforce / destroy / ally / breakpact). Every intent is validated against the sender's own
 * fleets and worlds, so an edited client cannot conjure ships, resources or planets.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* -------------------- Stage5 node config (I5) -------------------- */
function resolveNodeConfigPath() {
  let p = process.env.GAME_NODE_CONFIG || '';
  const i = process.argv.indexOf('--config');
  if (i >= 0 && process.argv[i + 1]) p = process.argv[i + 1];
  return p ? path.resolve(process.cwd(), p) : path.join(__dirname, 'game-node.config.json');
}
const NODE_CONFIG_PATH = resolveNodeConfigPath();
let nodeConfig = {};
try { if (fs.existsSync(NODE_CONFIG_PATH)) nodeConfig = JSON.parse(fs.readFileSync(NODE_CONFIG_PATH, 'utf8')) || {}; } catch (e) { nodeConfig = {}; }
const NODE_DEFAULT_RULES = {
  startResource: 30, resourceRegen: 1.2, reinforceRate: 1.0, shipSpeed: 340,
  captureRate: 1.0, maxPlayers: 8, normalDurationMin: 40, elimDurationMin: 25, draining: false
};
let NODE_RULES = Object.assign({}, NODE_DEFAULT_RULES, nodeConfig.rules || {});
function numOr(v, d) { const n = Number(v); return Number.isFinite(n) ? n : d; }

const PORT = Number(process.env.PORT || nodeConfig.port || 8787);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 8;
const TICK_MS = 100;
const MAX_MESSAGE = 65536;

const WORLD = { w: 12400, h: 8800 };
const PLANET_COUNT = 40;
const RESOURCE_NODES = 26;
let SHIP_SPEED = numOr(NODE_RULES.shipSpeed, 340);

let START_RESOURCE = numOr(NODE_RULES.startResource, 30);
let RESOURCE_REGEN = numOr(NODE_RULES.resourceRegen, 1.2);
const RESOURCE_PER_KILL = 8;
// Stage2 Task D: fixed action cost + exhausted-world upkeep / starvation
const ACTION_COST = 1;
const EXHAUST_UPKEEP_PER_SHIP = 1.0;
const EXHAUST_STARVE_RATE = 0.5;

let REINFORCE_RATE = numOr(NODE_RULES.reinforceRate, 1.0);
const RESOURCE_PER_SHIP = 1;
let CAPTURE_RATE = numOr(NODE_RULES.captureRate, 1.0);
let DEFAULT_MAX_PLAYERS = Math.max(2, Math.min(8, Math.round(numOr(NODE_RULES.maxPlayers, 8))));
let NORMAL_DURATION_MS = Math.max(60000, Math.round(numOr(NODE_RULES.normalDurationMin, 40) * 60000));
let ELIM_DURATION_MS = Math.max(60000, Math.round(numOr(NODE_RULES.elimDurationMin, 25) * 60000));

// Standalone node admin credentials: a generated game-node.config.json with initialized:true skips first boot.
let nodeAdminAccount = (nodeConfig.initialized === true && nodeConfig.admin && nodeConfig.admin.username && nodeConfig.admin.passHash && nodeConfig.admin.salt)
  ? nodeConfig.admin : null;
let NODE_BOOTSTRAP_TOKEN = nodeAdminAccount ? null : crypto.randomBytes(16).toString('hex');

const DESTROY_MIN = 15;
const DESTROY_TIME = 8;
const DESTROY_RESOURCE = 30;
const DESTROY_ENERGY = 20;

const NODE_CLAIM_RADIUS = 150;
const NODE_RESOURCE_GAIN = 70;

const NODE_CHARGE_TIME = 3.0;

// Stage2 Task C：交易 / 转让 / 七态外交
const TRADE_FEE = 2;
const TRADE_TAX = 0.10;
const TRADE_PENALTY = 0.20;
const REQUEST_TTL = 90000;
const ALLY_COST = 2;
const INCITE_COST = 5;
const MARK_COST = 0;
const OUTPOST_LEVELS = [
  { level: 1, cost: 20, cap: 12, radius: 74 },
  { level: 2, cost: 60, cap: 24, radius: 92 },
  { level: 3, cost: 140, cap: 40, radius: 112 }
];
const OUTPOST_MIN_GAP = 280;

const COLLAPSE_SECONDS = 20;         // an exhausted, unoccupied world decays over this long
const CAPTURE_SECONDS = 6;        // read-bar time to take a world, from the moment its garrison is gone
const COMBAT_RADIUS = 34;
const COMBAT_DPS_PER_SHIP = 0.9;
const BASE_DMG = 0.6;
const STATION_RATE = 0.3;

const NEWBIE_SHIELD_MS = 18000;    // new players only: 18s, cancelled early once they hold 3 worlds
const NEWBIE_SHIELD_WORLDS = 3;
const RESPAWN_SECONDS = 30;
const NEW_PLAYER_SHIPS = 12;      // "new player" loadout: a home world with an escort       // eliminated pilots return as a new player after this long
const ELIM_GRACE = 6000;          // time to be fully landless before elimination is declared

const COLORS = ['#38bdf8', '#fb7185', '#facc15', '#a855f7', '#4ade80', '#fb923c', '#2dd4bf', '#e879f9', '#818cf8', '#f43f5e'];
const AI_NAMES = ['深空拾荒者', '环带哨兵', '赫利俄斯', '夜航者', '折光', '灰烬', '北落师门', '苍蓝孤星'];
const PLANET_NAMES = ['残响', '长庚', '永昼', '静海', '灰烬', '琥珀', '归墟', '折光', '赤纬', '白噪', '荒原', '赫兹', '星屑', '黑曜', '浮游', '折返', '霜华', '孤舟', '逆光', '沉钟', '未名', '空港', '远望', '拾光'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const round1 = (v) => Math.round(v * 10) / 10;

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  const s = raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, 12).join('');
}
function planetName(pl) {
  if (pl.isOutpost) return pl.customName || ('停泊点 Lv' + (pl.level || 1));
  return pl.customName || PLANET_NAMES[(pl.id - 1) % PLANET_NAMES.length];
}

/* ----------------------------- plugins / mods ----------------------------- */
// Server-side mod loader: scans plugins/*/manifest.json, only enabled plugins are surfaced.
function loadPluginDefs() {
  const dir = path.join(__dirname, 'plugins');
  const out = [];
  try {
    if (!fs.existsSync(dir)) return out;
    for (const name of fs.readdirSync(dir)) {
      const pdir = path.join(dir, name);
      const mf = path.join(pdir, 'manifest.json');
      if (!fs.existsSync(mf)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
        let config = {};
        const cf = path.join(pdir, 'config.json');
        if (fs.existsSync(cf)) config = JSON.parse(fs.readFileSync(cf, 'utf8'));
        if (!config || config.enabled !== true) continue;
        const readText = (f) => { try { return fs.readFileSync(path.join(pdir, f), 'utf8'); } catch (e) { return ''; } };
        out.push({
          id: manifest.id || name,
          name: manifest.name || name,
          version: manifest.version || '0.0.0',
          type: manifest.type || 'mod',
          builtin: (manifest.id === 'nebula-overdrive') || manifest.builtin === true,
          tags: Array.isArray(manifest.tags) ? manifest.tags : [],
          config,
          sharedCode: readText('shared.js'),
          clientCode: readText('client.js')
        });
      } catch (e) { console.error('plugin load failed (' + name + '):', e.message); }
    }
  } catch (e) { console.error('plugin scan failed:', e.message); }
  return out;
}

let PLUGIN_DEFS = loadPluginDefs();
let MOD_REGISTRY = PLUGIN_DEFS.map((p) => ({ id: p.id, name: p.name, version: p.version, tags: p.tags, builtin: !!p.builtin, config: p.config, sharedCode: p.sharedCode, clientCode: p.clientCode }));
let MOD_SUMMARIES = PLUGIN_DEFS.map((p) => ({ id: p.id, name: p.name, version: p.version, tags: p.tags, builtin: !!p.builtin }));

function reloadPlugins() {
  PLUGIN_DEFS = loadPluginDefs();
  MOD_REGISTRY = PLUGIN_DEFS.map((p) => ({ id: p.id, name: p.name, version: p.version, tags: p.tags, builtin: !!p.builtin, config: p.config, sharedCode: p.sharedCode, clientCode: p.clientCode }));
  MOD_SUMMARIES = PLUGIN_DEFS.map((p) => ({ id: p.id, name: p.name, version: p.version, tags: p.tags, builtin: !!p.builtin }));
  try {
    if (typeof roomManager !== 'undefined' && roomManager) {
      for (const g of roomManager.rooms.values()) g.refreshMods();
    }
  } catch (e) {}
}


/* ------------------------------ WebSocket ------------------------------ */

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const sockets = new Set();

class WSClient {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.fragments = [];
    this.fragmentOpcode = 0;
    this.alive = true;
    this.closed = false;
    this.joined = false;
    this.playerId = 0;
    this.roomId = 0;
    this.game = null;
    this.spectating = false;
    this.lastChatAt = 0;
    socket.setNoDelay(true);
    socket.on('data', (d) => this.onData(d));
    socket.on('error', () => {});
    socket.on('close', () => this.onClose());
  }
  onData(chunk) {
    if (this.closed) return;
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > MAX_MESSAGE * 2) { this.close(1009, 'too big'); return; }
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0, opcode = b0 & 0x0f, masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, offset = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) { this.close(1009, 'too big'); return; }
        len = Number(big); offset = 10;
      }
      if (len > MAX_MESSAGE) { this.close(1009, 'too big'); return; }
      if (!masked) { this.close(1002, 'unmasked'); return; }
      if (this.buffer.length < offset + 4 + len) return;
      const mask = this.buffer.subarray(offset, offset + 4);
      offset += 4;
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = this.buffer[offset + i] ^ mask[i & 3];
      this.buffer = this.buffer.subarray(offset + len);
      if (opcode === 0x8) { this.sendFrame(0x8, Buffer.alloc(0)); this.destroy(); return; }
      if (opcode === 0x9) { this.sendFrame(0xA, payload); continue; }
      if (opcode === 0xA) { this.alive = true; continue; }
      if (opcode === 0x0) {
        if (!this.fragmentOpcode) { this.close(1002, 'bad fragment'); return; }
        this.fragments.push(payload);
        if (fin) { const full = Buffer.concat(this.fragments); const op = this.fragmentOpcode; this.fragments = []; this.fragmentOpcode = 0; this.dispatch(op, full); }
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        if (!fin) { this.fragmentOpcode = opcode; this.fragments = [payload]; continue; }
        this.dispatch(opcode, payload);
        continue;
      }
      this.close(1002, 'unknown opcode');
      return;
    }
  }
  dispatch(opcode, payload) {
    if (opcode !== 0x1) return;
    let msg; try { msg = JSON.parse(payload.toString('utf8')); } catch { return; }
    if (msg && typeof msg === 'object') onMessage(this, msg);
  }
  sendFrame(opcode, payload) {
    if (this.socket.destroyed) return false;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.allocUnsafe(2); head[0] = 0x80 | opcode; head[1] = len; }
    else if (len < 65536) { head = Buffer.allocUnsafe(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.allocUnsafe(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    try { this.socket.write(Buffer.concat([head, payload])); return true; } catch { return false; }
  }
  send(obj) { return this.sendRaw(JSON.stringify(obj)); }
  sendRaw(text) {
    if (this.closed) return false;
    if (this.socket.writableLength > 2 * 1024 * 1024) { this.close(1008, 'slow'); return false; }
    return this.sendFrame(0x1, Buffer.from(text, 'utf8'));
  }
  close(code = 1000, reason = '') {
    if (this.closed) return;
    const r = Buffer.from(reason, 'utf8').subarray(0, 120);
    const p = Buffer.allocUnsafe(2 + r.length);
    p.writeUInt16BE(code, 0); r.copy(p, 2);
    this.sendFrame(0x8, p);
    this.closed = true;
    setTimeout(() => this.destroy(), 80);
  }
  destroy() { this.closed = true; try { this.socket.destroy(); } catch {} }
  onClose() {
    if (this._done) return;
    this._done = true; this.closed = true;
    sockets.delete(this);
    if (this.spectating && this.game && this.game.spectators) this.game.spectators.delete(this);
    if (this.game) this.game.onDisconnect(this);
  }
}

/* -------------------------------- Game -------------------------------- */

class Game {
  constructor(opts = {}) {
    opts = opts || {};
    this.roomId = opts.roomId || ('norm-' + Date.now() + '-' + Math.floor(Math.random() * 1000));
    this.mode = opts.mode || 'normal';
    this.name = opts.name || ('星域-' + this.roomId);
    this.maxPlayers = clamp(Number(opts.maxPlayers) || DEFAULT_MAX_PLAYERS, 2, 8);
    this.hostId = Number(opts.hostId) || 0;
    this.status = opts.status || (this.mode === 'normal' ? 'running' : 'waiting');
    this.createdAt = Date.now();
    this.startedAt = this.mode === 'normal' ? Date.now() : 0;
    this.customDuration = Number(opts.durationMs) > 0;
    this.durationMs = this.customDuration ? Number(opts.durationMs)
      : (this.mode === 'normal' ? NORMAL_DURATION_MS : (this.mode === 'elim' ? ELIM_DURATION_MS : 60 * 60 * 1000));
    this.lobbyExpireAt = (this.mode === 'elim') ? Date.now() + (Number(opts.lobbyExpireMs) > 0 ? Number(opts.lobbyExpireMs) : 10 * 60 * 1000) : 0;
    this.noJoin = false;
    this.settled = false;
    this.hadHumans = false;
    // Task G: enabled plugins/modules. this.mods = summaries (status/list), this.modDetails = full (hello).
    this.mods = Array.isArray(opts.mods) ? opts.mods : MOD_SUMMARIES;
    this.modDetails = Array.isArray(opts.modDetails) ? opts.modDetails : MOD_REGISTRY;
    this.speedMultiplier = 1.0;
    for (const m of this.modDetails) {
      const sm = Number(m && m.config && m.config.speedMultiplier);
      if (Number.isFinite(sm) && sm > 0) this.speedMultiplier *= sm;
    }
    this.spectators = new Set();
    this.players = new Map();
    this.planets = new Map();
    this.outposts = [];
    this.nextOutpost = 1;
    this.pendingPacts = new Map();
    this.fleets = new Map();
    this.joints = new Map();
    this.nodes = [];
    this.pacts = new Map();
    this.coalitions = new Map();
    this.trades = new Map();
    this.votes = new Map();
    this.nextId = 1;
    this.nextPlanet = 1;
    this.nextFleet = 1;
    this.nextNode = 1;
    this.nextPact = 1;
    this.nextCoalition = 1;
    this.nextJoint = 1;
    this.nextTrade = 1;
    this.nextVote = 1;
    this.tick = 0;
    this.lastSim = Date.now();
    this.log = [];
    this.buildPlanets();
    this.buildNodes();
    if (this.mode === 'normal') this.ensureAI();
    setInterval(() => this.step(), TICK_MS);
  }

  refreshMods() {
    this.mods = MOD_SUMMARIES;
    this.modDetails = MOD_REGISTRY;
    this.speedMultiplier = 1.0;
    for (const m of this.modDetails) {
      const sm = Number(m && m.config && m.config.speedMultiplier);
      if (Number.isFinite(sm) && sm > 0) this.speedMultiplier *= sm;
    }
  }

  logEvent(text) {
    const line = new Date().toISOString().slice(11, 19) + ' ' + text;
    this.log.push(line);
    if (this.log.length > 300) this.log.shift();
    console.log(line);
  }

  /* ---------- world ---------- */

  buildPlanets() {
    for (let i = 0; i < PLANET_COUNT; i++) this.planets.set(this.nextPlanet, this.protoPlanet());
  }

  protoPlanet(sizeClass) {
    const { w, h } = WORLD;
    let cls = sizeClass;
    if (!cls) { const r = Math.random(); cls = r < 0.3 ? 'S' : r < 0.72 ? 'M' : 'L'; }
    const radius = cls === 'S' ? rand(84, 104) : cls === 'M' ? rand(118, 148) : rand(162, 198);
    const cap = cls === 'S' ? Math.round(rand(20, 30)) : cls === 'M' ? Math.round(rand(35, 50)) : Math.round(rand(55, 75));
    const id = this.nextPlanet++;
    let best = { x: w / 2, y: h / 2, score: -1e9 };
    for (let tries = 0; tries < 80; tries++) {
      const x = rand(radius + 140, w - radius - 140);
      const y = rand(radius + 140, h - radius - 140);
      let gap = 1e9;
      for (const p of this.planets.values()) gap = Math.min(gap, Math.sqrt(dist2(x, y, p.x, p.y)) - p.radius - radius);
      if (gap > best.score) best = { x, y, score: gap };
      if (gap > 320) break;
    }
    return {
      id, size: cls, radius, cap, x: best.x, y: best.y, hue: Math.floor(rand(0, 360)),
      owner: 0, color: '', resource: Math.round(rand(60, 140) * (cls === 'S' ? 0.7 : cls === 'M' ? 1 : 1.35)),
      energy: 60, troops: 0, reinforce: true, exhausted: false, maxResource: 180,
      destroyTimer: 0, destroyBy: 0, invulnUntil: 0, customName: '', isOutpost: false, shape: 'round',
      purityProg: 0, captureBy: 0, captureProg: 0, orbitBy: {}, orbitTotal: 0
    };
  }

  buildNodes() { for (let i = 0; i < RESOURCE_NODES; i++) this.spawnNode(); }
  spawnNode() {
    this.nodes.push({ id: this.nextNode++, x: rand(220, WORLD.w - 220), y: rand(220, WORLD.h - 220), amount: Math.round(rand(40, 90)), radius: 32, readingFleetId: null });
    if (this.nodes.length > RESOURCE_NODES + 4) this.nodes.shift();
  }

  /* ---------- players ---------- */

  humanCount() { let n = 0; for (const p of this.players.values()) if (!p.bot && p.conn) n++; return n; }

  ensureAI() {
    if (this.mode !== 'normal') return; // elim rooms are staffed manually by the host
    // 3 AI when the sector is quiet, 1 AI as soon as real pilots show up.
    const humans = this.humanCount();
    const desired = humans > 1 ? 1 : 3;
    let bots = Array.from(this.players.values()).filter((p) => p.bot).length;
    this.pruneAI(desired);
    while (bots < desired) {
      const used = new Set(Array.from(this.players.values()).map((p) => p.name));
      const name = AI_NAMES.find((n) => !used.has(n));
      if (!name) break;
      this.addAIPlayer(name);
      bots++;
    }
  }

  pruneAI(desired) {
    const humans = this.humanCount();
    const maxBots = Math.max(0, this.maxPlayers - humans - 1);
    const bots = Array.from(this.players.values()).filter((p) => p.bot);
    while (bots.length > Math.min(desired, maxBots)) this.removePlayer(bots.pop(), false);
  }

  pickUniqueColor() {
    const used = new Set();
    for (const p of this.players.values()) if (p.color) used.add(p.color);
    for (const c of COLORS) if (!used.has(c)) return c;
    return COLORS[(this.nextId - 1) % COLORS.length];
  }

  addAIPlayer(name) {
    const id = this.nextId++;
    const p = { id, name, color: this.pickUniqueColor(), bot: true, conn: null, token: null,
      coalition: 0, homePlanet: 0, resource: START_RESOURCE, socialCd: 0, joinedAt: Date.now(), aiNext: 0,
      landlessSince: 0, eliminatedAt: 0, online: false, permanentlyOut: false };
    this.players.set(id, p);
    this.assignStartPlanet(p);
    this.logEvent('AI ' + p.name + ' joined (id ' + id + ')');
    return p;
  }

  addHuman(ws, name, token) {
    if (token) {
      for (const p of this.players.values()) {
        if (!p.bot && p.token === token) {
          if (p.conn && p.conn !== ws) { try { p.conn.close(1000, 'replaced'); } catch {} }
          p.conn = ws; p.disconnectedAt = 0;
          if (name) p.name = name;
          ws.joined = true; ws.playerId = p.id;
          p.online = true; this.hadHumans = true;
          this.sendWelcome(ws, p, true);
          this.broadcast({ t: 'ev', k: 'presence', id: p.id, name: p.name, online: true });
          this.logEvent(p.name + ' resumed');
          return p;
        }
      }
    }
    let seats = 0;
    for (const p of this.players.values()) if (!p.bot) seats++;
    if (seats >= this.maxPlayers) { this.logEvent('human seats full: ' + seats + ' player=' + name); return null; }
    const id = this.nextId++;
    const p = { id, name: name || ('飞行员-' + String(id).padStart(2, '0')), color: this.pickUniqueColor(),
      bot: false, conn: ws, token: (typeof token === 'string' && token) ? token : crypto.randomUUID(), coalition: 0, homePlanet: 0,
      resource: START_RESOURCE, socialCd: 0, joinedAt: Date.now(), aiNext: 0,
      landlessSince: 0, eliminatedAt: 0, online: true, permanentlyOut: false };
    this.players.set(id, p);
    ws.joined = true; ws.playerId = id;
    this.hadHumans = true;
    if (this.mode === 'elim' && !this.hostId) this.hostId = id;
    this.startAsNewPlayer(p);
    this.ensureAI();
    this.sendWelcome(ws, p, false);
    this.broadcast({ t: 'ev', k: 'presence', id: p.id, name: p.name, online: true });
    this.broadcastChat({ id: 0, name: '航管中心', text: p.name + ' 进入了星域', sys: true });
    this.logEvent(p.name + ' joined (id ' + id + ')');
    return p;
  }

  // A returning (or newly eliminated) pilot is treated exactly like a fresh player: new home, 6 ships.
  // fresh arena: forget every seat (they reconnect and re-join), keep the map itself
  resetSeats(reason) {
    this.logEvent('reset requested by ' + reason);
    for (const p of Array.from(this.players.values())) {
      if (!p.bot) this.broadcast({ t: 'ev', k: 'reset', id: p.id });
      this.removePlayer(p, false);
    }
    this.pacts.clear();
    this.coalitions.clear();
    this.joints.clear();
    this.trades.clear();
    this.votes.clear();
    this.nextTrade = 1;
    this.nextVote = 1;
    for (const pl of this.planets.values()) { pl.owner = 0; pl.troops = 0; pl.purityProg = 0; pl.captureProg = 0; pl.captureBy = 0; pl.reinforce = true; pl.color = ''; pl.destroyTimer = 0; pl.destroyBy = 0; pl.invulnUntil = 0; }
    this.fleets.clear();
    this.ensureAI();
    this.broadcastState();
    return true;
  }

  startAsNewPlayer(p) {
    for (const pl of this.planets.values()) if (pl.owner === p.id) { pl.owner = 0; pl.troops = 0; pl.purityProg = 0; pl.captureProg = 0; pl.captureBy = 0; pl.reinforce = true; pl.color = ''; }
    for (const f of Array.from(this.fleets.values())) if (f.owner === p.id) this.fleets.delete(f.id);
    p.homePlanet = 0;
    p.resource = START_RESOURCE;
    p.eliminatedAt = 0;
    p.permanentlyOut = false;
    p.online = !!p.conn;
    const home = this.assignStartPlanet(p);
    this.broadcast({ t: 'ev', k: 'respawn', id: p.id, name: p.name, home: home ? home.id : 0 });
    this.broadcastChat({ id: 0, name: '航管中心', text: p.name + ' 以新指挥官身份重返星域', sys: true });
    this.logEvent(p.name + ' respawned at ' + (home ? planetName(home) : '?'));
    return home;
  }

  eliminate(p) {
    p.eliminatedAt = Date.now();
    this.broadcast({ t: 'ev', k: 'eliminated', id: p.id, name: p.name, at: p.eliminatedAt });
    this.broadcastChat({ id: 0, name: '航管中心', text: p.name + ' 被淘汰，' + RESPAWN_SECONDS + ' 秒后重新投入战场', sys: true });
    this.logEvent(p.name + ' eliminated');
  }

  assignStartPlanet(p) {
    const free = Array.from(this.planets.values()).filter((pl) => !pl.owner);
    let target = null;
    if (free.length) { free.sort((a, b) => b.cap - a.cap); target = free[Math.floor(Math.random() * Math.min(free.length, 6))]; }
    else target = this.spawnPlanetNear();
    target.owner = p.id; target.color = p.color; target.purityProg = 1;
    target.resource += 60;
    target.invulnUntil = 0;
    // a fresh commander starts with a small escort so neighbours cannot chew through the home world
    target.troops = NEW_PLAYER_SHIPS;
    p.spawnedAt = Date.now();
    p.shieldUntil = Date.now() + NEWBIE_SHIELD_MS;
    p.homePlanet = target.id;
    this.broadcast({ t: 'ev', k: 'planet-spawn', planet: this.viewPlanet(target), by: p.id });
    this.logEvent('start world ' + planetName(target) + ' -> ' + p.name);
    return target;
  }

  spawnPlanetNear() {
    const mids = Array.from(this.planets.values()).filter((p) => p.size === 'M');
    const pool = mids.length ? mids : Array.from(this.planets.values());
    const anchor = pool[Math.floor(Math.random() * pool.length)];
    let best = { x: WORLD.w / 2, y: WORLD.h / 2 }, bestScore = -1e9;
    for (let tries = 0; tries < 60; tries++) {
      const ang = rand(0, Math.PI * 2), d = rand(320, 560);
      const x = clamp(anchor.x + Math.cos(ang) * d, 260, WORLD.w - 260);
      const y = clamp(anchor.y + Math.sin(ang) * d, 260, WORLD.h - 260);
      let gap = 1e9;
      for (const p of this.planets.values()) gap = Math.min(gap, Math.sqrt(dist2(x, y, p.x, p.y)) - p.radius);
      if (gap > bestScore) { bestScore = gap; best = { x, y }; }
      if (gap > 170) break;
    }
    const pl = this.protoPlanet('M');
    pl.x = best.x; pl.y = best.y;
    this.planets.set(pl.id, pl);
    this.logEvent('new world ' + planetName(pl) + ' near a mid-size world');
    return pl;
  }

  reassignHost() {
    if (this.mode !== 'elim') return;
    const host = this.players.get(this.hostId);
    if (host && host.conn && !host.bot) return;
    const humans = Array.from(this.players.values())
      .filter((x) => !x.bot && x.conn)
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    this.hostId = humans.length ? humans[0].id : 0;
  }

  removePlayer(p, announce) {
    if (!this.players.has(p.id)) return;
    for (const f of Array.from(this.fleets.values())) if (f.owner === p.id) this.fleets.delete(f.id);
    for (const pl of this.planets.values()) {
      if (pl.owner === p.id) { pl.owner = 0; pl.troops = 0; pl.purityProg = 0; pl.captureProg = 0; pl.captureBy = 0; pl.reinforce = true; pl.color = ''; }
      if (pl.destroyBy === p.id) { pl.destroyBy = 0; pl.destroyTimer = 0; }
    }
    this.breakAllPactsOf(p.id);
    this.players.delete(p.id);
    this.reassignHost();
    this.broadcast({ t: 'ev', k: 'leave', id: p.id });
    this.logEvent(p.name + ' left');
    if (announce) this.broadcastChat({ id: 0, name: '航管中心', text: p.name + ' 离开了星域', sys: true });
  }

  onDisconnect(ws) {
    if (!ws.joined) { this.ensureAI(); return; }
    const p = this.players.get(ws.playerId);
    if (p && p.conn === ws) {
      p.conn = null; p.online = false;
      if (!p.disconnectedAt) p.disconnectedAt = Date.now();
      this.broadcast({ t: 'ev', k: 'presence', id: p.id, name: p.name, online: false });
      this.reassignHost();
    }
    this.ensureAI();
    // A pilot who vanished before sending a single input leaves a ghost seat behind:
    // release seats that never reconnected and never produced input for two minutes.
    setTimeout(() => this.reapGhosts(), 60000);
  }

  // A seat that has been offline for a long time and never moved a fleet is abandoned.
  reapGhosts() {
    const now = Date.now();
    for (const p of Array.from(this.players.values())) {
      if (p.bot || p.conn || !p.disconnectedAt) continue;
      if (now - p.disconnectedAt < 30 * 60 * 1000) continue;   // 30 分钟内容许刷新回来
      const ownsFleet = Array.from(this.fleets.values()).some((f) => f.owner === p.id);
      if (ownsFleet) continue;
      this.removePlayer(p, false);
    }
    this.ensureAI();
  }

  /* ---------- views ---------- */

  displayColorOf(playerId) {
    // alliances never repaint a faction: everyone keeps their own colour, allies are marked by a tag
    const p = this.players.get(playerId);
    if (!p) return '#7dd3fc';
    return p.color;
  }

  viewPlayers() {
    return Array.from(this.players.values()).map((p) => ({
      id: p.id, name: p.name, color: p.color, bot: !!p.bot, online: !!p.conn,
      coalition: p.coalition || 0, resource: Math.round(p.resource || 0), homePlanet: p.homePlanet || 0,
      shielded: !!(p.shieldUntil && p.shieldUntil > Date.now()),
      shieldIn: p.shieldUntil ? Math.max(0, Math.ceil((p.shieldUntil - Date.now()) / 1000)) : 0,
      eliminated: !!p.eliminatedAt,
      respawnIn: p.eliminatedAt && !p.permanentlyOut ? Math.max(0, Math.ceil((RESPAWN_SECONDS * 1000 - (Date.now() - p.eliminatedAt)) / 1000)) : 0,
      permanentlyOut: !!p.permanentlyOut,
      score: this.calcScore(p)
    }));
  }

  planetUnits(pl) {
    if (pl.isOutpost) return 0.8;
    return pl.size === 'S' ? 1.0 : pl.size === 'M' ? 1.8 : pl.size === 'L' ? 3.0 : 1.0;
  }

  playerScoreRow(p) {
    let planets = 0, ships = 0;
    for (const pl of this.planets.values()) if (pl.owner === p.id) { planets++; ships += pl.troops || 0; }
    for (const f of this.fleets.values()) if (f.owner === p.id) ships += f.n || 0;
    return { id: p.id, name: p.name, score: this.calcScore(p), planets, ships: Math.floor(ships), resource: Math.round(p.resource || 0), online: !!p.conn && !p.bot };
  }

  calcScore(p) {
    let vTotal = 0, nShips = 0;
    for (const pl of this.planets.values()) if (pl.owner === p.id) { vTotal += this.planetUnits(pl); nShips += pl.troops || 0; }
    for (const f of this.fleets.values()) if (f.owner === p.id) nShips += f.n || 0;
    return Math.round(10 * vTotal + 2 * nShips + Math.round(p.resource || 0));
  }

  leaderboard() {
    return Array.from(this.players.values()).map((p) => this.playerScoreRow(p))
      .sort((a, b) => b.score - a.score)
      .map((r, i) => Object.assign({ rank: i + 1 }, r));
  }

  remainingMs(now) {
    now = now || Date.now();
    if (this.status === 'settled') return 0;
    if (this.status === 'waiting') return this.lobbyExpireAt ? Math.max(0, this.lobbyExpireAt - now) : 0;
    return Math.max(0, (this.startedAt || now) + this.durationMs - now);
  }

  orbitShares(pl) {
    const out = {};
    let total = 0;
    for (const f of this.fleets.values()) {
      if (f.orbiting !== pl.id) continue;
      out[f.owner] = (out[f.owner] || 0) + f.n;
      total += f.n;
    }
    pl.orbitBy = out;
    pl.orbitTotal = total;
    return out;
  }

  viewOutposts() {
    // outposts are planets with isOutpost=true; expose a derived view for older clients
    return Array.from(this.planets.values()).filter((pl) => pl.isOutpost).map((o) => ({
      id: o.id, x: Math.round(o.x), y: Math.round(o.y), level: o.level || 1, owner: o.owner,
      color: o.owner ? this.displayColorOf(o.owner) : '', troops: Math.floor(o.troops),
      cap: o.cap, r: o.radius
    }));
  }

  viewPlanet(pl) {
    return {
      id: pl.id, x: Math.round(pl.x), y: Math.round(pl.y), r: Math.round(pl.radius), size: pl.size,
      cap: pl.cap, hue: pl.hue, owner: pl.owner, color: pl.owner ? this.displayColorOf(pl.owner) : '',
      troops: Math.floor(pl.troops), resource: Math.round(pl.resource),
      reinforce: !!pl.reinforce, exhausted: !!pl.exhausted,
      destroyTimer: round1(pl.destroyTimer || 0), destroyBy: pl.destroyBy || 0,
      captureBy: pl.captureBy || 0, captureProg: Math.round((pl.captureProg || 0) * 10000) / 10000,
      collapseProg: Math.round(Math.min(1, (pl.collapseTimer || 0) / COLLAPSE_SECONDS) * 10000) / 10000,
      orbitBy: this.orbitShares(pl), orbitTotal: pl.orbitTotal,
      isOutpost: !!pl.isOutpost, shape: pl.shape || 'round', level: pl.level || 0,
      maxResource: pl.maxResource || 180, purityProg: Math.round((pl.purityProg == null ? (pl.owner ? 1 : 0) : pl.purityProg) * 10000) / 10000,
      invuln: pl.invulnUntil > Date.now(), name: planetName(pl)
    };
  }
  viewPlanets() { return Array.from(this.planets.values()).map((p) => this.viewPlanet(p)); }
  viewFleets() {
    return Array.from(this.fleets.values()).filter((f) => f.n >= 1).map((f) => ({
      id: f.id, owner: f.owner, color: this.displayColorOf(f.owner), kind: f.kind, n: Math.floor(f.n),
      x: Math.round(f.x), y: Math.round(f.y), px: Math.round(f.prevX == null ? f.x : f.prevX), py: Math.round(f.prevY == null ? f.y : f.prevY),
      tx: f.tx == null ? null : Math.round(f.tx), ty: f.ty == null ? null : Math.round(f.ty),
      target: f.targetPlanet || 0, targetOwner: f.targetOwner || 0, node: f.node || 0, ally: f.ally || 0,
      startX: Math.round(f.startX == null ? f.x : f.startX), startY: Math.round(f.startY == null ? f.y : f.startY),
      srcPlanet: f.srcPlanet || 0, returning: !!f.returning,
      orbiting: f.orbiting || 0, fullyDocked: !!f.fullyDocked, targetOutpost: f.targetOutpost || 0, outpost: f.outpost || 0
    }));
  }
  viewNodes() { return this.nodes.map((n) => ({ id: n.id, x: Math.round(n.x), y: Math.round(n.y), amount: Math.round(n.amount), r: n.radius })); }
  pactKey(a, b) { return Math.min(a, b) + ':' + Math.max(a, b); }
  viewPacts() { return Array.from(this.pacts.values()).map((p) => ({ id: p.id, a: p.a, b: p.b, social: p.social })); }
  viewCoalitions() { return Array.from(this.coalitions.values()).map((c) => ({ id: c.id, color: c.color, members: Array.from(c.members), since: c.since })); }

  broadcast(obj) {
    const text = JSON.stringify(obj);
    for (const ws of sockets) if (ws.joined && !ws.closed && ws.roomId === this.roomId) ws.sendRaw(text);
  }
  broadcastChat(chat) { this.broadcast({ t: 'ev', k: 'chat', ...chat, at: Date.now() }); }

  // Task G: every chat (global / alliance / intercept) is mirrored to the room's god-mode spectators.
  sendToSpectators(obj) {
    if (!this.spectators || !this.spectators.size) return;
    const text = JSON.stringify(obj);
    for (const ws of this.spectators) {
      if (!ws || ws.closed) continue;
      try { ws.sendRaw(text); } catch (e) {}
    }
  }

  // Stage2 Task D: alliance-channel chat only reaches members of one coalition
  broadcastChatToCoalition(chat, coalitionId) {
    const c = this.coalitions.get(coalitionId);
    if (!c) return;
    const msg = Object.assign({ t: 'ev', k: 'chat', at: Date.now() }, chat);
    for (const m of c.members) this.sendToPlayer(this.players.get(m), msg);
    this.sendToSpectators(msg); // Task G: spectators also receive alliance chatter
  }

  // Stage2 Task D: #截获 — alliance chatter may leak to a random non-member living human.
  maybeIntercept(text, senderP, isMark) {
    const s = String(text || '');
    if (!s || !senderP) return;
    const chars = Array.from(s).length;
    const chance = isMark ? 0.20 : (chars >= 4 ? 0.10 : 0);
    if (chance <= 0 || Math.random() >= chance) return;
    const pool = [];
    for (const q of this.players.values()) {
      if (!q || q.bot || !q.conn) continue;         // only living online humans
      if (q.id === senderP.id) continue;             // never the sender
      if (q.eliminatedAt) continue;
      if (senderP.coalition && q.coalition === senderP.coalition) continue; // never the same coalition
      pool.push(q);
    }
    if (!pool.length) return;
    const target = pool[Math.floor(Math.random() * pool.length)];
    const leaked = { t: 'ev', k: 'chat', channel: 'ally', intercept: true, text: '[#截获] ' + s };
    this.sendToPlayer(target, leaked);
    this.sendToSpectators(leaked); // Task G: spectators also receive #截获 traffic
  }
  broadcastState() {
    const now = Date.now();
    const rem = this.remainingMs(now);
    const base = {
      t: 'state', ts: now, tick: this.tick, roomId: this.roomId, mode: this.mode, status: this.status, hostId: this.hostId,
      noJoin: !!this.noJoin, remainingMs: rem,
      players: this.viewPlayers(), planets: this.viewPlanets(), fleets: this.viewFleets(),
      nodes: this.viewNodes(), outposts: this.viewOutposts(), pacts: this.viewPacts(), coalitions: this.viewCoalitions()
    };
    if (this.mode === 'normal' && rem <= 180000) { base.countdownSec = Math.ceil(rem / 1000); base.leaderboard = this.leaderboard(); }
    const text = JSON.stringify(base);
    for (const ws of sockets) {
      if (!ws.joined || ws.closed || ws.roomId !== this.roomId) continue;
      ws.sendRaw(JSON.stringify(Object.assign({}, base, { spectating: !!ws.spectating })));
    }
  }

  sendWelcome(ws, p, resumed) {
    ws.send({
      t: 'hello', id: p.id, token: p.token, resumed: !!resumed, world: WORLD,
      roomId: this.roomId, mode: this.mode, name: this.name, status: this.status,
      maxPlayers: this.maxPlayers, hostId: this.hostId, mods: this.modDetails, spectating: !!ws.spectating,
      rules: { tickMs: TICK_MS, maxPlayers: this.maxPlayers, shipSpeed: SHIP_SPEED, reinforceRate: REINFORCE_RATE,
        resourcePerShip: RESOURCE_PER_SHIP, destroyMin: DESTROY_MIN, destroyTime: DESTROY_TIME, socialCost: ALLY_COST,
        respawnSeconds: RESPAWN_SECONDS, outpostLevels: OUTPOST_LEVELS },
      players: this.viewPlayers(), planets: this.viewPlanets(), fleets: this.viewFleets(),
      nodes: this.viewNodes(), outposts: this.viewOutposts(), pacts: this.viewPacts(), coalitions: this.viewCoalitions()
    });
  }

  /* ---------- simulation ---------- */

  step() {
    const now = Date.now();
    let dt = (now - this.lastSim) / 1000;
    this.lastSim = now;
    if (dt <= 0) return;
    if (dt > 1.0) dt = 1.0;
    this.updateRoomState(now);
    if (this.status === 'settled') { this.tick++; return; }
    if (this.mode === 'elim' && this.status === 'waiting') {
      // lobby: physics is paused but clients still need lobby/state updates
      this.tick++;
      if (this.tick % 2 === 0) this.broadcastState();
      return;
    }
    if (this.mode === 'normal' && this.humanCount() === 0) {
      // freeze the tick while no human is online (offline seats keep their worlds)
      this.tick++;
      return;
    }
    this.simulate(dt, now);
    this.tick++;
    if (this.tick % 2 === 0) this.broadcastState();
  }

  updateRoomState(now) {
    if (this.status === 'settled' || this.settled) return;
    if (this.mode === 'normal') {
      const rem = this.remainingMs(now);
      if (rem <= 300000) this.noJoin = true;
      if (rem <= 0) return this.settleRoom('timeup');
      const humanPlayers = Array.from(this.players.values()).filter((p) => !p.bot);
      if (this.hadHumans && this.humanCount() === 0 && humanPlayers.length === 0) return this.settleRoom('only-ai');
    } else if (this.mode === 'elim' && this.status === 'running') {
      const rem = this.remainingMs(now);
      if (rem <= 0) return this.settleRoom('timeup');
      const alive = Array.from(this.players.values()).filter((p) => !p.permanentlyOut);
      const humans = Array.from(this.players.values()).filter((p) => !p.bot);
      if (alive.length <= 1) return this.settleRoom('last-standing');
      if (humans.length > 0 && humans.every((h) => h.permanentlyOut || h.eliminatedAt)) return this.settleRoom('humans-out');
    }
  }

  settleRoom(reason) {
    if (this.settled || this.status === 'settled') return;
    this.settled = true;
    this.status = 'settled';
    this.settledAt = Date.now();
    this.noJoin = true;
    const rankings = this.leaderboard();
    this.broadcast({ t: 'ev', k: 'room-settled', mode: this.mode, reason: reason || 'ended', roomId: this.roomId, rankings });
    this.logEvent('room ' + this.roomId + ' settled (' + (reason || 'ended') + ')');
  }

  simulate(dt, now) {
    // expire stale pact requests (90s) so nobody is left hanging
    if (this.pendingPacts && this.pendingPacts.size) {
      for (const [key, rec] of Array.from(this.pendingPacts.entries())) {
        if (rec.expireAt && now > rec.expireAt) {
          this.pendingPacts.delete(key);
          this.broadcast({ t: 'ev', k: 'pact-expired', a: rec.from, b: rec.to });
        }
      }
    }
    this.simulatePlanets(dt, now);
    this.simulateFleets(dt, now);
    this.simulateJoints(now);
    this.simulateTrades(now);
    this.simulateVotes(now);
    if (this.humanCount() > 0) this.runAI(now);
    for (const p of this.players.values()) if (p.conn) p.resource += RESOURCE_REGEN * dt;
    this.checkNewbieShields(now);
    this.checkEliminations(now);
  }

  checkNewbieShields(now) {
    for (const p of this.players.values()) {
      if (!p.shieldUntil) continue;
      let worlds = 0;
      for (const pl of this.planets.values()) if (pl.owner === p.id) worlds++;
      if (worlds >= NEWBIE_SHIELD_WORLDS || now > p.shieldUntil) {
        p.shieldUntil = 0;
        this.broadcast({ t: 'ev', k: 'shield-off', id: p.id, worlds });
        this.logEvent(p.name + ' shield ended (worlds=' + worlds + ')');
      }
    }
  }

  checkEliminations(now) {
    for (const p of this.players.values()) {
      if (p.permanentlyOut) continue;
      if (!p.conn && !p.bot) continue;
      let planets = 0, shipsInSpace = 0;
      for (const pl of this.planets.values()) if (pl.owner === p.id) planets++;
      for (const f of this.fleets.values()) if (f.owner === p.id) shipsInSpace += f.n;
      // a freshly (re)spawned pilot is not judged for the first 15 seconds of the protection window
      if (p.spawnedAt && now - p.spawnedAt < 15000) { p.landlessSince = 0; continue; }
      // eliminated once every world is lost; a small fleet still drifting cannot save the seat
      if (planets === 0 && shipsInSpace < 4) {
        if (!p.landlessSince) this.logEvent(p.name + ' is landless (' + shipsInSpace + ' ships in space)');
        if (!p.landlessSince) p.landlessSince = now;
        if (!p.eliminatedAt && now - p.landlessSince > ELIM_GRACE) {
          this.logEvent(p.name + ' eliminated after ' + Math.round((now - p.landlessSince) / 100) / 10 + 's landless');
          this.eliminate(p);
          if (this.mode === 'elim') p.permanentlyOut = true;            // 淘汰模式：不再重生
          else if (p.bot && this.mode === 'normal' && this.humanCount() > 4) p.permanentlyOut = true; // 真人>4 时淘汰 AI 不重生
        }
      } else {
        p.landlessSince = 0;
      }
      if (p.eliminatedAt && !p.permanentlyOut && now - p.eliminatedAt >= RESPAWN_SECONDS * 1000) {
        this.startAsNewPlayer(p);
      }
    }
  }

  simulateOutposts(dt, now) {
    // outposts never auto-produce ships; their garrison only changes through combat/docking
    for (const o of Array.from(this.planets.values())) {
      if (!o.isOutpost) continue;
      if (o.owner && !this.players.has(o.owner)) o.owner = 0;
    }
  }

  simulatePlanets(dt, now) {
    for (const pl of Array.from(this.planets.values())) {
      if (pl.isOutpost) {
        // outposts: no ore, no reinforcement, no collapse — only ownership/garrison changes
        if (pl.owner && !this.players.has(pl.owner)) pl.owner = 0;
        continue;
      }
      if (pl.owner) {
        // ore regenerates slowly so a busy world does not die overnight
        if (!pl.exhausted) pl.resource = Math.min(pl.resource + 0.6 * dt, pl.maxResource || 180);
        if (pl.exhausted && pl.resource >= 20) pl.exhausted = false;
        // a besieged world keeps producing until its garrison is wiped out, then production stops
        const besieged = Array.from(this.fleets.values()).some((g) => g.orbiting === pl.id && g.owner !== pl.owner && !this.areAllied(g.owner, pl.owner) && g.n > 0.01);
        // reinforcement: one ship per second, one ore per ship, and only below the cap
        if (pl.reinforce && !pl.exhausted && pl.resource >= 1 && pl.troops < pl.cap - 0.01 && !(besieged && pl.troops < 1)) {
          const room = Math.max(0, pl.cap - pl.troops);
          const add = Math.min(REINFORCE_RATE * dt, room);
          pl.troops += add;
          pl.resource = Math.max(0, pl.resource - add * RESOURCE_PER_SHIP);
          if (pl.resource <= 0) {
            pl.resource = 0;
            pl.exhausted = true;
            this.broadcast({ t: 'ev', k: 'planet-exhausted', planet: pl.id, name: planetName(pl), x: Math.round(pl.x), y: Math.round(pl.y) });
            this.broadcastChat({ id: 0, name: '航管中心', text: '『' + planetName(pl) + '』矿床枯竭', sys: true });
            this.logEvent('world ' + planetName(pl) + ' exhausted');
          }
        } else if (pl.exhausted) {
          // Stage2 Task D: drained world costs 1.0 * troops per second of global resource;
          // once the pool is empty the garrison starves at 0.5 ships per second.
          const owner = this.players.get(pl.owner);
          if (owner) {
            const upkeep = pl.troops * EXHAUST_UPKEEP_PER_SHIP * dt;
            if (owner.resource >= upkeep) owner.resource -= upkeep;
            else { owner.resource = 0; pl.troops = Math.max(0, pl.troops - EXHAUST_STARVE_RATE * dt); }
          }
        }
      }
      if (pl.destroyTimer > 0) {
        if (pl.owner !== pl.destroyBy || pl.troops < DESTROY_MIN || !this.players.has(pl.destroyBy)) {
          pl.destroyTimer = 0; pl.destroyBy = 0;
          this.broadcast({ t: 'ev', k: 'destroy-cancel', planet: pl.id });
        } else {
          pl.destroyTimer -= dt;
          if (pl.destroyTimer <= 0) {
            const dOwner = this.players.get(pl.destroyBy);
            // 读条期间若已失去其它落脚点，则取消摧毁，绝不让玩家自爆最后一颗星球
            if (!dOwner || !this.hasOtherLandingSpot(dOwner, pl.id)) {
              pl.destroyTimer = 0; pl.destroyBy = 0;
              this.broadcast({ t: 'ev', k: 'destroy-cancel', planet: pl.id });
            } else {
              this.destroyPlanet(pl, dOwner);
            }
          }
        }
      }
      // exhausted, empty worlds decay: a 20s collapse bar runs while nobody holds the world
      const occupied = Array.from(this.fleets.values()).some((f) => f.orbiting === pl.id);
      // decay starts whenever nobody is actively holding the world: no garrison, no friendly fleet in orbit
      const garrisoned = pl.troops > 0.01;
      if (pl.exhausted && !garrisoned && !occupied && this.planets.size > 6) {
        pl.collapseTimer = (pl.collapseTimer || 0) + dt;
        if (pl.collapseTimer >= COLLAPSE_SECONDS) {
          this.collapsePlanet(pl);
          continue;
        }
      } else {
        pl.collapseTimer = 0;
      }
    }
    for (const n of this.nodes) n.amount = Math.min(120, n.amount + 0.4 * dt);
  }

  destroyPlanet(pl, by) {
    const reward = Math.min(60, DESTROY_RESOURCE + Math.floor(pl.resource * 0.1));
    if (by) by.resource += 200;
    const surplus = Math.max(0, Math.floor(pl.troops) - 6);
    // every fleet that was orbiting is evicted to its owner's nearest surviving world
    for (const f of Array.from(this.fleets.values())) {
      if (f.orbiting !== pl.id) continue;
      const fa = this.players.get(f.owner);
      const homeW = fa ? this.homeOf(fa.id) : null;
      f.orbiting = 0;
      f.kind = 'march';
      f.targetPlanet = homeW && homeW.id !== pl.id ? homeW.id : 0;
      f.tx = homeW && homeW.id !== pl.id ? homeW.x : null;
      f.ty = homeW && homeW.id !== pl.id ? homeW.y : null;
      const ang = rand(0, Math.PI * 2);
      f.x = pl.x + Math.cos(ang) * (pl.radius + 60);
      f.y = pl.y + Math.sin(ang) * (pl.radius + 60);
      if (!homeW) this.fleets.delete(f.id);
    }
    this.broadcast({ t: 'ev', k: 'planet-destroyed', planet: pl.id, by: by ? by.id : 0, name: planetName(pl), x: Math.round(pl.x), y: Math.round(pl.y), reward });
    this.broadcastChat({ id: 0, name: '航管中心', text: (by ? by.name : '无人') + ' 摧毁了『' + planetName(pl) + '』', sys: true });
    this.logEvent('world ' + planetName(pl) + ' destroyed by ' + (by ? by.name : 'none'));
    this.planets.delete(pl.id);
    const home = by ? this.homeOf(by.id) : null;
    if (home) home.resource += reward;
    if (by && surplus > 0) this.spawnFleet(by, { x: pl.x, y: pl.y, n: surplus, kind: 'march', targetPlanet: home ? home.id : 0 });
    this.repairOwners();
    setTimeout(() => this.spawnPlanetNear(), 1800);
  }

  collapsePlanet(pl) {
    this.broadcast({
      t: 'ev', k: 'planet-destroyed', planet: pl.id, by: 0, name: planetName(pl),
      x: Math.round(pl.x), y: Math.round(pl.y), radius: Math.round(pl.radius), splash: true, reward: 0
    });
    this.broadcastChat({ id: 0, name: '航管中心', text: '『' + planetName(pl) + '』崩解为离子尘云', sys: true });
    this.logEvent('world ' + planetName(pl) + ' collapsed (ion splash)');
    this.planets.delete(pl.id);
    this.repairOwners();
    setTimeout(() => this.spawnPlanetNear(), 1500);
  }

  repairOwners() {
    for (const p of this.players.values()) {
      const mine = Array.from(this.planets.values()).filter((pl) => pl.owner === p.id);
      if (!mine.length) { p.homePlanet = 0; continue; }
      if (!p.homePlanet || !this.planets.has(p.homePlanet) || this.planets.get(p.homePlanet).owner !== p.id) {
        mine.sort((a, b) => b.troops - a.troops);
        p.homePlanet = mine[0].id;
        this.broadcast({ t: 'ev', k: 'home', id: p.id, planet: p.homePlanet });
      }
    }
  }

  homeOf(playerId) {
    const p = this.players.get(playerId);
    if (!p) return null;
    if (p.homePlanet && this.planets.has(p.homePlanet) && this.planets.get(p.homePlanet).owner === playerId) return this.planets.get(p.homePlanet);
    const mine = Array.from(this.planets.values()).filter((pl) => pl.owner === playerId);
    if (!mine.length) return null;
    mine.sort((a, b) => b.troops - a.troops);
    p.homePlanet = mine[0].id;
    return mine[0];
  }

  spawnFleet(owner, opts) {
    const f = {
      id: this.nextFleet++, owner: owner.id, n: Math.max(1, opts.n), x: opts.x, y: opts.y, vx: 0, vy: 0,
      kind: opts.kind || 'march', targetPlanet: opts.targetPlanet || 0, targetOwner: 0,
      node: opts.node || 0, ally: opts.ally || 0, tx: null, ty: null, charge: 0, created: Date.now(),
      prevX: opts.x, prevY: opts.y,
      startX: opts.x, startY: opts.y, srcPlanet: opts.srcPlanet || 0, returning: false
    };
    if (f.targetPlanet && this.planets.has(f.targetPlanet)) {
      const tp = this.planets.get(f.targetPlanet);
      f.tx = tp.x; f.ty = tp.y; f.targetOwner = tp.owner;
    } else if (f.kind === 'gather' && f.node) {
      const n = this.nodes.find((x) => x.id === f.node);
      if (n) { f.tx = n.x; f.ty = n.y; }
    } else if (f.kind === 'social') {
      const t = this.players.get(f.ally);
      const home = t ? this.homeOf(t.id) : null;
      if (home) { f.tx = home.x; f.ty = home.y; }
    }
    // start on the source world's orbit ring (facing the destination), never from the planet centre
    if (opts.srcPlanet && this.planets.has(opts.srcPlanet) && f.tx != null) {
      const sp = this.planets.get(opts.srcPlanet);
      const ddx = f.tx - sp.x, ddy = f.ty - sp.y, dl = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
      const rr = sp.radius * 1.35;
      const px = sp.x + (ddx / dl) * rr, py = sp.y + (ddy / dl) * rr;
      f.x = px; f.y = py; f.prevX = px; f.prevY = py; f.startX = px; f.startY = py;
    }
    this.fleets.set(f.id, f);
    this.broadcast({ t: 'ev', k: 'fleet-spawn', fleet: this.viewFleets().find((v) => v.id === f.id) });
    return f;
  }

  simulateFleets(dt, now) {
    for (const f of Array.from(this.fleets.values())) {
      if (f.kind === 'social') {
        const t = this.players.get(f.ally);
        const home = t ? this.homeOf(t.id) : null;
        if (!home) { this.fleets.delete(f.id); continue; }
        f.tx = home.x; f.ty = home.y;
        this.steer(f, dt);
        if (Math.sqrt(dist2(f.x, f.y, home.x, home.y)) < 100) this.finishSocial(f);
        continue;
      }
      if (f.kind === 'gather') {
        const node = this.nodes.find((n) => n.id === f.node);
        if (!node) {
          const home = this.homeOf(f.owner);
          f.kind = 'march'; f.returning = true;
          f.startX = f.x; f.startY = f.y;
          f.targetPlanet = home ? home.id : 0; f.tx = home ? home.x : null; f.ty = home ? home.y : null;
          continue;
        }
        f.tx = node.x; f.ty = node.y;
        // clear a stale reader (fleet gone / retargeted)
        if (node.readingFleetId) {
          const rf = this.fleets.get(node.readingFleetId);
          if (!rf || rf.kind !== 'gather' || rf.node !== node.id) node.readingFleetId = null;
        }
        if (Math.sqrt(dist2(f.x, f.y, node.x, node.y)) < node.radius + NODE_CLAIM_RADIUS) {
          if (!node.readingFleetId || node.readingFleetId === f.id) {
            node.readingFleetId = f.id;
            f.charge += dt;
            if (f.charge >= NODE_CHARGE_TIME) {
              const owner = this.players.get(f.owner);
              const home = owner ? this.homeOf(owner.id) : null;
              const take = Math.min(node.amount, NODE_RESOURCE_GAIN);
              node.amount -= take;
              if (home) home.resource += take;
              if (owner) owner.resource += 60;
              this.broadcast({ t: 'ev', k: 'node-claimed', node: node.id, by: f.owner, amount: round1(take), x: Math.round(node.x), y: Math.round(node.y), name: owner ? owner.name : '' });
              if (node.amount <= 0) this.nodes = this.nodes.filter((n) => n.id !== node.id);
              node.readingFleetId = null;
              // carry the node position back so the client can draw the return leg
              f.kind = 'march'; f.returning = true;
              f.startX = node.x; f.startY = node.y;
              f.targetPlanet = home ? home.id : 0; f.tx = home ? home.x : null; f.ty = home ? home.y : null;
            }
            continue;
          }
          // a different fleet is already reading: latecomer fails and is sent back
          f.kind = 'march'; f.returning = true;
          f.startX = node.x; f.startY = node.y;
          const backPl = this.planets.get(f.srcPlanet) || this.homeOf(f.owner);
          f.targetPlanet = backPl ? backPl.id : 0;
          f.tx = backPl ? backPl.x : null; f.ty = backPl ? backPl.y : null;
          continue;
        }
        this.steer(f, dt);
        continue;
      }
      // march
      const tp = f.targetPlanet ? this.planets.get(f.targetPlanet) : null;
      if (!tp) {
        const home = this.homeOf(f.owner);
        if (!home) { this.fleets.delete(f.id); continue; }
        f.targetPlanet = home.id; f.tx = home.x; f.ty = home.y; f.targetOwner = home.owner;
      } else { f.tx = tp.x; f.ty = tp.y; }
      // an orbiting fleet holds its station on the ring; it must not dive into the planet centre
      if (!f.orbiting) this.steer(f, dt);
      const cur = this.planets.get(f.targetPlanet);
      if (!cur) continue;
      // hand off to orbit OUTSIDE the planet (ring radius), not on its surface
      var arriveR = (cur.isOutpost ? cur.radius * 1.15 : cur.radius * 1.28) + 4;
      if (!f.orbiting && Math.sqrt(dist2(f.x, f.y, cur.x, cur.y)) <= arriveR) this.arrive(f, cur, now);
      const opT = f.targetOutpost ? this.outpostAt(f.targetOutpost) : null;
      if (opT && Math.sqrt(dist2(f.x, f.y, opT.x, opT.y)) <= opT.radius + 8) this.arriveOutpost(f, opT);
    }
    this.resolveCombat(dt);
  }

  steer(f, dt) {
    if (f.tx == null) return;
    f.prevX = f.x; f.prevY = f.y;
    const d = Math.sqrt(dist2(f.x, f.y, f.tx, f.ty));
    if (d < 1) return;
    const speed = SHIP_SPEED * this.speedMultiplier * (1 + Math.min(0.25, f.n / 200));
    const v = Math.min(speed, d / dt);
    f.x += ((f.tx - f.x) / d) * v * dt;
    f.y += ((f.ty - f.y) / d) * v * dt;
  }

  outpostAt(id) { const pl = this.planets.get(Number(id)); return pl && pl.isOutpost ? pl : null; }

  arriveOutpost(f, op) {
    return this.arrive(f, op, Date.now());
  }

  arriveOutpostLegacy(f, op) {
    const owner = this.players.get(f.owner);
    if (!owner) { this.fleets.delete(f.id); return; }
    if (op.owner === f.owner || this.areAllied(op.owner, f.owner)) {
      op.troops = Math.min(op.cap, op.troops + f.n);
      this.fleets.delete(f.id);
      this.broadcast({ t: 'ev', k: 'outpost-merge', owner: f.owner, outpost: op.id, n: Math.floor(f.n) });
      return;
    }
    f.outpost = op.id;
    f.orbiting = 0;
  }

  mergeIntoPlanet(f, pl) {
    // garrison fills up to its cap; surplus ships stay in orbit as an escort fleet (never deleted)
    const room = Math.max(0, Math.floor(pl.cap - pl.troops));
    const absorbed = Math.min(room, Math.floor(f.n));
    pl.troops = Math.min(pl.cap, pl.troops + absorbed);
    f.n = Math.max(0, f.n - absorbed);
    if (f.n >= 1) {
      f.orbiting = pl.id;
      f.targetPlanet = pl.id;
      f.tx = pl.x; f.ty = pl.y;
      this.broadcast({ t: 'ev', k: 'fleet-holding', fleet: f.id, planet: pl.id, owner: f.owner, n: Math.floor(f.n) });
    } else {
      this.fleets.delete(f.id);
    }
    if (absorbed > 0) this.broadcast({ t: 'ev', k: 'fleet-merge', planet: pl.id, owner: f.owner, n: absorbed });
  }

  arrive(f, pl, now) {
    const owner = this.players.get(f.owner);
    if (!owner) { this.fleets.delete(f.id); return; }
    if (pl.owner !== f.owner && !this.areAllied(pl.owner, f.owner) && this.isShielded(pl)) {
      f.orbiting = 0;
      const ang = Math.atan2(f.y - pl.y, f.x - pl.x) + rand(-0.6, 0.6);
      f.x = pl.x + Math.cos(ang) * (pl.radius + 90);
      f.y = pl.y + Math.sin(ang) * (pl.radius + 90);
      return;
    }
    if (!f.orbiting) {
      f.orbiting = pl.id;
      // 首个飞船进入后，留出 320~780ms 供后续加速飞船全员并入轨道；全员入轨前不触发交战或读条
      const dockMs = Math.min(780, 260 + Math.round(Math.sqrt(Math.max(1, f.n)) * 65));
      f.dockAt = Date.now() + dockMs;
      f.fullyDocked = false;
      var ang0 = Math.atan2(f.y - pl.y, f.x - pl.x) || 0;
      var rr0 = pl.radius * 1.42;
      f.x = pl.x + Math.cos(ang0) * rr0;
      f.y = pl.y + Math.sin(ang0) * rr0;
      f.tx = f.x; f.ty = f.y;
      f.capture = 0;
      this.broadcast({ t: 'ev', k: 'fleet-arrived', fleet: f.id, planet: pl.id, owner: f.owner, n: Math.floor(f.n), dockMs });
    }
  }

  capture(pl, owner, f) {
    if (!f) f = { n: pl.orbitTotal || 0 };
    const prev = pl.owner;
    pl.owner = owner.id;
    pl.color = this.displayColorOf(owner.id);
    pl.troops = Math.max(0, Math.min(pl.cap, f.n));
    pl.exhausted = pl.resource <= 0;
    pl.destroyTimer = 0; pl.destroyBy = 0;
    pl.captureBy = 0; pl.captureProg = 0;
    pl.purityProg = 1;
    pl.contribLog = [];
    pl.reinforce = !pl.isOutpost;
    pl.invulnUntil = 0;
    const victim = this.players.get(prev);
    if (victim && victim.homePlanet === pl.id) victim.homePlanet = 0;
    this.broadcast({ t: 'ev', k: 'planet-captured', planet: pl.id, by: owner.id, prev, name: planetName(pl), x: Math.round(pl.x), y: Math.round(pl.y) });
    this.broadcastChat({ id: 0, name: '航管中心', text: owner.name + ' 占领了『' + planetName(pl) + '』', sys: true });
    this.repairOwners();
    this.logEvent(owner.name + ' captured ' + planetName(pl));
  }

  // 占领基础成本（对应 30 艘飞船速度 1.0 时的基准秒数：S/驻点=20s，M=30s，L=45s）
  purifyCost(pl) { return pl.isOutpost ? 20 : (pl.size === 'S' ? 20 : pl.size === 'M' ? 30 : 45); }

  // 30 艘飞船时速度恰为 1.00/s -> 占领中型星球（cost=30）耗时 30 秒
  captureSpeed(shipsCount) {
    const n = Math.max(0, shipsCount);
    if (n <= 0) return 0;
    return Math.min(1.65, 0.35 + 0.0217 * n) * CAPTURE_RATE;
  }

  recordContribution(pl, blocFleets, deltaProg, now) {
    if (!pl.contribLog) pl.contribLog = [];
    const cutoff = now - 90000;
    while (pl.contribLog.length && pl.contribLog[0].at < cutoff) pl.contribLog.shift();
    const totalN = blocFleets.reduce((s, f) => s + f.n, 0);
    if (totalN <= 0 || deltaProg <= 0) return;
    for (const f of blocFleets) {
      if (f.n <= 0) continue;
      pl.contribLog.push({ owner: f.owner, amount: deltaProg * (f.n / totalN), at: now });
    }
  }

  pickCapturingOwner(pl, blocFleets, now) {
    const cutoff = now - 90000;
    const inOrbitOwners = new Set(blocFleets.map((f) => f.owner));
    const scores = new Map();
    if (Array.isArray(pl.contribLog)) {
      for (const rec of pl.contribLog) {
        if (rec.at >= cutoff && inOrbitOwners.has(rec.owner)) {
          scores.set(rec.owner, (scores.get(rec.owner) || 0) + rec.amount);
        }
      }
    }
    let bestOwner = 0, bestScore = -1, bestShips = -1;
    for (const oid of inOrbitOwners) {
      const sc = scores.get(oid) || 0;
      const sh = blocFleets.filter((f) => f.owner === oid).reduce((s, f) => s + f.n, 0);
      if (sc > bestScore + 1e-6 || (Math.abs(sc - bestScore) <= 1e-6 && sh > bestShips)) {
        bestScore = sc; bestShips = sh; bestOwner = oid;
      }
    }
    return bestOwner || (blocFleets[0] && blocFleets[0].owner) || 0;
  }

  damageBloc(bloc, amount) {
    let rem = amount;
    while (rem > 0.001) {
      const step = Math.min(1, rem);
      const units = [];
      if (bloc.hasGarrison && bloc.pl.troops > 0.01) units.push({ isGarrison: true, w: bloc.pl.troops });
      for (const f of bloc.fleets) if (f.n > 0.01) units.push({ isGarrison: false, f, w: f.n });
      if (!units.length) break;
      const totalW = units.reduce((s, u) => s + u.w, 0) || 1;
      let r = Math.random() * totalW, pick = units[0];
      for (const u of units) { r -= u.w; if (r <= 0) { pick = u; break; } }
      if (pick.isGarrison) {
        bloc.pl.troops = Math.max(0, bloc.pl.troops - step);
      } else {
        pick.f.n = Math.max(0, pick.f.n - step);
        if (pick.f.n <= 0.01) this.fleets.delete(pick.f.id);
      }
      rem -= step;
    }
  }

  resolveCombat(dt) {
    const now = Date.now();
    const byPlanet = new Map();
    for (const f of Array.from(this.fleets.values())) {
      if (f.outpost) { f.orbiting = f.outpost; f.outpost = 0; }
      if (!f.orbiting) continue;
      if (!byPlanet.has(f.orbiting)) byPlanet.set(f.orbiting, []);
      byPlanet.get(f.orbiting).push(f);
    }

    for (const pl of this.planets.values()) {
      const list = byPlanet.get(pl.id) || [];
      const readyFleets = [];
      for (const f of list) {
        if (!this.fleets.has(f.id)) continue;
        if (pl.owner !== f.owner && !this.areAllied(pl.owner, f.owner) && this.isShielded(pl)) {
          f.orbiting = 0; continue;
        }
        // 全员入轨门控：未到 dockAt 前不参与交战、不合并、不读条
        if (f.dockAt && now < f.dockAt) continue;
        if (!f.fullyDocked) {
          f.fullyDocked = true;
          this.broadcast({ t: 'ev', k: 'fleet-orbit-ready', fleet: f.id, planet: pl.id, owner: f.owner, n: Math.floor(f.n) });
        }
        if (pl.owner && pl.owner === f.owner) {
          this.mergeIntoPlanet(f, pl);
          if (this.fleets.has(f.id) && f.n >= 1) readyFleets.push(f);
          continue;
        }
        if (f.n >= 0.01) readyFleets.push(f);
      }

      // 按同盟关系聚合为战斗集群（Allied Blocs）：盟友视为同一整体，绝不互打
      const blocs = [];
      const findBloc = (ownerId) => {
        if (!ownerId) return null;
        for (const b of blocs) {
          if (b.repOwner === ownerId || this.areAllied(b.repOwner, ownerId)) return b;
        }
        const nb = { repOwner: ownerId, pl, hasGarrison: false, fleets: [], total: 0 };
        blocs.push(nb);
        return nb;
      };

      if (pl.owner > 0 && pl.troops > 0.01) {
        const defBloc = findBloc(pl.owner);
        defBloc.hasGarrison = true;
        defBloc.total += pl.troops;
      } else if (pl.owner === 0 && pl.troops > 0.01) {
        blocs.push({ repOwner: 0, pl, hasGarrison: true, fleets: [], total: pl.troops });
      }

      for (const f of readyFleets) {
        const b = findBloc(f.owner);
        if (b) { b.fleets.push(f); b.total += f.n; }
      }

      const activeBlocs = blocs.filter((b) => b.total > 0.01);

      // Phase A: 只要存在 >= 2 个互不结盟的集群（含多方混战或攻守交战），立即执行 5+-1 近似对称战损
      if (activeBlocs.length >= 2) {
        const totalShips = activeBlocs.reduce((s, b) => s + b.total, 0);
        // 交火轮次速率：每秒 2 ~ 9 轮成对互换
        const pairRate = clamp(1.8 + totalShips / 18, 2.0, 9.0);
        pl.combatAcc = (pl.combatAcc || 0) + dt * pairRate;
        if (pl.tradeStep == null) { pl.tradeStep = 0; pl.tradeBias = 0; }

        let guard = 0;
        while (pl.combatAcc >= 1 && guard++ < 10) {
          pl.combatAcc -= 1;
          const live = activeBlocs.filter((b) => {
            b.total = (b.hasGarrison ? pl.troops : 0) + b.fleets.reduce((s, f) => s + (this.fleets.has(f.id) ? f.n : 0), 0);
            return b.total > 0.01;
          });
          if (live.length < 2) break;

          // 抽取两方进行本轮互换（多方混战时按在轨兵力权重抽取两方交火）
          live.sort((a, b) => b.total - a.total);
          const bA = live[0];
          const bB = live.length === 2 ? live[1] : live[1 + Math.floor(Math.random() * (live.length - 1))];

          // 5+-1 有界互换：每 5 轮为一个窗口，净偏差严格钳制在 [-1, +1]（即 A 死 5 艘时 B 必死 4~6 艘）
          pl.tradeStep = (pl.tradeStep + 1) % 5;
          if (pl.tradeStep === 0) pl.tradeBias = 0;

          let lossA = 1, lossB = 1;
          const ratioA = bA.total / Math.max(1, bA.total + bB.total);
          if (Math.random() < 0.28) {
            if (Math.random() < ratioA && pl.tradeBias < 1) {
              // 兵多方小概率占优 1 艘，但窗口内最多 +1
              lossA = 0; lossB = 1; pl.tradeBias += 1;
            } else if (pl.tradeBias > -1) {
              lossA = 1; lossB = 0; pl.tradeBias -= 1;
            }
          }

          if (lossA > 0) this.damageBloc(bA, lossA);
          if (lossB > 0) this.damageBloc(bB, lossB);
        }
        continue;
      }

      // 此时 activeBlocs.length <= 1（无敌对交火）
      const soleBloc = activeBlocs[0] || null;
      const isHostileSole = soleBloc && soleBloc.repOwner !== 0 && soleBloc.repOwner !== pl.owner && !this.areAllied(soleBloc.repOwner, pl.owner);

      if (!isHostileSole) {
        // 无敌军在轨：中立星保持 purity=0 且占领进度缓慢回退；有主星缓慢恢复阵营化
        const anyWaitingHostile = list.some((f) => f.n > 0.01 && f.owner !== pl.owner && !this.areAllied(f.owner, pl.owner));
        if (!anyWaitingHostile) {
          if (pl.owner === 0) {
            pl.purityProg = 0;
            pl.captureProg = Math.max(0, (pl.captureProg || 0) - dt * 0.08);
            if (pl.captureProg <= 0.001) pl.captureBy = 0;
          } else if ((pl.purityProg == null ? 1 : pl.purityProg) < 1) {
            pl.purityProg = Math.min(1, pl.purityProg + dt * 0.5 / this.purifyCost(pl));
          }
        }
        continue;
      }

      // 唯一在轨集群为进攻方同盟（且守军已清零）：推进两步占领读条并记录 90s 阵营化贡献度
      const atkTotal = soleBloc.fleets.reduce((a, f) => a + f.n, 0);
      const S = this.purifyCost(pl);
      const speed = this.captureSpeed(atkTotal);

      // Phase B1: 净化原球主（耗时为占领的 40%，如 30 船净化中型星需 12s）
      if (pl.owner !== 0) {
        const deltaPur = dt * speed / (S * 0.40);
        this.recordContribution(pl, soleBloc.fleets, deltaPur, now);
        pl.purityProg = Math.max(0, (pl.purityProg == null ? 1 : pl.purityProg) - deltaPur);
        if (pl.purityProg <= 0.001) {
          const prev = pl.owner;
          pl.owner = 0; pl.color = ''; pl.troops = 0;
          pl.purityProg = 0; pl.captureProg = 0; pl.captureBy = 0;
          const prevP = this.players.get(prev);
          const winOwnerId = this.pickCapturingOwner(pl, soleBloc.fleets, now);
          const atkP = this.players.get(winOwnerId);
          if (prevP && atkP) { const take = Math.min(prevP.resource, 60); prevP.resource -= take; atkP.resource += Math.floor(take / 2); }
          this.broadcast({ t: 'ev', k: 'planet-purified', planet: pl.id, x: Math.round(pl.x), y: Math.round(pl.y), prev });
        }
        continue;
      }

      // Phase B2: 阵营化占领中立星（30 船占领中型星需 30s，按 90s 内贡献度决定同盟内归属）
      const deltaCap = dt * speed / S;
      this.recordContribution(pl, soleBloc.fleets, deltaCap, now);
      const leadOwnerId = this.pickCapturingOwner(pl, soleBloc.fleets, now);
      pl.captureBy = leadOwnerId;
      pl.captureProg = Math.min(1, (pl.captureProg || 0) + deltaCap);
      if (pl.captureProg >= 1) {
        const newOwner = this.players.get(leadOwnerId);
        if (newOwner) {
          // 仅将新球主本人的在轨舰队并入星球驻军；同盟其他成员的舰队保留在轨作为协防舰队！
          const ownFleets = soleBloc.fleets.filter((f) => f.owner === newOwner.id);
          const ownTotal = ownFleets.reduce((s, f) => s + f.n, 0);
          this.capture(pl, newOwner, { n: ownTotal });
          let remainingToAbsorb = pl.troops;
          for (const f of ownFleets) {
            const used = Math.min(f.n, remainingToAbsorb);
            f.n -= used;
            remainingToAbsorb -= used;
            if (f.n < 1) this.fleets.delete(f.id);
          }
        }
      }
    }
  }


  grantKill(ownerId, fleet) {
    const p = this.players.get(ownerId);
    if (p) p.resource += RESOURCE_PER_KILL + fleet.n * 0.4;
    this.broadcast({ t: 'ev', k: 'fleet-destroyed', owner: ownerId, x: Math.round(fleet.x), y: Math.round(fleet.y), n: Math.floor(fleet.n) });
  }

  finishSocial(f) {
    // legacy social fleets no longer create pacts: arriving merely turns into a request
    const a = this.players.get(f.owner), b = this.players.get(f.ally);
    this.fleets.delete(f.id);
    if (!a || !b || a.id === b.id || this.areAllied(a.id, b.id)) return;
    this.requestPact(a, b);
  }

  requestPact(from, to, opts) {
    if (!from || !to || from.id === to.id) return;
    if (this.areAllied(from.id, to.id)) return;
    this.pendingPacts = this.pendingPacts || new Map();
    const key = from.id + ':' + to.id;
    if (this.pendingPacts.has(key)) return;
    this.pendingPacts.set(key, {
      from: from.id, to: to.id, at: Date.now(), expireAt: Date.now() + 90000,
      fromBot: !!from.bot, toBot: !!to.bot, decided: false, decideAt: 0,
      prepaid: !!(opts && opts.prepaid)
    });
    this.broadcast({ t: 'ev', k: 'pact-request', from: from.id, fromName: from.name, to: to.id, cost: ALLY_COST, fromBot: !!from.bot });
    this.broadcastChat({ id: 0, name: '航管中心', text: from.name + ' 向 ' + to.name + ' 发出结盟请求', sys: true });
    // an AI recipient answers on its own after a short, observable delay
    if (to.bot) {
      const rec = this.pendingPacts.get(key);
      rec.decideAt = Date.now() + 1500 + Math.random() * 2500;
    }
  }

  decidePact(from, to, accept) {
    this.pendingPacts = this.pendingPacts || new Map();
    const key = from.id + ':' + to.id;
    if (!this.pendingPacts.has(key)) return false;
    const rec = this.pendingPacts.get(key);
    this.pendingPacts.delete(key);
    if (!accept) {
      this.broadcast({ t: 'ev', k: 'pact-declined', a: from.id, b: to.id });
      this.broadcastChat({ id: 0, name: '航管中心', text: to.name + ' 拒绝了 ' + from.name + ' 的结盟请求', sys: true });
      return true;
    }
    if (!(rec && rec.prepaid)) {
      if (from.resource < ALLY_COST) {
        this.broadcast({ t: 'ev', k: 'pact-declined', a: from.id, b: to.id, reason: 'resource' });
        return false;
      }
      from.resource -= ALLY_COST;
    }
    this.formPact(from, to);
    return true;
  }

  /* ---------- alliances ---------- */

  areAllied(a, b) {
    if (a === b) return true;
    if (this.pacts.has(this.pactKey(a, b))) return true;
    // same coalition = allied, even without a direct pact
    const pa = this.players.get(a);
    const pb = this.players.get(b);
    if (pa && pb && pa.coalition && pa.coalition === pb.coalition) return true;
    return false;
  }
  allyOf(pid) { for (const p of this.pacts.values()) { if (p.a === pid) return p.b; if (p.b === pid) return p.a; } return 0; }

  newCoalition(members) {
    const id = this.nextCoalition++;
    const palette = ['#a78bfa', '#22d3ee', '#f0abfc', '#4ade80', '#fb923c'];
    const used = new Set(Array.from(this.coalitions.values()).map((c) => c.color));
    const color = palette.find((c) => !used.has(c)) || palette[id % palette.length];
    const c = { id, color, members: new Set(members.map((m) => m.id)), since: Date.now() };
    this.coalitions.set(id, c);
    return c;
  }

  formPact(a, b) {
    if (this.pacts.has(this.pactKey(a.id, b.id))) return;
    const pact = { id: this.nextPact++, a: a.id, b: b.id, social: 1, since: Date.now() };
    this.pacts.set(this.pactKey(a.id, b.id), pact);
    const ca = a.coalition ? this.coalitions.get(a.coalition) : null;
    const cb = b.coalition ? this.coalitions.get(b.coalition) : null;
    let coalition;
    if (ca && cb && ca.id !== cb.id) {
      for (const m of Array.from(cb.members)) {
        ca.members.add(m);
        const mp = this.players.get(m); if (mp) mp.coalition = ca.id;
      }
      this.coalitions.delete(cb.id);
      coalition = ca;
    } else if (ca) { ca.members.add(b.id); b.coalition = ca.id; coalition = ca; }
    else if (cb) { cb.members.add(a.id); a.coalition = cb.id; coalition = cb; }
    else coalition = this.newCoalition([a, b]);
    for (const m of coalition.members) { const mp = this.players.get(m); if (mp) mp.coalition = coalition.id; }
    for (const pl of this.planets.values()) if (pl.owner) pl.color = this.displayColorOf(pl.owner);
    this.broadcast({ t: 'ev', k: 'pact-formed', a: a.id, b: b.id, coalition: coalition.id, color: coalition.color });
    this.broadcastChat({ id: 0, name: '航管中心', text: a.name + ' 与 ' + b.name + ' 缔结了盟约', sys: true });
    this.logEvent('pact ' + a.name + ' <-> ' + b.name);
  }

  breakPact(a, b) {
    const key = this.pactKey(a.id, b.id);
    if (!this.pacts.has(key)) return false;
    this.pacts.delete(key);
    const c = a.coalition ? this.coalitions.get(a.coalition) : null;
    if (c) {
      c.members.delete(b.id);
      const members = Array.from(c.members);
      const anyPact = members.some((m, i) => members.some((o, j) => j > i && this.pacts.has(this.pactKey(m, o))));
      if (!anyPact || members.length <= 1) {
        for (const m of members) { const mp = this.players.get(m); if (mp) mp.coalition = 0; }
        this.coalitions.delete(c.id);
      }
    }
    for (const p of this.players.values()) if (p.coalition && !this.coalitions.has(p.coalition)) p.coalition = 0;
    // every world returns to its owner's own faction colour
    // worlds return to their real owner's colour, and any garrison parked abroad goes home
    for (const pl of this.planets.values()) if (pl.owner) pl.color = this.displayColorOf(pl.owner);
    for (const f of Array.from(this.fleets.values())) {
      const fo = this.players.get(f.owner);
      if (!fo) continue;
      const homeW = this.homeOf(fo.id);
      if (!homeW) continue;
      // a fleet sitting over the other side's world after a split returns to its own space
      if (f.orbiting && this.planets.has(f.orbiting)) {
        const host = this.planets.get(f.orbiting);
        if (host.owner !== f.owner) {
          f.orbiting = 0;
          f.kind = 'march';
          f.targetPlanet = homeW.id;
          f.tx = homeW.x; f.ty = homeW.y;
          this.broadcast({ t: 'ev', k: 'fleet-return', owner: f.owner, fleet: f.id });
        }
      }
    }
    this.broadcast({ t: 'ev', k: 'pact-broken', a: a.id, b: b.id });
    this.broadcastChat({ id: 0, name: '航管中心', text: a.name + ' 解除了与 ' + b.name + ' 的盟约', sys: true });
    this.logEvent('pact broken ' + a.name + ' / ' + b.name);
    return true;
  }

  breakAllPactsOf(pid) {
    for (const p of Array.from(this.pacts.values())) {
      if (p.a === pid || p.b === pid) this.pacts.delete(this.pactKey(p.a, p.b));
    }
  }

  /* ---------- AI ---------- */

  countPlanetsOf(ownerId) {
    let n = 0;
    for (const pl of this.planets.values()) if (pl.owner === ownerId) n++;
    return n;
  }

  runAI(now) {
    if (process.env.FREEZE_AI === '1') return;   // deterministic tests
    for (const p of this.players.values()) {
      if (!p.bot || now < (p.aiNext || 0)) continue;
      p.aiNext = now + rand(2200, 3800);
      try { this.aiThink(p, now); } catch (e) { console.error('AI error', e.message); }
    }
  }

  aiThink(p, now) {
    const mine = Array.from(this.planets.values()).filter((pl) => pl.owner === p.id);
    if (!mine.length) {
      const free = Array.from(this.planets.values()).filter((pl) => !pl.owner);
      if (free.length) {
        const pick = free[Math.floor(Math.random() * free.length)];
        pick.owner = p.id; pick.color = this.displayColorOf(p.id); pick.troops = 4; pick.purityProg = 1;
        pick.invulnUntil = 0; p.homePlanet = pick.id;
      }
      return;
    }
    const home = this.homeOf(p.id);
    const moving = Array.from(this.fleets.values()).filter((f) => f.owner === p.id);
    const source = mine.slice().sort((a, b) => b.troops - a.troops)[0];
    if (!moving.length && source.troops >= 8) {
      let best = null, bd = Infinity;
      for (const t of this.planets.values()) {
        if (t.owner === p.id || this.areAllied(p.id, t.owner)) continue;
        if (this.isShielded(t)) continue;
        const d = dist2(source.x, source.y, t.x, t.y);
        if (d > 2600 * 2600) continue;
        let score = d;
        if (t.owner) score *= 0.8;
        // offline human owner: half the distance score => AI focuses them ~2x
        const ownerP = t.owner ? this.players.get(t.owner) : null;
        if (ownerP && !ownerP.bot && !ownerP.conn) score *= 0.5;
        // richer rival faction = the faction the sector is worried about
        score -= this.countPlanetsOf(t.owner) * 700;
        if (t.invulnUntil > now) score *= 2;
        if (score < bd) { bd = score; best = t; }
      }
      if (best) {
        const n = Math.floor(source.troops * rand(0.45, 0.62));
        if (n >= 3) {
          source.troops -= n;
          this.spawnFleet(p, { x: source.x, y: source.y, n, kind: 'march', targetPlanet: best.id, srcPlanet: source.id });
        }
      }
    }
    if (!moving.length && home && this.nodes.length && p.resource > 45 && Math.random() < 0.35) {
      let node = null, nd = Infinity;
      for (const n of this.nodes) { const d = dist2(home.x, home.y, n.x, n.y); if (d < nd) { nd = d; node = n; } }
      if (node && nd < 2200 * 2200) this.spawnFleet(p, { x: home.x, y: home.y, n: 1, kind: 'gather', node: node.id });
    }
    // AI may dissolve an alliance it no longer needs (raises the chance of betrayal)
    if (p.coalition && Math.random() < 0.06) {
      const allyId = this.allyOf(p.id);
      const ally = allyId ? this.players.get(allyId) : null;
      if (ally) {
        const myWorlds = mine.length;
        let allyWorlds = 0;
        for (const pl of this.planets.values()) if (pl.owner === ally.id) allyWorlds++;
        // strong AI quietly walks away from a weaker partner
        if (myWorlds >= allyWorlds + 2) this.breakPact(p, ally);
      }
    }
    // AI ally-seeking: always a *request* the other side must answer (no auto-pact, no social fleet)
    if (!p.coalition && p.resource >= ALLY_COST && now > (p.socialCd || 0) && Math.random() < 0.2) {
      const others = Array.from(this.players.values()).filter((o) => o.id !== p.id && !this.areAllied(p.id, o.id) && !this.allyOf(o.id));
      if (others.length) {
        const t = others[Math.floor(Math.random() * others.length)];
        this.requestPact(p, t);
        p.socialCd = now + 90000;
      }
    }
    // answer any request addressed to this AI once its delay elapsed
    if (this.pendingPacts && this.pendingPacts.size) {
      for (const [key, rec] of Array.from(this.pendingPacts.entries())) {
        if (rec.to !== p.id || rec.decided) continue;
        const from = this.players.get(rec.from);
        if (!from) { this.pendingPacts.delete(key); continue; }
        if (now < (rec.decideAt || 0)) continue;
        rec.decided = true;
        // AI accepts when it is not overcrowded and the partner is not clearly winning
        const myW = mine.length, theirW = this.countPlanetsOf(from.id);
        const accept = (theirW <= myW + 2) && Math.random() < 0.6;
        this.decidePact(from, p, accept);
      }
    }
  }

  /* ---------- intents ---------- */

  reject(ws, reason) { ws.send({ t: 'reject', reason }); }

  intentLaunch(ws, p, msg) {
    const src = this.planets.get(Number(msg.src));
    if (!src || src.owner !== p.id) return this.reject(ws, '该星球不属于你');
    const target = this.planets.get(Number(msg.target));
    if (!target) return this.reject(ws, '目标星球不存在');
    if (target.owner !== p.id && this.isShielded(target)) {
      return this.reject(ws, '『' + planetName(target) + '』的指挥官处于保护期，无法派遣舰队');
    }
    // Stage2 B4: support a proportional send (msg.pct) while keeping the legacy absolute count (msg.n)
    let n;
    if (msg.pct != null) {
      const rawPct = Number(msg.pct);
      if (!Number.isFinite(rawPct)) return this.reject(ws, '比例无效');
      const pct = clamp(rawPct, 0, 1);
      n = Math.max(1, Math.round(src.troops * pct));
    } else {
      n = Math.floor(Number(msg.n));
    }
    if (!Number.isFinite(n) || n < 1 || n > Math.floor(src.troops)) return this.reject(ws, '驻军不足');
    if (p.resource < ACTION_COST) return this.reject(ws, '资源不足');
    p.resource -= ACTION_COST; // Stage2 Task D: every dispatch costs 1 resource
    src.troops -= n;
    const fleet = this.spawnFleet(p, { x: src.x, y: src.y, n, kind: 'march', targetPlanet: target.id, srcPlanet: src.id });
    ws.send({ t: 'ack', op: 'launch', fleet: fleet.id, n });
    this.logEvent(p.name + ' launched ' + n + ' ships -> ' + planetName(target));
  }

  /* ---------- Stage2 B4: 18s joint launch ---------- */
  sendToPlayer(pl, obj) {
    if (pl && pl.conn && !pl.conn.closed) { try { pl.conn.send(obj); } catch (e) {} }
  }

  broadcastJointState(j) {
    const msg = { t: 'ev', k: 'joint-state', id: j.id, accepted: Array.from(j.accepted), declined: Array.from(j.declined), deadline: j.deadline };
    this.sendToPlayer(this.players.get(j.initiator), msg);
    for (const a of j.allocations) this.sendToPlayer(this.players.get(a.owner), msg);
  }

  cancelJoint(j, reason) {
    if (!j || j.done) return;
    j.done = true;
    this.joints.delete(j.id);
    this.broadcast({ t: 'ev', k: 'joint-cancelled', id: j.id, src: j.src, target: j.target, reason: reason || '' });
    this.logEvent('joint strike #' + j.id + ' cancelled' + (reason ? ': ' + reason : ''));
  }

  intentJointLaunch(ws, p, msg) {
    const src = this.planets.get(Number(msg.src));
    if (!src || src.owner !== p.id) return this.reject(ws, '该星球不属于你');
    const target = this.planets.get(Number(msg.target));
    if (!target) return this.reject(ws, '目标星球不存在');
    if (target.owner !== p.id && this.isShielded(target)) {
      return this.reject(ws, '『' + planetName(target) + '』的指挥官处于保护期，无法派遣舰队');
    }
    const rawPct = msg.pct == null ? 1 : Number(msg.pct);
    if (!Number.isFinite(rawPct)) return this.reject(ws, '比例无效');
    const pct = clamp(rawPct, 0, 1);
    // collect valid requested allies; they must still vote before any of their ships move
    const allocations = [];
    const seen = new Set();
    const rawAllies = Array.isArray(msg.allies) ? msg.allies : [];
    for (const it of rawAllies) {
      if (!it || typeof it !== 'object') continue;
      const owner = Number(it.owner);
      if (!Number.isFinite(owner) || owner === p.id || seen.has(owner)) continue;
      if (!this.players.has(owner)) continue;
      const raw = it.pct == null ? 1 : Number(it.pct);
      if (!Number.isFinite(raw)) continue;
      const ap = clamp(raw, 0, 1);
      if (ap <= 0) continue;
      seen.add(owner);
      allocations.push({ owner, pct: ap });
    }
    // no real allies -> behaves exactly like a normal launch
    if (allocations.length === 0) return this.intentLaunch(ws, p, { src: src.id, target: target.id, pct });
    // de-dup: only one live joint per (initiator, src, target)
    for (const j of this.joints.values()) {
      if (!j.done && j.initiator === p.id && j.src === src.id && j.target === target.id) {
        return this.reject(ws, '同一目标的联合出兵尚未结束');
      }
    }
    const id = this.nextJoint++;
    const j = {
      id, initiator: p.id, src: src.id, target: target.id, pct, allocations,
      accepted: new Set([p.id]), declined: new Set(), deadline: Date.now() + 18000, done: false
    };
    this.joints.set(id, j);
    for (const a of allocations) {
      this.sendToPlayer(this.players.get(a.owner), {
        t: 'ev', k: 'joint-request', id, from: p.id, fromName: p.name,
        src: src.id, srcName: planetName(src), target: target.id, targetName: planetName(target),
        pct, allyPct: a.pct, deadline: j.deadline
      });
    }
    ws.send({ t: 'ev', k: 'joint-state', id, accepted: Array.from(j.accepted), declined: [], deadline: j.deadline });
    this.logEvent(p.name + ' called joint strike #' + id + ' on ' + planetName(target) + ' with ' + allocations.length + ' allies');
  }

  intentJointVote(ws, p, msg) {
    const j = this.joints.get(Number(msg.id));
    if (!j || j.done) return this.reject(ws, '联合出兵事件不存在或已结束');
    if (!j.allocations.some((a) => a.owner === p.id)) return this.reject(ws, '你不是被邀请的盟友');
    if (msg.accept === true) { j.accepted.add(p.id); j.declined.delete(p.id); }
    else { j.declined.add(p.id); j.accepted.delete(p.id); }
    this.broadcastJointState(j);
    this.logEvent(p.name + (msg.accept === true ? ' accepted' : ' declined') + ' joint strike #' + j.id);
    const allVoted = j.allocations.every((a) => j.accepted.has(a.owner) || j.declined.has(a.owner));
    if (allVoted) this.execJoint(j);
  }

  intentJointGo(ws, p, msg) {
    const j = this.joints.get(Number(msg.id));
    if (!j || j.done) return this.reject(ws, '联合出兵事件不存在或已结束');
    if (j.initiator !== p.id) return this.reject(ws, '只有发起者可以立即出动');
    this.execJoint(j);
  }

  execJoint(j) {
    if (!j || j.done) return;
    const target = this.planets.get(j.target);
    const src = this.planets.get(j.src);
    if (!target || !src) return this.cancelJoint(j, '目标或源星已失效');
    if (src.owner !== j.initiator) return this.cancelJoint(j, '源星已易主');
    const initiator = this.players.get(j.initiator);
    if (!initiator) return this.cancelJoint(j, '发起者已离场');
    j.done = true;
    const fromSet = new Set([j.initiator]);
    for (const a of j.allocations) if (j.accepted.has(a.owner) && this.players.has(a.owner)) fromSet.add(a.owner);
    // 1) initiator's own share from the source world's garrison
    const avail = Math.floor(src.troops);
    if (avail >= 1 && initiator.resource >= ACTION_COST) {
      initiator.resource -= ACTION_COST; // Stage2 Task D: one action cost per participating owner
      let n = Math.max(1, Math.round(src.troops * clamp(Number(j.pct) || 0, 0, 1)));
      if (n > avail) n = avail;
      src.troops -= n;
      this.spawnFleet(initiator, { x: src.x, y: src.y, n, kind: 'march', targetPlanet: target.id, srcPlanet: src.id });
      this.logEvent(initiator.name + ' joint-launched ' + n + ' ships -> ' + planetName(target));
    }
    // 2) each accepted ally sends pct of its fleets already orbiting the source world
    for (const a of j.allocations) {
      if (!j.accepted.has(a.owner)) continue; // un-voted / declined -> no ships
      const ally = this.players.get(a.owner);
      if (!ally) continue;
      const pct = clamp(Number(a.pct) || 0, 0, 1);
      if (pct <= 0) continue;
      // collect the fleets that would actually launch; a participant with no ships is never charged
      const senders = [];
      for (const f of Array.from(this.fleets.values())) {
        if (f.orbiting !== src.id || f.owner !== a.owner || !(f.n >= 1)) continue;
        if (Math.round(f.n * pct) < 1) continue;
        senders.push(f);
      }
      if (!senders.length) continue;
      if (ally.resource < ACTION_COST) continue; // cannot pay the action cost -> this owner sits out
      ally.resource -= ACTION_COST; // Stage2 Task D: one action cost per participating owner
      for (const f of senders) {
        const take = Math.round(f.n * pct);
        if (take < 1) continue;
        if (take >= Math.floor(f.n)) {
          // repurpose the whole fleet into a march toward the target
          f.kind = 'march'; f.orbiting = 0; f.outpost = 0; f.ally = 0; f.node = 0; f.returning = false;
          f.fullyDocked = false; f.dockAt = 0; f.charge = 0;
          f.targetPlanet = target.id; f.targetOwner = target.owner; f.tx = target.x; f.ty = target.y;
          f.startX = f.x; f.startY = f.y; f.prevX = f.x; f.prevY = f.y;
        } else {
          f.n -= take;
          this.spawnFleet(ally, { x: f.x, y: f.y, n: take, kind: 'march', targetPlanet: target.id, srcPlanet: src.id });
        }
        fromSet.add(a.owner);
      }
    }
    // 3) announce and retire the joint
    this.joints.delete(j.id);
    this.broadcast({ t: 'ev', k: 'joint-launched', id: j.id, src: j.src, target: j.target, from: Array.from(fromSet) });
    this.logEvent('joint strike #' + j.id + ' launched on ' + planetName(target) + ' by [' + Array.from(fromSet).join(',') + ']');
  }

  simulateJoints(now) {
    if (!this.joints || !this.joints.size) return;
    for (const j of Array.from(this.joints.values())) {
      if (!j || j.done) { if (j) this.joints.delete(j.id); continue; }
      if (!this.planets.has(j.target)) { this.cancelJoint(j, '目标星球已失效'); continue; }
      const src = this.planets.get(j.src);
      if (!src || src.owner !== j.initiator || !this.players.has(j.initiator)) { this.cancelJoint(j, '源星已易主'); continue; }
      if (now >= j.deadline) this.execJoint(j); // timeout: un-voted allies count as declined
    }
  }

  isShielded(planet) {
    const owner = this.players.get(planet.owner);
    return !!(owner && owner.shieldUntil && owner.shieldUntil > Date.now());
  }

  intentGather(ws, p, msg) {
    const node = this.nodes.find((x) => x.id === Number(msg.node));
    if (!node) return this.reject(ws, '资源点不存在');
    const dup = Array.from(this.fleets.values()).some((f) => f.owner === p.id && f.kind === 'gather' && f.node === node.id);
    if (dup) return this.reject(ws, '已有己方飞船正在前往或采集该资源点');
    // choose the closest own world with ships; the client does not need to have one selected
    let src = null, best = Infinity;
    for (const pl of this.planets.values()) {
      if (pl.owner !== p.id || pl.troops < 1) continue;
      const d = dist2(pl.x, pl.y, node.x, node.y);
      if (d < best) { best = d; src = pl; }
    }
    if (!src) return this.reject(ws, '你没有可派出采集舰队的星球');
    if (p.resource < ACTION_COST) return this.reject(ws, '资源不足');
    p.resource -= ACTION_COST; // Stage2 Task D: gather dispatch costs 1 resource
    const n = Math.max(1, Math.min(3, Math.floor(src.troops)));
    src.troops -= n;
    const fleet = this.spawnFleet(p, { x: src.x, y: src.y, n, kind: 'gather', node: node.id, srcPlanet: src.id });
    ws.send({ t: 'ack', op: 'gather', fleet: fleet.id, n });
  }

  intentRetarget(ws, p, msg) {
    const f = this.fleets.get(Number(msg.fleet));
    const target = this.planets.get(Number(msg.target));
    if (!f || f.owner !== p.id) return this.reject(ws, '不是你的舰队');
    if (!target) return this.reject(ws, '目标不存在');
    if (this.isShielded(target)) return this.reject(ws, '该阵营处于保护期');
    const nd = this.nodes.find((n) => n.readingFleetId === f.id);
    if (nd) nd.readingFleetId = null;
    f.kind = 'march';
    f.orbiting = 0;
    f.targetPlanet = target.id;
    f.tx = target.x; f.ty = target.y;
    ws.send({ t: 'ack', op: 'retarget', fleet: f.id, target: target.id });
  }

  intentMerge(ws, p, msg) {
    const a = this.planets.get(Number(msg.a)), b = this.planets.get(Number(msg.b));
    if (!a || !b || a === b) return this.reject(ws, '星球无效');
    if (a.owner !== p.id || b.owner !== p.id) return this.reject(ws, '只能合并自己的星球');
    const n = Math.floor(a.troops);
    if (n < 1) return this.reject(ws, '该星球没有驻军');
    a.troops = 0;
    b.troops = Math.min(b.cap, b.troops + n);
    ws.send({ t: 'ack', op: 'merge', n });
  }

  intentSplit(ws, p, msg) {
    const a = this.planets.get(Number(msg.a)), b = this.planets.get(Number(msg.b));
    if (!a || !b || a === b) return this.reject(ws, '星球无效');
    if (a.owner !== p.id || b.owner !== p.id) return this.reject(ws, '只能在自己的星球之间调度');
    const n = Math.floor(Number(msg.n));
    if (!Number.isFinite(n) || n < 1 || n > Math.floor(a.troops)) return this.reject(ws, '数量无效');
    a.troops -= n;
    b.troops = Math.min(b.cap, b.troops + n);
    ws.send({ t: 'ack', op: 'split', n });
  }

  intentRename(ws, p, msg) {
    const pl = this.planets.get(Number(msg.id));
    if (!pl || pl.owner !== p.id) return this.reject(ws, '不是你的星球');
    const name = sanitizeName(msg.name);
    if (name) pl.customName = name;
    ws.send({ t: 'ack', op: 'rename' });
  }

  intentReinforce(ws, p, msg) {
    const pl = this.planets.get(Number(msg.id));
    if (!pl || pl.owner !== p.id) return this.reject(ws, '不是你的星球');
    pl.reinforce = msg.on === true;
    ws.send({ t: 'ack', op: 'reinforce', on: pl.reinforce });
  }

  intentBuildOutpost(ws, p, msg) {
    const level = clamp(Number(msg.level) || 1, 1, 3);
    const spec = OUTPOST_LEVELS[level - 1];
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return this.reject(ws, '坐标无效');
    if (x < 120 || y < 120 || x > WORLD.w - 120 || y > WORLD.h - 120) return this.reject(ws, '超出星域边界');
    if (p.resource < spec.cost) return this.reject(ws, '资源不足（需要 ' + spec.cost + '）');
    for (const pl of this.planets.values()) {
      if (dist2(x, y, pl.x, pl.y) < (pl.radius + spec.radius + 60) ** 2) return this.reject(ws, pl.isOutpost ? '离已有停泊点太近' : '离星球太近');
    }
    for (const n of this.nodes) {
      if (dist2(x, y, n.x, n.y) < (spec.radius + 80) ** 2) return this.reject(ws, '离资源点太近');
    }
    p.resource -= spec.cost;
    const id = this.nextPlanet++;
    const op = {
      id, size: 'O', shape: 'hex', isOutpost: true, level, radius: spec.radius, cap: spec.cap,
      x, y, hue: 200, owner: p.id, color: this.displayColorOf(p.id), troops: 0,
      resource: 0, maxResource: 0, reinforce: false, exhausted: false,
      destroyTimer: 0, destroyBy: 0, invulnUntil: 0, customName: '',
      purityProg: 1, captureBy: 0, captureProg: 0, orbitBy: {}, orbitTotal: 0
    };
    this.planets.set(id, op);
    this.broadcast({ t: 'ev', k: 'outpost-built', outpost: this.viewOutposts().find((o) => o.id === id), by: p.id, cost: spec.cost });
    ws.send({ t: 'ack', op: 'outpost', id });
  }  intentLaunchOutpost(ws, p, msg) {
    // outposts are planets now: normalise to a standard launch
    return this.intentLaunch(ws, p, { src: msg.src, target: msg.targetOutpost, n: msg.n });
  }




  // 己方仅剩一颗星球（没有第二个落脚点）时禁止摧毁
  hasOtherLandingSpot(p, exceptId) {
    for (const q of this.planets.values()) {
      if (q.id === exceptId) continue;
      if (q.owner === p.id) return true;
    }
    return false;
  }

  intentDestroy(ws, p, msg) {
    const pl = this.planets.get(Number(msg.id));
    if (!pl || pl.owner !== p.id) return this.reject(ws, '不是你的星球');
    if (!this.hasOtherLandingSpot(p, pl.id)) return this.reject(ws, '这是你仅剩的星球，无法摧毁');
    if (pl.troops < DESTROY_MIN) return this.reject(ws, '需要至少 ' + DESTROY_MIN + ' 艘飞船才能执行');
    if (pl.destroyTimer > 0) return this.reject(ws, '已在读条');
    pl.destroyTimer = DESTROY_TIME;
    pl.destroyBy = p.id;
    ws.send({ t: 'ack', op: 'destroy', id: pl.id, time: DESTROY_TIME });
    this.broadcast({ t: 'ev', k: 'planet-destroying', planet: pl.id, by: p.id, name: planetName(pl) });
    this.logEvent(p.name + ' started destruction of ' + planetName(pl));
  }

  intentAlly(ws, p, msg) {
    if (this.mode === 'elim') return this.reject(ws, '淘汰模式为个人死斗，禁止结盟');
    const target = this.players.get(Number(msg.id));
    if (!target || target.id === p.id) return this.reject(ws, '目标无效');
    if (this.areAllied(p.id, target.id)) return this.reject(ws, '已经结盟');
    if (this.allyOf(p.id)) return this.reject(ws, '你已有盟约，请先解除');
    if (this.allyOf(target.id)) return this.reject(ws, target.name + ' 已有盟约');
    if (p.resource < ALLY_COST) return this.reject(ws, '资源不足（需要 ' + ALLY_COST + '）');
    if (!target.conn && !target.bot) return this.reject(ws, target.name + ' 不在线');
    // a request only: nothing is agreed until the other side answers (human popup or AI decision)
    this.requestPact(p, target);
    ws.send({ t: 'ack', op: 'allyRequested', target: target.id });
  }

  intentRespondPact(ws, p, msg) {
    this.pendingPacts = this.pendingPacts || new Map();
    const requester = this.players.get(Number(msg.from));
    if (!requester) return this.reject(ws, '请求方已离线');
    const key = requester.id + ':' + p.id;
    if (!this.pendingPacts.has(key)) return this.reject(ws, '没有待处理的请求');
    const rec = this.pendingPacts.get(key);
    this.pendingPacts.delete(key);
    if (msg.accept !== true) {
      this.broadcast({ t: 'ev', k: 'pact-declined', a: requester.id, b: p.id });
      this.broadcastChat({ id: 0, name: '航管中心', text: p.name + ' 拒绝了 ' + requester.name + ' 的结盟请求', sys: true });
      return;
    }
    if (!(rec && rec.prepaid)) {
      if (requester.resource < ALLY_COST) return this.reject(ws, '对方资源不足');
      requester.resource -= ALLY_COST;
    }
    // consent given: the pact takes effect immediately (no social-fleet detour)
    this.formPact(requester, p);
    ws.send({ t: 'ack', op: 'pactAccepted' });
  }

  intentBreak(ws, p, msg) {
    const other = this.players.get(this.allyOf(p.id) || Number(msg.id));
    if (!other || other.id === p.id) return this.reject(ws, '没有可解除的盟约');
    if (!this.areAllied(p.id, other.id)) return this.reject(ws, '你们并没有结盟');
    this.breakPact(p, other);
    ws.send({ t: 'ack', op: 'break' });
  }

  /* ---------- Stage2 Task C: trade / transfer ---------- */
  nearestOwnPlanet(playerId, x, y) {
    let best = null, bd = Infinity;
    for (const pl of this.planets.values()) {
      if (pl.owner !== playerId || pl.isOutpost) continue;
      const d = dist2(x, y, pl.x, pl.y);
      if (d < bd) { bd = d; best = pl; }
    }
    return best;
  }

  sendFleetHome(f, playerId) {
    if (!this.fleets.has(f.id)) return;
    const owner = this.players.get(playerId);
    if (!owner) { this.fleets.delete(f.id); return; }
    const home = this.nearestOwnPlanet(playerId, f.x, f.y) || this.homeOf(playerId);
    if (!home) { this.fleets.delete(f.id); return; }
    f.orbiting = 0; f.kind = 'march'; f.returning = true;
    f.targetPlanet = home.id; f.targetOwner = home.owner;
    f.tx = home.x; f.ty = home.y; f.startX = f.x; f.startY = f.y;
    this.broadcast({ t: 'ev', k: 'fleet-return', owner: f.owner, fleet: f.id });
  }

  setPlanetOwner(pl, ownerId) {
    pl.owner = ownerId;
    pl.color = this.displayColorOf(ownerId);
    pl.purityProg = 1; pl.captureProg = 0; pl.captureBy = 0;
    pl.destroyTimer = 0; pl.destroyBy = 0; pl.invulnUntil = 0;
    pl.exhausted = pl.resource <= 0;
    pl.reinforce = !pl.isOutpost;
    this.repairOwners();
  }

  broadcastTradeResult(payload) { this.broadcast(Object.assign({ t: 'ev', k: 'trade-result' }, payload)); }

  intentTrade(ws, p, msg) {
    const pl = this.planets.get(Number(msg.planet));
    if (!pl) return this.reject(ws, '星球不存在');
    if (!pl.owner || pl.owner === p.id) return this.reject(ws, '只能交易他方有主星球');
    const seller = this.players.get(pl.owner);
    if (!seller) return this.reject(ws, '卖方已离线');
    if (this.countPlanetsOf(pl.owner) <= 1) return this.reject(ws, '对方仅剩最后一颗星球，无法交易');
    if (pl.destroyTimer > 0) return this.reject(ws, '该星球正在拆除读条中，无法交易');
    let offer = Number(msg.offerResource);
    if (!Number.isFinite(offer) || offer < 0) offer = 0;
    offer = Math.floor(offer);
    const cost = TRADE_FEE + offer;
    if (p.resource < cost) return this.reject(ws, '资源不足（需要 ' + cost + '）');
    p.resource -= cost;
    const id = this.nextTrade++;
    const rec = { id, kind: 'trade', from: p.id, to: pl.owner, planet: pl.id, offerResource: offer, expireAt: Date.now() + REQUEST_TTL };
    this.trades.set(id, rec);
    this.sendToPlayer(seller, { t: 'ev', k: 'trade-request', id, kind: 'trade', from: p.id, fromName: p.name, planet: pl.id, planetName: planetName(pl), offerResource: offer, expireAt: rec.expireAt });
    ws.send({ t: 'ack', op: 'trade', id });
    this.logEvent(p.name + ' offered ' + offer + ' res for ' + planetName(pl) + ' trade #' + id);
  }

  intentTransfer(ws, p, msg) {
    const pl = this.planets.get(Number(msg.planet));
    if (!pl || pl.owner !== p.id) return this.reject(ws, '只能转让自己的星球');
    if (this.countPlanetsOf(p.id) <= 1) return this.reject(ws, '你不能转让最后一颗星球');
    if (pl.destroyTimer > 0) return this.reject(ws, '该星球正在拆除读条中，无法转让');
    const to = this.players.get(Number(msg.to));
    if (!to || to.id === p.id) return this.reject(ws, '接收方无效');
    if (p.resource < TRADE_FEE) return this.reject(ws, '资源不足（需要 ' + TRADE_FEE + '）');
    p.resource -= TRADE_FEE;
    const withTroops = !!msg.withTroops;
    let want = Number(msg.wantResource);
    if (!Number.isFinite(want) || want < 0) want = 0;
    want = Math.floor(want);
    const id = this.nextTrade++;
    const rec = { id, kind: 'transfer', from: p.id, to: to.id, planet: pl.id, withTroops, wantResource: want, expireAt: Date.now() + REQUEST_TTL };
    this.trades.set(id, rec);
    this.sendToPlayer(to, { t: 'ev', k: 'trade-request', id, kind: 'transfer', from: p.id, fromName: p.name, planet: pl.id, planetName: planetName(pl), withTroops, wantResource: want, expireAt: rec.expireAt });
    ws.send({ t: 'ack', op: 'transfer', id });
    this.logEvent(p.name + ' offered to transfer ' + planetName(pl) + ' to ' + to.name + ' #' + id);
  }

  tradePlanetLost(rec) {
    this.trades.delete(rec.id);
    if (rec.kind === 'trade') {
      const from = this.players.get(rec.from);
      if (from) from.resource += Math.floor(rec.offerResource * (1 - TRADE_PENALTY));
    }
    this.broadcastTradeResult({ id: rec.id, kind: rec.kind, ok: false, reason: 'planet-lost', from: rec.from, to: rec.to, planet: rec.planet });
    this.logEvent('trade #' + rec.id + ' voided: planet lost');
  }

  tradeExpired(rec) {
    this.trades.delete(rec.id);
    if (rec.kind === 'trade') {
      const from = this.players.get(rec.from);
      if (from) from.resource += rec.offerResource; // fee not refunded
    }
    this.broadcastTradeResult({ id: rec.id, kind: rec.kind, ok: false, reason: 'expired', from: rec.from, to: rec.to, planet: rec.planet });
  }

  intentTradeRespond(ws, p, msg) {
    const rec = this.trades.get(Number(msg.id));
    if (!rec) return this.reject(ws, '交易请求不存在或已结束');
    if (rec.to !== p.id) return this.reject(ws, '无权回应此交易');
    const pl = this.planets.get(rec.planet);
    // trade: rec.to is the seller, so the world must still belong to the seller
    // transfer: rec.from is the initiator, so the world must still belong to the initiator
    const expectedOwner = rec.kind === 'trade' ? rec.to : rec.from;
    if (!pl || pl.owner !== expectedOwner) { this.tradePlanetLost(rec); return; }
    const initiator = this.players.get(rec.from); // trade buyer / transfer giver
    const counterparty = this.players.get(rec.to); // trade seller / transfer receiver
    if (!initiator || !counterparty) { this.trades.delete(rec.id); return this.reject(ws, '对方已离线'); }
    this.trades.delete(rec.id);
    if (msg.accept !== true) {
      if (rec.kind === 'trade') initiator.resource += rec.offerResource; // fee not refunded
      this.broadcastTradeResult({ id: rec.id, kind: rec.kind, ok: false, reason: 'declined', from: rec.from, to: rec.to, planet: rec.planet });
      this.logEvent('trade #' + rec.id + ' declined by ' + p.name);
      return;
    }
    if (rec.kind === 'trade') {
      // seller's orbiting ships on the sold world return home
      for (const f of Array.from(this.fleets.values())) {
        if (f.owner === rec.to && f.orbiting === pl.id) this.sendFleetHome(f, rec.to);
      }
      this.setPlanetOwner(pl, rec.from);
      counterparty.resource += Math.floor(rec.offerResource * (1 - TRADE_TAX));
      this.broadcastTradeResult({ id: rec.id, kind: 'trade', ok: true, from: rec.from, to: rec.to, planet: rec.planet, price: rec.offerResource, tax: Math.floor(rec.offerResource * TRADE_TAX) });
      this.logEvent(counterparty.name + ' sold ' + planetName(pl) + ' to ' + initiator.name + ' for ' + rec.offerResource + ' res');
    } else {
      if (!rec.withTroops) {
        const n = Math.floor(pl.troops);
        pl.troops = 0;
        if (n >= 1) {
          const home = this.nearestOwnPlanet(rec.from, pl.x, pl.y) || this.homeOf(rec.from);
          const f = this.spawnFleet(initiator, { x: pl.x, y: pl.y, n, kind: 'march', targetPlanet: home ? home.id : 0, srcPlanet: pl.id });
          f.returning = true;
        }
      }
      this.setPlanetOwner(pl, rec.to);
      if (rec.wantResource > 0 && counterparty.resource >= rec.wantResource) {
        counterparty.resource -= rec.wantResource;
        initiator.resource += rec.wantResource;
      }
      this.broadcastTradeResult({ id: rec.id, kind: 'transfer', ok: true, from: rec.from, to: rec.to, planet: rec.planet, withTroops: rec.withTroops, wantResource: rec.wantResource });
      this.logEvent(initiator.name + ' transferred ' + planetName(pl) + ' to ' + counterparty.name);
    }
  }

  simulateTrades(now) {
    if (!this.trades || !this.trades.size) return;
    for (const rec of Array.from(this.trades.values())) {
      const pl = this.planets.get(rec.planet);
      const expectedOwner = rec.kind === 'trade' ? rec.to : rec.from;
      if (!pl || pl.owner !== expectedOwner) { this.tradePlanetLost(rec); continue; }
      if (now >= rec.expireAt) { this.tradeExpired(rec); }
    }
  }

  /* ---------- Stage2 Task C: 七态外交 & 联盟投票 ---------- */
  coalitionMembers(cid) {
    const c = this.coalitions.get(cid);
    return c ? Array.from(c.members) : [];
  }

  broadcastToCoalition(cid, obj) {
    const c = this.coalitions.get(cid);
    if (!c) return;
    for (const m of c.members) this.sendToPlayer(this.players.get(m), obj);
  }

  addToCoalition(player, cid) {
    const c = this.coalitions.get(cid);
    if (!c || !player) return false;
    c.members.add(player.id);
    player.coalition = cid;
    return true;
  }

  returnStationedFleets(members, departedId) {
    const set = new Set(members);
    for (const f of Array.from(this.fleets.values())) {
      if (!f.orbiting) continue;
      const host = this.planets.get(f.orbiting);
      if (!host || !host.owner) continue;
      const between = (f.owner === departedId && set.has(host.owner)) ||
                      (set.has(f.owner) && host.owner === departedId);
      if (!between) continue;
      this.sendFleetHome(f, f.owner);
    }
  }

  removeFromCoalition(player) {
    const cid = player.coalition;
    if (!cid) return;
    const c = this.coalitions.get(cid);
    const oldMembers = c ? Array.from(c.members) : [];
    if (c) c.members.delete(player.id);
    player.coalition = 0;
    if (c) for (const m of Array.from(c.members)) { const k = this.pactKey(player.id, m); if (this.pacts.has(k)) this.pacts.delete(k); }
    this.returnStationedFleets(oldMembers, player.id);
    if (c && c.members.size <= 1) {
      for (const m of c.members) { const mp = this.players.get(m); if (mp) mp.coalition = 0; }
      this.coalitions.delete(cid);
    }
    for (const pl of this.planets.values()) if (pl.owner) pl.color = this.displayColorOf(pl.owner);
  }

  newVote(kind, cid, from, targetPlayer, targetPlanet) {
    const id = this.nextVote++;
    const tpId = targetPlayer && typeof targetPlayer === 'object' ? targetPlayer.id : (Number(targetPlayer) || 0);
    const tplId = targetPlanet && typeof targetPlanet === 'object' ? targetPlanet.id : (Number(targetPlanet) || 0);
    const rec = {
      id, kind, coalition: cid, from: from.id, targetPlayer: tpId, targetPlanet: tplId,
      yes: new Set([from.id]), no: new Set(), voted: new Set([from.id]),
      members: new Set(this.coalitionMembers(cid)), expireAt: Date.now() + REQUEST_TTL,
      awaiting: false, stage: 'open'
    };
    this.votes.set(id, rec);
    return rec;
  }

  broadcastVoteRequest(rec) {
    const from = this.players.get(rec.from);
    const tp = this.players.get(rec.targetPlayer);
    const tpl = this.planets.get(rec.targetPlanet);
    const msg = { t: 'ev', k: 'vote-request', id: rec.id, kind: rec.kind, coalition: rec.coalition, from: rec.from, fromName: from ? from.name : '', targetPlayer: rec.targetPlayer, targetName: tp ? tp.name : '', targetPlanet: rec.targetPlanet, targetPlanetName: tpl ? planetName(tpl) : '', members: Array.from(rec.members), expireAt: rec.expireAt };
    this.broadcastToCoalition(rec.coalition, msg);
    if (from && !rec.members.has(from.id)) this.sendToPlayer(from, msg);
  }

  broadcastVoteState(rec, status) {
    const msg = { t: 'ev', k: 'vote-state', id: rec.id, kind: rec.kind, coalition: rec.coalition, status: status || rec.stage, yes: Array.from(rec.yes), no: Array.from(rec.no), members: Array.from(rec.members), yesCount: rec.yes.size, memberCount: rec.members.size, expireAt: rec.expireAt };
    this.broadcastToCoalition(rec.coalition, msg);
    const from = this.players.get(rec.from);
    if (from && !rec.members.has(from.id)) this.sendToPlayer(from, msg);
  }

  votePassed(rec) { return rec.members.size > 0 && (rec.yes.size / rec.members.size) >= 0.5; }

  applyVote(rec) {
    if (!rec || rec.stage !== 'open') return;
    const passed = this.votePassed(rec);
    rec.stage = passed ? 'passed' : 'failed';
    this.broadcastVoteState(rec, rec.stage);
    if (!passed) {
      this.votes.delete(rec.id);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: false, reason: 'vote-failed', kind: rec.kind, id: rec.id, from: rec.from, targetPlayer: rec.targetPlayer });
      this.logEvent('vote #' + rec.id + ' (' + rec.kind + ') failed');
      return;
    }
    const from = this.players.get(rec.from);
    const target = this.players.get(rec.targetPlayer);
    if (rec.kind === 'join') {
      if (from && this.coalitions.has(rec.coalition)) this.addToCoalition(from, rec.coalition);
      this.votes.delete(rec.id);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: true, kind: 'join', id: rec.id, from: rec.from, coalition: rec.coalition });
      this.logEvent((from ? from.name : '?') + ' joined coalition ' + rec.coalition);
      return;
    }
    if (rec.kind === 'expel') {
      if (target && target.coalition === rec.coalition) this.removeFromCoalition(target);
      this.votes.delete(rec.id);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: true, kind: 'expel', id: rec.id, from: rec.from, targetPlayer: rec.targetPlayer, coalition: rec.coalition });
      this.logEvent((target ? target.name : '?') + ' expelled from coalition ' + rec.coalition);
      return;
    }
    if (rec.kind === 'invite' || rec.kind === 'incite') {
      rec.awaiting = true;
      rec.expireAt = Date.now() + REQUEST_TTL;
      this.broadcastVoteState(rec, 'awaiting');
      if (target) this.sendToPlayer(target, { t: 'ev', k: 'diplo-request', id: rec.id, kind: rec.kind, from: rec.from, fromName: from ? from.name : '', coalition: rec.coalition, targetPlayer: rec.targetPlayer, expireAt: rec.expireAt });
      this.logEvent('vote #' + rec.id + ' (' + rec.kind + ') passed; awaiting target consent');
    }
  }

  intentDiplo(ws, p, msg) {
    const action = String(msg.action || '');
    const target = this.players.get(Number(msg.targetPlayer));
    const tpl = this.planets.get(Number(msg.targetPlanet));
    const costOf = { ally: ALLY_COST, join: ALLY_COST, invite: ALLY_COST, expel: ALLY_COST, incite: INCITE_COST, break: 0, mark: 0 };
    if (!(action in costOf)) return this.reject(ws, '未知外交操作');
    if (this.mode === 'elim' && (action === 'ally' || action === 'join' || action === 'invite' || action === 'incite')) {
      return this.reject(ws, '淘汰模式为个人死斗，禁止结盟');
    }
    const cost = costOf[action];
    if (p.resource < cost) return this.reject(ws, '资源不足（需要 ' + cost + '）');

    if (action === 'ally') {
      if (!target || target.id === p.id) return this.reject(ws, '目标玩家无效');
      if (this.areAllied(p.id, target.id)) return this.reject(ws, '已经结盟');
      if (p.coalition || target.coalition) return this.reject(ws, '结盟要求双方均无联盟');
      p.resource -= cost;
      this.requestPact(p, target, { prepaid: true });
      ws.send({ t: 'ack', op: 'diplo', action });
      return;
    }
    if (action === 'join') {
      if (!target || target.id === p.id) return this.reject(ws, '目标玩家无效');
      if (p.coalition) return this.reject(ws, '你已在联盟中');
      if (!target.coalition) return this.reject(ws, '对方没有联盟');
      p.resource -= cost;
      const rec = this.newVote('join', target.coalition, p, target, 0);
      this.broadcastVoteRequest(rec);
      ws.send({ t: 'ack', op: 'vote', id: rec.id });
      this.logEvent(p.name + ' started join vote #' + rec.id);
      return;
    }
    if (action === 'invite') {
      if (!target || target.id === p.id) return this.reject(ws, '目标玩家无效');
      if (!p.coalition) return this.reject(ws, '你尚未加入联盟');
      if (target.coalition) return this.reject(ws, '对方已在联盟中');
      p.resource -= cost;
      const rec = this.newVote('invite', p.coalition, p, target, 0);
      this.broadcastVoteRequest(rec);
      ws.send({ t: 'ack', op: 'vote', id: rec.id });
      this.logEvent(p.name + ' started invite vote #' + rec.id);
      return;
    }
    if (action === 'incite') {
      if (!target || target.id === p.id) return this.reject(ws, '目标玩家无效');
      if (!p.coalition) return this.reject(ws, '你尚未加入联盟');
      if (target.coalition === p.coalition) return this.reject(ws, '对方与你同属一个联盟');
      p.resource -= cost;
      const rec = this.newVote('incite', p.coalition, p, target, 0);
      this.broadcastVoteRequest(rec);
      ws.send({ t: 'ack', op: 'vote', id: rec.id });
      this.logEvent(p.name + ' started incite vote #' + rec.id);
      return;
    }
    if (action === 'expel') {
      if (!target || target.id === p.id) return this.reject(ws, '目标玩家无效');
      if (!p.coalition) return this.reject(ws, '你尚未加入联盟');
      const c = this.coalitions.get(p.coalition);
      if (!c || c.members.size < 3) return this.reject(ws, '联盟不足 3 人，无法发起驱逐');
      if (target.coalition !== p.coalition) return this.reject(ws, '对方不在你的联盟中');
      p.resource -= cost;
      const rec = this.newVote('expel', p.coalition, p, target, 0);
      this.broadcastVoteRequest(rec);
      ws.send({ t: 'ack', op: 'vote', id: rec.id });
      this.logEvent(p.name + ' started expel vote #' + rec.id);
      return;
    }
    if (action === 'break') {
      if (!p.coalition) return this.reject(ws, '你尚未加入联盟');
      const c = this.coalitions.get(p.coalition);
      if (!c) return this.reject(ws, '你尚未加入联盟');
      if (c.members.size > 2) return this.reject(ws, '多人联盟请使用驱逐投票');
      const other = (target && c.members.has(target.id)) ? target : this.players.get(Array.from(c.members).find((m) => m !== p.id));
      if (!other) return this.reject(ws, '找不到可解除的盟友');
      const ok = this.breakPact(p, other);
      if (!ok) this.removeFromCoalition(other);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: true, kind: 'break', id: 0, from: p.id, targetPlayer: other.id });
      ws.send({ t: 'ack', op: 'break' });
      return;
    }
    if (action === 'mark') {
      if (!p.coalition) return this.reject(ws, '你尚未加入联盟');
      if (!tpl) return this.reject(ws, '目标星球不存在');
      const markText = '【标记】' + planetName(tpl) + ' @ (' + Math.round(tpl.x) + ',' + Math.round(tpl.y) + ')';
      this.broadcastChatToCoalition({ channel: 'ally', sys: true, planet: tpl.id, text: markText }, p.coalition);
      this.maybeIntercept(markText, p, true); // Stage2 Task D: mark has a 20% intercept chance
      ws.send({ t: 'ack', op: 'diplo', action: 'mark' });
      return;
    }
  }

  intentVote(ws, p, msg) {
    const rec = this.votes.get(Number(msg.id));
    if (!rec || rec.stage !== 'open' || rec.awaiting) return this.reject(ws, '投票不存在或已结束');
    if (!rec.members.has(p.id)) return this.reject(ws, '你不是该联盟成员');
    if (msg.accept === true) { rec.yes.add(p.id); rec.no.delete(p.id); }
    else { rec.no.add(p.id); rec.yes.delete(p.id); }
    rec.voted.add(p.id);
    this.broadcastVoteState(rec, 'open');
    if (this.votePassed(rec)) return this.applyVote(rec);
    const allVoted = Array.from(rec.members).every((m) => rec.voted.has(m));
    if (allVoted) return this.applyVote(rec);
  }

  intentDiploRespond(ws, p, msg) {
    const rec = this.votes.get(Number(msg.id));
    if (!rec || !rec.awaiting) return this.reject(ws, '外交请求不存在或已结束');
    if (rec.targetPlayer !== p.id) return this.reject(ws, '只有被邀请者可以回应');
    const from = this.players.get(rec.from);
    rec.awaiting = false;
    this.votes.delete(rec.id);
    if (msg.accept !== true) {
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: false, reason: 'declined', kind: rec.kind, id: rec.id, from: rec.from, targetPlayer: p.id });
      this.logEvent(p.name + ' declined ' + rec.kind + ' #' + rec.id);
      return;
    }
    if (rec.kind === 'invite') {
      this.addToCoalition(p, rec.coalition);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: true, kind: 'invite', id: rec.id, from: rec.from, targetPlayer: p.id, coalition: rec.coalition });
      this.logEvent(p.name + ' accepted invite into coalition ' + rec.coalition);
    } else if (rec.kind === 'incite') {
      if (p.coalition && p.coalition !== rec.coalition) this.removeFromCoalition(p);
      this.addToCoalition(p, rec.coalition);
      this.broadcast({ t: 'ev', k: 'diplo-result', ok: true, kind: 'incite', id: rec.id, from: rec.from, targetPlayer: p.id, coalition: rec.coalition });
      this.logEvent(p.name + ' defected into coalition ' + rec.coalition);
    }
  }

  simulateVotes(now) {
    if (!this.votes || !this.votes.size) return;
    for (const rec of Array.from(this.votes.values())) {
      if (now < rec.expireAt) continue;
      if (rec.awaiting) {
        this.votes.delete(rec.id);
        this.broadcast({ t: 'ev', k: 'diplo-result', ok: false, reason: 'expired', kind: rec.kind, id: rec.id, from: rec.from, targetPlayer: rec.targetPlayer });
        continue;
      }
      rec.stage = 'open';
      this.applyVote(rec);
    }
  }

  canHost(p) { return this.mode === 'elim' && this.status === 'waiting' && !!p && p.id === this.hostId; }

  intentRoomAddAI(ws, p, msg) {
    if (!this.canHost(p)) return this.reject(ws, '仅候场房主可操作');
    if (this.players.size >= this.maxPlayers) return this.reject(ws, '房间已满');
    const used = new Set(Array.from(this.players.values()).map((x) => x.name));
    const name = AI_NAMES.find((x) => !used.has(x)) || ('AI-' + this.nextId);
    this.addAIPlayer(name);
    ws.send({ t: 'ack', op: 'roomAddAI' });
    this.broadcastState();
  }

  intentRoomRemoveAI(ws, p, msg) {
    if (!this.canHost(p)) return this.reject(ws, '仅候场房主可操作');
    const bots = Array.from(this.players.values()).filter((x) => x.bot);
    if (!bots.length) return this.reject(ws, '没有可移除的 AI');
    this.removePlayer(bots[bots.length - 1], false);
    ws.send({ t: 'ack', op: 'roomRemoveAI' });
    this.broadcastState();
  }

  intentRoomStart(ws, p, msg) {
    if (!this.canHost(p)) return this.reject(ws, '仅候场房主可开始对局');
    if (this.players.size < 2) return this.reject(ws, '至少需要 2 名参战者');
    this.status = 'running';
    this.startedAt = Date.now();
    if (!this.customDuration) this.durationMs = ELIM_DURATION_MS;
    this.noJoin = true;
    this.lobbyExpireAt = 0;
    this.broadcast({ t: 'ev', k: 'room-started', roomId: this.roomId });
    this.broadcastState();
    ws.send({ t: 'ack', op: 'roomStart' });
    this.logEvent('room ' + this.roomId + ' started');
  }

  statusInfo() {
    return {
      ok: true, name: '星海边境 · ORBITAL FRONTIER', version: '2.0.0',
      roomId: this.roomId, mode: this.mode, status: this.status, maxPlayers: this.maxPlayers, hostId: this.hostId, remainingMs: this.remainingMs(), mods: this.mods,
      players: Array.from(this.players.values()).map((p) => ({ id: p.id, name: p.name, bot: !!p.bot, online: !!p.conn, idleMs: p.disconnectedAt ? Date.now() - p.disconnectedAt : 0 })),
      humans: this.humanCount(), bots: Array.from(this.players.values()).filter((p) => p.bot).length,
      planets: this.planets.size, fleets: this.fleets.size, nodes: this.nodes.length, respawnSeconds: RESPAWN_SECONDS,
      pacts: this.pacts.size, tick: this.tick, log: this.log.slice(-30)
    };
  }
}

/* ---------------------------- RoomManager ---------------------------- */

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.seq = { norm: 0, elim: 0 };
  }

  createRoom(opts = {}) {
    opts = opts || {};
    const mode = opts.mode === 'elim' ? 'elim' : (opts.mode === 'endless' ? 'endless' : 'normal');
    const prefix = mode === 'elim' ? 'elim' : 'norm';
    let roomId = opts.roomId ? String(opts.roomId) : null;
    if (!roomId) {
      do { this.seq[prefix] = (this.seq[prefix] || 0) + 1; roomId = prefix + '-' + this.seq[prefix]; }
      while (this.rooms.has(roomId));
    }
    const name = opts.name || (mode === 'elim' ? ('淘汰房-' + roomId) : ('星域-' + roomId));
    const g = new Game({ roomId, mode, name, maxPlayers: opts.maxPlayers, hostId: opts.hostId, mods: opts.mods, modDetails: opts.modDetails, durationMs: opts.durationMs, lobbyExpireMs: opts.lobbyExpireMs });
    this.rooms.set(roomId, g);
    return g;
  }

  get(roomId) { return this.rooms.get(String(roomId)); }

  defaultNormalRoom() {
    for (const g of this.rooms.values()) {
      if (g.mode !== 'normal' || g.status !== 'running' || g.noJoin || g.settled) continue;
      let seats = 0;
      for (const p of g.players.values()) if (!p.bot) seats++;
      if (seats < g.maxPlayers) return g;
    }
    return this.createRoom({ mode: 'normal' });
  }

  findByToken(token) {
    if (!token) return null;
    for (const g of this.rooms.values()) for (const p of g.players.values()) if (!p.bot && p.token === token) return g;
    return null;
  }

  list() {
    const out = [];
    for (const g of this.rooms.values()) {
      if (g.status === 'settled' || g.settled) continue; // K3: hide finished rooms entirely
      let humans = 0, bots = 0;
      for (const p of g.players.values()) { if (p.bot) bots++; else humans++; }
      let canJoin = false;
      if (!(g.status === 'settled' || g.settled)) {
        if (g.mode === 'elim') canJoin = (g.status === 'waiting') || (g.status === 'running' && humans < g.maxPlayers && !g.noJoin);
        else canJoin = g.status === 'running' && !g.noJoin && humans < g.maxPlayers;
      }
      out.push({ roomId: g.roomId, mode: g.mode, name: g.name, status: g.status, humans, bots, maxPlayers: g.maxPlayers, remainingMs: g.remainingMs(), canJoin, hostId: g.hostId, mods: g.mods || [] });
    }
    out.push({ roomId: 'endless', mode: 'endless', name: '无尽模式', status: 'locked', locked: true, humans: 0, bots: 0, maxPlayers: 0, remainingMs: 0, canJoin: false, hostId: 0, mods: [] });
    return out;
  }

  tick() {
    const joinable = Array.from(this.rooms.values()).filter((g) => g.mode === 'normal' && g.status === 'running' && !g.noJoin && !g.settled);
    while (joinable.length < 3) { this.createRoom({ mode: 'normal' }); joinable.push(this.rooms.get('norm-' + this.seq.norm)); }
    for (const [id, g] of Array.from(this.rooms.entries())) {
      if (g.status === 'settled' || g.settled) {
        if (!g.settledAt) g.settledAt = Date.now();
        if (Date.now() - g.settledAt > 15000) this.rooms.delete(id); // K3: reclaim settled rooms after 15s
        continue;
      }
      if (g.mode === 'normal') { if (g.status === 'running') g.ensureAI(); continue; }
      if (g.mode !== 'elim') continue;
      if (g.status === 'waiting') {
        g.reassignHost();
        let humans = 0;
        for (const p of g.players.values()) if (!p.bot) humans++;
        if (humans === 0 || (g.lobbyExpireAt && Date.now() > g.lobbyExpireAt)) {
          this.rooms.delete(id);
          g.settled = true; g.status = 'settled';
          g.broadcast({ t: 'ev', k: 'room-closed', roomId: id });
        }
      }
    }
  }
}

const roomManager = new RoomManager();
const game = roomManager.defaultNormalRoom();
// the pool must expose at least two joinable normal rooms immediately (not only after the first 2s tick)
while (Array.from(roomManager.rooms.values()).filter((g) => g.mode === 'normal' && g.status === 'running' && !g.noJoin).length < 3) {
  roomManager.createRoom({ mode: 'normal' });
}
// defensive: make sure optional collections exist even if a constructor edit was missed
game.outposts = game.outposts || [];
game.pendingPacts = game.pendingPacts || new Map();
game.nextOutpost = game.nextOutpost || 1;
game.joints = game.joints || new Map();
game.nextJoint = game.nextJoint || 1;
game.trades = game.trades || new Map();
game.votes = game.votes || new Map();
game.nextTrade = game.nextTrade || 1;
game.nextVote = game.nextVote || 1;

/* ------------------------- Task H2: portal heartbeat ------------------------- */
const NODE_ID = process.env.NODE_ID || nodeConfig.nodeId || ('node-' + crypto.randomBytes(4).toString('hex'));
const NODE_SECRET = process.env.NODE_SECRET || nodeConfig.nodeSecret || 'orbital-frontier-dev-secret';
const NODE_VERSION = '2.0.0';
const PORTAL_URL = String(process.env.PORTAL_URL || nodeConfig.portalUrl || ('http://127.0.0.1:' + (process.env.PORTAL_PORT || 8686))).replace(/\/+$/, '');
let isDraining = false;
const runtimeConfig = {};

function applyControl(c) {
  if (!c || typeof c !== 'object') return;
  if (c.type === 'kick' && c.uid) {
    for (const g of roomManager.rooms.values()) {
      for (const p of g.players.values()) {
        if (p.uid !== c.uid) continue;
        if (p.conn) { try { p.conn.send({ t: 'reject', reason: '你已被管理员或新设备登录踢下线' }); p.conn.close(1000, 'kicked'); } catch (e) {} }
        p.conn = null; p.online = false;
      }
    }
  } else if (c.type === 'ban-ip' && c.ip) {
    const ip = String(c.ip);
    for (const ws of sockets) {
      let ra = (ws.socket && ws.socket.remoteAddress) || '';
      if (ra.indexOf('::ffff:') === 0) ra = ra.slice(7);
      if (ra === ip) { try { ws.close(1000, 'banned'); } catch (e) {} }
    }
  } else if (c.type === 'config') {
    if (c.key != null) {
      runtimeConfig[String(c.key)] = c.value;
      if (String(c.key) === 'draining') isDraining = c.value === true;
    }
    if (c.config && typeof c.config === 'object') {
      Object.assign(runtimeConfig, c.config);
      if (typeof c.config.draining !== 'undefined') isDraining = c.config.draining === true;
    }
  }
}

function nodeHeartbeatPayload() {
  return {
    nodeId: NODE_ID,
    version: NODE_VERSION,
    draining: !!isDraining,
    url: 'http://127.0.0.1:' + PORT,
    wsUrl: 'ws://127.0.0.1:' + PORT + '/ws',
    rooms: roomManager.list(),
    mods: MOD_SUMMARIES
  };
}

function sendNodeHeartbeat() {
  const raw = JSON.stringify(nodeHeartbeatPayload());
  const sig = crypto.createHmac('sha256', NODE_SECRET).update(raw, 'utf8').digest('hex');
  if (typeof fetch !== 'function') return;
  heartbeatLastSentAt = Date.now();
  fetch(PORTAL_URL + '/internal/heartbeat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-node-sig': sig },
    body: raw
  }).then((r) => r.json()).then((j) => {
    heartbeatLastOk = true; heartbeatLastError = '';
    if (j && Array.isArray(j.controls)) for (const c of j.controls) applyControl(c);
  }).catch((e) => { heartbeatLastOk = false; heartbeatLastError = String((e && e.message) || e); });
}

let heartbeatTimer = null;
function startHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(sendNodeHeartbeat, 2500);
  if (heartbeatTimer.unref) heartbeatTimer.unref();
}


/* ---------------------- Stage5 I5: standalone node admin ---------------------- */
const nodeAdminSessions = new Map();
function hashNodePassword(password, salt) { return crypto.scryptSync(String(password), String(salt), 32).toString('hex'); }
function verifyNodePassword(password, salt, hash) {
  try {
    const got = crypto.scryptSync(String(password), String(salt), 32);
    const want = Buffer.from(String(hash), 'hex');
    return want.length === got.length && crypto.timingSafeEqual(got, want);
  } catch (e) { return false; }
}
function safeHexEqual(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (!ba.length || ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
}
function saveNodeConfig() {
  try {
    if (nodeAdminAccount) { nodeConfig.admin = nodeAdminAccount; nodeConfig.initialized = true; }
    nodeConfig.rules = NODE_RULES;
    fs.mkdirSync(path.dirname(NODE_CONFIG_PATH), { recursive: true });
    fs.writeFileSync(NODE_CONFIG_PATH, JSON.stringify(nodeConfig, null, 2), 'utf8');
    return true;
  } catch (e) { return false; }
}
function applyNodeRules(input) {
  const r = (input && typeof input.rules === 'object') ? input.rules : input;
  if (!r || typeof r !== 'object') return NODE_RULES;
  const setNum = (key, min, max) => {
    if (r[key] === undefined) return;
    const n = Number(r[key]);
    if (!Number.isFinite(n)) return;
    NODE_RULES[key] = Math.max(min, Math.min(max, n));
  };
  setNum('startResource', 0, 100000);
  setNum('resourceRegen', 0, 1000);
  setNum('reinforceRate', 0, 1000);
  setNum('shipSpeed', 1, 100000);
  setNum('captureRate', 0.01, 100);
  setNum('maxPlayers', 2, 8);
  setNum('normalDurationMin', 1, 240);
  setNum('elimDurationMin', 1, 240);
  if (r.draining !== undefined) { NODE_RULES.draining = r.draining === true; isDraining = NODE_RULES.draining; }
  START_RESOURCE = numOr(NODE_RULES.startResource, START_RESOURCE);
  RESOURCE_REGEN = numOr(NODE_RULES.resourceRegen, RESOURCE_REGEN);
  REINFORCE_RATE = numOr(NODE_RULES.reinforceRate, REINFORCE_RATE);
  SHIP_SPEED = numOr(NODE_RULES.shipSpeed, SHIP_SPEED);
  CAPTURE_RATE = numOr(NODE_RULES.captureRate, CAPTURE_RATE);
  DEFAULT_MAX_PLAYERS = Math.max(2, Math.min(8, Math.round(numOr(NODE_RULES.maxPlayers, DEFAULT_MAX_PLAYERS))));
  NORMAL_DURATION_MS = Math.max(60000, Math.round(numOr(NODE_RULES.normalDurationMin, 40) * 60000));
  ELIM_DURATION_MS = Math.max(60000, Math.round(numOr(NODE_RULES.elimDurationMin, 25) * 60000));
  return NODE_RULES;
}
function issueNodeSession(username, role) {
  const token = 'na_' + crypto.randomBytes(24).toString('hex');
  nodeAdminSessions.set(token, { username: username || 'admin', role: role || 'admin', exp: Date.now() + 8 * 3600 * 1000 });
  return token;
}
function requireNodeAdmin(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const m = /^Bearer\s+(.+)$/i.exec(h);
  if (!m) return null;
  const rec = nodeAdminSessions.get(m[1].trim());
  if (!rec || rec.exp < Date.now()) return null;
  return rec;
}
function nodeAdminOverview() {
  const mem = process.memoryUsage();
  const rooms = [];
  for (const g of roomManager.rooms.values()) {
    let humans = 0, bots = 0;
    for (const p of g.players.values()) { if (p.bot) bots++; else humans++; }
    rooms.push({ roomId: g.roomId, mode: g.mode, name: g.name, status: g.status, humans, bots, maxPlayers: g.maxPlayers, remainingMs: g.remainingMs(), noJoin: !!g.noJoin });
  }
  const players = [];
  for (const g of roomManager.rooms.values()) {
    for (const p of g.players.values()) if (!p.bot && p.conn) players.push({ roomId: g.roomId, id: p.id, uid: p.uid || null, name: p.name });
  }
  const logs = [];
  for (const g of roomManager.rooms.values()) if (Array.isArray(g.log)) for (const line of g.log) logs.push(line);
  return {
    ok: true,
    nodeId: nodeConfig.nodeId || null,
    pid: process.pid,
    uptimeSec: Math.round(process.uptime()),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    tick: game.tick,
    tickMs: TICK_MS,
    heartbeat: { portalUrl: PORTAL_URL, lastSentAt: heartbeatLastSentAt, lastOk: heartbeatLastOk, lastError: heartbeatLastError, draining: !!isDraining },
    rooms,
    roomCount: rooms.length,
    players,
    onlineHumans: players.length,
    rules: Object.assign({}, NODE_RULES),
    configPath: NODE_CONFIG_PATH,
    logs: logs.slice(-100)
  };
}

let heartbeatLastSentAt = 0;
let heartbeatLastOk = false;
let heartbeatLastError = '';
function nodeAdminLogin(reqBody) {
  const b = reqBody || {};
  if (b.ssoTicket) {
    const payload = verifyTicket(b.ssoTicket);
    if (payload && payload.role === 'admin') return { ok: true, token: issueNodeSession(payload.name || 'portal-admin', 'admin'), username: payload.name || 'portal-admin', role: 'admin' };
    return { ok: false, status: 403, error: 'invalid_sso_ticket', message: '门户免密票据无效或已过期' };
  }
  if (!nodeAdminAccount) return { ok: false, status: 409, error: 'bootstrap_required', message: '节点尚未完成管理员初始化' };
  const username = String(b.username == null ? '' : b.username).trim();
  const password = String(b.password == null ? '' : b.password);
  if (username !== String(nodeAdminAccount.username) || !verifyNodePassword(password, nodeAdminAccount.salt, nodeAdminAccount.passHash)) {
    return { ok: false, status: 401, error: 'invalid_credentials', message: '账号或密码错误' };
  }
  return { ok: true, token: issueNodeSession(username, 'admin'), username, role: 'admin' };
}

function verifyTicket(ticket) {
  try {
    const s = String(ticket == null ? '' : ticket);
    const dot = s.lastIndexOf('.');
    if (dot <= 0) return null;
    const b64 = s.slice(0, dot);
    const sig = s.slice(dot + 1);
    const secret = process.env.NODE_SECRET || 'orbital-frontier-dev-secret';
    const expectHex = crypto.createHmac('sha256', secret).update(b64, 'utf8').digest('hex');
    const expectB64 = crypto.createHmac('sha256', secret).update(b64, 'utf8').digest('base64url');
    if (sig.toLowerCase() !== expectHex.toLowerCase() && sig !== expectB64) return null;
    let t = b64.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    const payload = JSON.parse(Buffer.from(t, 'base64').toString('utf8'));
    if (!payload || (payload.exp && Date.now() > Number(payload.exp))) return null;
    return payload;
  } catch (e) { return null; }
}

function sendSpectatorHello(ws, room) {
  ws.roomId = room.roomId; ws.game = room; ws.spectating = true; ws.joined = true; ws.playerId = 0;
  if (room.spectators) room.spectators.add(ws);
  room.sendWelcome(ws, { id: 0, token: null }, false);
}

function leaveCurrentSeat(ws) {
  const g = ws.game;
  if (!g || !ws.playerId) { ws.joined = false; ws.playerId = 0; return; }
  const p = g.players.get(ws.playerId);
  if (p) {
    if (g.mode === 'elim' && g.status === 'running') { p.conn = null; p.online = false; }
    else g.removePlayer(p, false);
  }
  ws.joined = false; ws.playerId = 0;
}

function attachHuman(ws, room, name, token) {
  ws.roomId = room.roomId; ws.game = room; ws.spectating = false;
  const p = room.addHuman(ws, sanitizeName(name), typeof token === 'string' ? token : null);
  if (!p) { try { ws.send({ t: 'full', message: '星域已满（' + room.maxPlayers + ' 个阵营）' }); } catch (e) {} ws.close(1000, 'full'); return null; }
  return p;
}

function onMessage(ws, msg) {
  if (msg.t === 'join') {
    if (ws.joined) return;
    let token = typeof msg.token === 'string' ? msg.token : null;
    let role = null, ticket = null, wantRoom = msg.roomId ? String(msg.roomId) : null;
    if (msg.ticket) {
      ticket = verifyTicket(msg.ticket);
      if (!ticket) {
        // B-S4-3: the portal ticket lives 60s; a valid room seat token must still be able to resume.
        const hit = token ? roomManager.findByToken(token) : (typeof msg.token === 'string' ? roomManager.findByToken(msg.token) : null);
        if (!hit) { ws.send({ t: 'reject', reason: '票据无效' }); return; }
        token = msg.token; wantRoom = hit.roomId; ticket = null;
      } else {
        role = ticket.role || null;
        if (!token && typeof ticket.token === 'string') token = ticket.token;
        if (ticket.roomId) wantRoom = String(ticket.roomId);
        if (!msg.name && ticket.name) msg.name = ticket.name;
      }
    }
    let room = token ? roomManager.findByToken(token) : null;
    if (!room && wantRoom) room = roomManager.get(wantRoom);
    // Task H2: portal-created room may not exist on this node yet — instantiate it from the ticket.
    if (!room && wantRoom && ticket) {
      room = roomManager.createRoom({
        roomId: wantRoom,
        mode: ticket.mode || 'elim',
        name: ticket.roomName || wantRoom,
        maxPlayers: ticket.maxPlayers || 8
      });
    }
    if (!room) room = roomManager.defaultNormalRoom();
    if (!room) { ws.send({ t: 'reject', reason: '没有可加入的房间' }); return; }
    // B-S4-4: only a signed admin spectator ticket may watch — and it must bypass capacity/noJoin gates,
    // never taking a seat, a world, or an "entered sector" broadcast.
    const asSpectator = !!(role === 'admin' && ticket && ticket.spectate === true);
    if (asSpectator) { sendSpectatorHello(ws, room); return; }
    const existing = token
      ? Array.from(room.players.values()).find((x) => !x.bot && x.token === token)
      : (ticket && ticket.uid ? Array.from(room.players.values()).find((x) => !x.bot && x.uid === ticket.uid) : null);
    if (!existing) {
      if (room.status === 'settled' || room.settled) { ws.send({ t: 'reject', reason: '房间已结算' }); return; }
      if (room.mode === 'elim' && room.status === 'running') { ws.send({ t: 'reject', reason: '对局已开始，禁止中途加入' }); return; }
      if (room.noJoin) { ws.send({ t: 'reject', reason: '房间已进入禁入期' }); return; }
      let seats = 0; for (const x of room.players.values()) if (!x.bot) seats++;
      if (seats >= room.maxPlayers) { ws.send({ t: 'full', message: '星域已满' }); return; }
    }
    const player = attachHuman(ws, room, msg.name, existing ? existing.token : token);
    if (player) {
      if (ticket && ticket.uid) player.uid = ticket.uid;
      if (ticket && ticket.isHost && room.mode === 'elim' && !room.hostId) room.hostId = player.id;
    }
    return;
  }
  if (msg.t === 'roomCreate') {
    if (ws.joined) leaveCurrentSeat(ws);
    const room = roomManager.createRoom({
      mode: msg.mode === 'normal' ? 'normal' : 'elim',
      name: sanitizeName(msg.name) || null,
      maxPlayers: msg.maxPlayers,
      durationMs: msg.durationMs,
      lobbyExpireMs: msg.lobbyExpireMs
    });
    const p = attachHuman(ws, room, msg.playerName || msg.name, null);
    if (p) { room.hostId = p.id; ws.send({ t: 'ack', op: 'roomCreate', roomId: room.roomId }); }
    return;
  }
  if (msg.t === 'spectate') {
    if (ws.joined) leaveCurrentSeat(ws);
    let room = msg.roomId ? roomManager.get(msg.roomId) : null;
    if (!room && ws.roomId) room = roomManager.get(ws.roomId);
    if (!room) room = roomManager.defaultNormalRoom();
    if (!room) { ws.send({ t: 'reject', reason: '房间不存在' }); return; }
    sendSpectatorHello(ws, room);
    return;
  }
  if (msg.t === 'ping') { ws.send({ t: 'pong', c: msg.c, at: Date.now() }); return; }
  if (!ws.joined) return;
  const g = ws.game || roomManager.get(ws.roomId) || game;
  if (!ws.playerId) return; // spectator is read-only
  const p = g.players.get(ws.playerId);
  if (!p || p.bot) return;
  switch (msg.t) {
    case 'launch': g.intentLaunch(ws, p, msg); break;
    case 'launchOutpost': g.intentLaunchOutpost(ws, p, msg); break;
    case 'jointLaunch': g.intentJointLaunch(ws, p, msg); break;
    case 'jointVote': g.intentJointVote(ws, p, msg); break;
    case 'jointGo': g.intentJointGo(ws, p, msg); break;
    case 'gather': g.intentGather(ws, p, msg); break;
    case 'retarget': g.intentRetarget(ws, p, msg); break;
    case 'outpost': g.intentBuildOutpost(ws, p, msg); break;
    case 'merge': g.intentMerge(ws, p, msg); break;
    case 'split': g.intentSplit(ws, p, msg); break;
    case 'rename': g.intentRename(ws, p, msg); break;
    case 'reinforce': g.intentReinforce(ws, p, msg); break;
    case 'destroy': g.intentDestroy(ws, p, msg); break;
    case 'ally': g.intentAlly(ws, p, msg); break;
    case 'pactRespond': g.intentRespondPact(ws, p, msg); break;
    case 'breakpact': g.intentBreak(ws, p, msg); break;
    case 'trade': g.intentTrade(ws, p, msg); break;
    case 'transfer': g.intentTransfer(ws, p, msg); break;
    case 'tradeRespond': g.intentTradeRespond(ws, p, msg); break;
    case 'diplo': g.intentDiplo(ws, p, msg); break;
    case 'vote': g.intentVote(ws, p, msg); break;
    case 'diploRespond': g.intentDiploRespond(ws, p, msg); break;
    case 'roomAddAI': g.intentRoomAddAI(ws, p, msg); break;
    case 'roomRemoveAI': g.intentRoomRemoveAI(ws, p, msg); break;
    case 'roomStart': g.intentRoomStart(ws, p, msg); break;
    case 'chat': {
      const now = Date.now();
      if (now - ws.lastChatAt < 2000) return;
      let text = typeof msg.text === 'string' ? msg.text : '';
      text = text.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
      text = Array.from(text).slice(0, 90).join('');
      if (!text) return;
      ws.lastChatAt = now;
      const channel = msg.channel === 'ally' ? 'ally' : 'global';
      if (channel === 'global') {
        g.broadcastChat({ id: p.id, name: p.name, channel: 'global', text });
      } else if (!p.coalition) {
        ws.send({ t: 'ev', k: 'chat', channel: 'ally', sys: true, text: '你尚未加入联盟，无法发送联盟消息' });
      } else {
        g.broadcastChatToCoalition({ id: p.id, name: p.name, channel: 'ally', text }, p.coalition);
        g.maybeIntercept(text, p, false);
      }
      break;
    }
    case 'leave': {
      // B-S4-5: honour the client's keepSeat promise — keep worlds/ships and only mark offline.
      if ((msg.keepSeat === true && g.status === 'running') || (g.mode === 'elim' && g.status === 'running' && !msg.dropSeat)) {
        p.conn = null; p.online = false;
        if (!p.disconnectedAt) p.disconnectedAt = Date.now();
        g.broadcast({ t: 'ev', k: 'presence', id: p.id, name: p.name, online: false });
        g.reassignHost();
        ws.joined = false; ws.playerId = 0;
      } else {
        g.removePlayer(p, true); ws.joined = false; g.playerId = 0; g.ensureAI();
      }
      break;
    }
    case 'reset': {
      if (Date.now() - (ws.lastResetAt || 0) < 10000) return;
      ws.lastResetAt = Date.now();
      g.resetSeats(p.name);
      break;
    }
    default: break;
  }
}

/* ------------------------------- HTTP -------------------------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

/* ----------------------- Stage5 I5: node admin HTTP ----------------------- */
function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const max = limit || MAX_MESSAGE;
    const chunks = []; let len = 0;
    req.on('data', (c) => {
      len += c.length;
      if (len > max) { const e = new Error('payload_too_large'); e.status = 413; reject(e); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { const err = new Error('invalid_json'); err.status = 400; reject(err); }
    });
    req.on('error', (e) => reject(e));
  });
}

const ADMIN_HTML = "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>星海边境 · 游戏节点管理台</title>\n<style>body{margin:0;background:radial-gradient(circle at 20% 10%,#0b2a3a,#03070d 60%);color:#d8f3ff;font:13px/1.6 system-ui,sans-serif}.wrap{max-width:1000px;margin:auto;padding:24px}.title{font-size:20px;letter-spacing:3px;color:#6ee7ff;text-shadow:0 0 18px #0ff6}.card{background:rgba(5,20,32,.72);border:1px solid rgba(64,220,255,.28);border-radius:14px;padding:16px;margin:14px 0;backdrop-filter:blur(10px)}label{display:block;color:#8ec9dd;margin:6px 0 2px}input,select,button{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid #1d6075;background:#06141d;color:#dff}button{cursor:pointer;background:linear-gradient(180deg,#0c4052,#07222e);border-color:#26a6c7}button:hover{border-color:#6ee7ff}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px}.k{color:#7fc9da}.v{color:#eaffff;font-weight:600}pre{white-space:pre-wrap;max-height:280px;overflow:auto;background:#020b10;border:1px solid #123b49;border-radius:8px;padding:10px;color:#9fdfea;font-size:12px}h3{color:#68d7ef;margin:4px 0 10px}</style></head><body><div class=\"wrap\">\n<div class=\"title\">ORBITAL FRONTIER · GAME NODE ADMIN</div>\n<div class=\"card\"><h3>节点管理员登录</h3><div class=\"row\"><div><label>用户名</label><input id=\"u\"></div><div><label>密码</label><input id=\"p\" type=\"password\"></div><button onclick=\"doLogin()\">登录</button><span id=\"loginMsg\"></span></div><div style=\"margin-top:8px;color:#7fc9da\">或从门户「打开游戏服独立管理面板」携带 sso 票据进入。</div></div>\n<div class=\"card\" id=\"bootCard\" style=\"display:none\"><h3>初始化节点管理员</h3><div class=\"row\"><div><label>NODE_BOOTSTRAP_TOKEN</label><input id=\"bt\" placeholder=\"控制台打印的32位令牌\"></div><div><label>用户名</label><input id=\"bu\"></div><div><label>密码</label><input id=\"bp\" type=\"password\"></div><button onclick=\"doBootstrap()\">创建管理员</button><span id=\"bootMsg\"></span></div></div>\n<div id=\"panel\" style=\"display:none\">\n<div class=\"card\"><h3>节点概览</h3><div class=\"row\"><button onclick=\"loadOverview()\">刷新</button><span id=\"statusMsg\"></span></div><div id=\"overview\" class=\"grid\" style=\"margin-top:10px\"></div></div>\n<div class=\"card\"><h3>规则热更新</h3><div class=\"row\" id=\"rulesForm\"></div><div class=\"row\" style=\"margin-top:10px\"><button onclick=\"saveRules()\">保存并热应用</button><span id=\"rulesMsg\"></span></div></div>\n<div class=\"card\"><h3>房间操作</h3><div class=\"row\"><div><label>房间ID</label><input id=\"rid\" placeholder=\"留空=新建\"></div><div><label>操作</label><select id=\"ract\"><option>create</option><option>settle</option><option>reset</option><option>destroy</option><option>kick</option></select></div><div><label>模式</label><select id=\"rmode\"><option>normal</option><option>elim</option></select></div><div><label>房名</label><input id=\"rname\"></div><button onclick=\"roomAction()\">执行</button><span id=\"roomMsg\"></span></div></div>\n<div class=\"card\"><h3>Mods</h3><div class=\"row\"><div><label>Mod ID</label><input id=\"mid\" value=\"nebula-overdrive\"></div><div><label>启用</label><select id=\"men\"><option value=\"true\">true</option><option value=\"false\">false</option></select></div><div><label>倍速</label><input id=\"msp\" type=\"number\" step=\"0.01\" value=\"1.15\"></div><button onclick=\"toggleMod()\">应用</button><span id=\"modMsg\"></span></div></div>\n<div class=\"card\"><h3>最近日志</h3><pre id=\"logs\"></pre></div>\n<div class=\"card\"><button onclick=\"logout()\">退出登录</button></div>\n</div>\n<script>var BASE=location.pathname.replace(/\\/admin\\/?$/,\"\");function nodeApiUrl(sub){return (BASE?BASE:\"\")+sub;}\nvar TOKEN=localStorage.getItem(\"nodeAdminToken\")||\"\";var RULES={};\nfunction $(id){return document.getElementById(id)}\nfunction headers(){return {\"content-type\":\"application/json\",authorization:\"Bearer \"+TOKEN}}\nfunction msg(id,t,ok){var e=$(id);if(e){e.textContent=t;e.style.color=ok?\"#8cffbe\":\"#ff9c9c\"}}\nfunction api(p,opt){opt=opt||{};opt.headers=headers();return fetch(nodeApiUrl(p),opt).then(function(r){return r.json().then(function(j){j.__status=r.status;return j})})}\nfunction showPanel(){$(\"loginCard\");$(\"panel\").style.display=\"block\";loadOverview();loadRules();}\nfunction doLogin(){fetch(nodeApiUrl(\"/api/node-admin/login\"),{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({username:$(\"u\").value,password:$(\"p\").value})}).then(function(r){return r.json()}).then(function(j){if(j.ok){TOKEN=j.token;localStorage.setItem(\"nodeAdminToken\",TOKEN);showPanel();}else msg(\"loginMsg\",j.message||\"登录失败\",false);});}\nfunction ssoLogin(t){fetch(nodeApiUrl(\"/api/node-admin/login\"),{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({ssoTicket:t})}).then(function(r){return r.json()}).then(function(j){if(j.ok){TOKEN=j.token;localStorage.setItem(\"nodeAdminToken\",TOKEN);showPanel();}else msg(\"loginMsg\",j.message||\"SSO 登录失败\",false);});}\nfunction loadOverview(){api(\"/api/node-admin/overview\").then(function(j){if(j.__status!==200){msg(\"statusMsg\",j.message||\"需登录\",false);return;}var m=j.memory||{};$(\"overview\").innerHTML=[[\"节点\",j.nodeId||\"-\"],[\"PID\",j.pid],[\"运行(秒)\",j.uptimeSec],[\"内存(MB)\",(m.rss/1048576).toFixed(1)],[\"Tick\",j.tick],[\"房间数\",j.roomCount],[\"在线真人\",j.onlineHumans],[\"心跳\",j.heartbeat&&j.heartbeat.lastOk?\"正常\":\"未连接\"]].map(function(x){return \"<div><div class=k>\"+x[0]+\"</div><div class=v>\"+x[1]+\"</div></div>\"}).join(\"\");$(\"logs\").textContent=(j.logs||[]).slice(-100).join(String.fromCharCode(10));msg(\"statusMsg\",\"已刷新\",true);});}\nfunction loadRules(){api(\"/api/node-admin/overview\").then(function(j){RULES=j.rules||{};$(\"rulesForm\").innerHTML=Object.keys(RULES).map(function(k){if(typeof RULES[k]===\"boolean\")return \"<div><label>\"+k+\"</label><select data-rk=\"+k+\"><option value=true\"+(RULES[k]?\" selected\":\"\")+\">true</option><option value=false\"+(!RULES[k]?\" selected\":\"\")+\">false</option></select></div>\";return \"<div><label>\"+k+\"</label><input data-rk=\"+k+\" type=number step=any value=\"+RULES[k]+\"></div>\";}).join(\"\");});}\nfunction collectRules(){var r={};document.querySelectorAll(\"[data-rk]\").forEach(function(el){var k=el.getAttribute(\"data-rk\");r[k]=el.value===\"true\"?true:el.value===\"false\"?false:Number(el.value);});return r;}\nfunction saveRules(){api(\"/api/node-admin/rules\",{method:\"POST\",body:JSON.stringify({rules:collectRules()})}).then(function(j){if(j.ok){RULES=j.rules;msg(\"rulesMsg\",\"已保存并写回配置\",true);loadOverview();}else msg(\"rulesMsg\",j.message||\"失败\",false);});}\nfunction roomAction(){var b={action:$(\"ract\").value};if($(\"rid\").value)b.roomId=$(\"rid\").value;if($(\"rname\").value)b.name=$(\"rname\").value;b.mode=$(\"rmode\").value;fetch(nodeApiUrl(\"/api/node-admin/rooms/action\"),{method:\"POST\",headers:headers(),body:JSON.stringify(b)}).then(function(r){return r.json()}).then(function(j){msg(\"roomMsg\",j.ok?\"成功\":(j.message||\"失败\"),!!j.ok);if(j.ok)loadOverview();});}\nfunction toggleMod(){fetch(nodeApiUrl(\"/api/node-admin/mods/toggle\"),{method:\"POST\",headers:headers(),body:JSON.stringify({id:$(\"mid\").value,enabled:$(\"men\").value===\"true\",speedMultiplier:Number($(\"msp\").value)})}).then(function(r){return r.json()}).then(function(j){msg(\"modMsg\",j.ok?\"已应用\":(j.message||\"失败\"),!!j.ok);});}\nfunction doBootstrap(){fetch(nodeApiUrl(\"/api/node-admin/bootstrap-init\"),{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({token:$(\"bt\").value,username:$(\"bu\").value,password:$(\"bp\").value})}).then(function(r){return r.json()}).then(function(j){if(j.ok){TOKEN=j.token;localStorage.setItem(\"nodeAdminToken\",TOKEN);showPanel();}else msg(\"bootMsg\",j.message||\"初始化失败\",false);});}\nfunction logout(){TOKEN=\"\";localStorage.removeItem(\"nodeAdminToken\");location.reload();}\n(function(){var sso=new URLSearchParams(location.search).get(\"sso\");if(sso){ssoLogin(sso);}else if(TOKEN){api(\"/api/node-admin/overview\").then(function(j){if(j.__status===200)showPanel();});}})();\n</script>\n</div></body></html>"
async function handleNodeAdmin(req, res, pathname) {
  const method = req.method || 'GET';
  const sendJ = (status, obj) => { const body = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) }); res.end(body); };
  try {
    if (pathname === '/api/node-admin/bootstrap-status' && method === 'GET') {
      return sendJ(200, { ok: true, initialized: !!nodeAdminAccount, bootstrapRequired: !nodeAdminAccount, nodeId: nodeConfig.nodeId || null, configPath: NODE_CONFIG_PATH });
    }
    if (pathname === '/api/node-admin/bootstrap-init' && method === 'POST') {
      if (nodeAdminAccount) return sendJ(409, { ok: false, error: 'already_initialized', message: '节点管理员已初始化' });
      const b = await readRequestBody(req);
      const token = String(b.token == null ? '' : b.token).trim();
      if (!NODE_BOOTSTRAP_TOKEN || !safeHexEqual(token, NODE_BOOTSTRAP_TOKEN)) return sendJ(403, { ok: false, error: 'invalid_bootstrap_token', message: '节点初始化令牌错误' });
      const username = String(b.username == null ? '' : b.username).trim();
      const password = String(b.password == null ? '' : b.password);
      if (username.length < 2 || !password) return sendJ(400, { ok: false, error: 'invalid_credentials', message: '用户名或密码无效' });
      const salt = crypto.randomBytes(16).toString('hex');
      nodeAdminAccount = { uid: 'node-admin', username, passHash: hashNodePassword(password, salt), salt, role: 'admin' };
      nodeConfig.initialized = true; NODE_BOOTSTRAP_TOKEN = null;
      saveNodeConfig();
      return sendJ(200, { ok: true, token: issueNodeSession(username, 'admin'), username, role: 'admin' });
    }
    if (pathname === '/api/node-admin/login' && method === 'POST') {
      const b = await readRequestBody(req);
      const r = nodeAdminLogin(b);
      return sendJ(r.ok ? 200 : r.status || 401, r);
    }
    const auth = requireNodeAdmin(req);
    if (!auth) return sendJ(401, { ok: false, error: 'unauthorized', message: '需要节点管理员登录' });
    if (pathname === '/api/node-admin/overview' && method === 'GET') return sendJ(200, nodeAdminOverview());
    if (pathname === '/api/node-admin/rules' && method === 'POST') {
      const b = await readRequestBody(req);
      const rules = applyNodeRules(b);
      const saved = saveNodeConfig();
      return sendJ(200, { ok: true, rules: Object.assign({}, rules), configPath: NODE_CONFIG_PATH, saved });
    }
    if (pathname === '/api/node-admin/rooms/action' && method === 'POST') {
      const b = await readRequestBody(req);
      const action = String(b.action || '');
      if (action === 'create') {
        const g = roomManager.createRoom({ mode: b.mode === 'elim' ? 'elim' : 'normal', name: sanitizeName(b.name) || null, maxPlayers: b.maxPlayers });
        return sendJ(200, { ok: true, action, room: { roomId: g.roomId, mode: g.mode, status: g.status, maxPlayers: g.maxPlayers } });
      }
      const g = b.roomId ? roomManager.get(String(b.roomId)) : null;
      if (!g) return sendJ(404, { ok: false, error: 'room_not_found', message: '房间不存在' });
      if (action === 'settle') { g.settleRoom('admin'); return sendJ(200, { ok: true, action, roomId: g.roomId, status: g.status }); }
      if (action === 'reset') { g.resetSeats('admin'); return sendJ(200, { ok: true, action, roomId: g.roomId }); }
      if (action === 'destroy') {
        roomManager.rooms.delete(g.roomId);
        g.settled = true; g.status = 'settled';
        g.broadcast({ t: 'ev', k: 'room-closed', roomId: g.roomId });
        return sendJ(200, { ok: true, action, roomId: g.roomId });
      }
      if (action === 'kick') {
        let target = null;
        for (const p of g.players.values()) {
          if ((b.uid && p.uid === b.uid) || (b.playerId != null && p.id === Number(b.playerId)) || (b.name && p.name === b.name)) { target = p; break; }
        }
        if (!target) return sendJ(404, { ok: false, error: 'player_not_found', message: '玩家不在该房间' });
        if (target.conn) { try { target.conn.send({ t: 'reject', reason: '你已被节点管理员移出房间' }); target.conn.close(1000, 'kicked'); } catch (e) {} }
        g.removePlayer(target, true);
        return sendJ(200, { ok: true, action, roomId: g.roomId, kicked: target.id });
      }
      return sendJ(400, { ok: false, error: 'invalid_action', message: '未知房间操作' });
    }
    if (pathname === '/api/node-admin/mods/toggle' && method === 'POST') {
      const b = await readRequestBody(req);
      const id = String(b.id || b.modId || '').trim();
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return sendJ(400, { ok: false, error: 'invalid_mod_id', message: 'Mod ID 无效' });
      const cf = path.join(__dirname, 'plugins', id, 'config.json');
      if (!fs.existsSync(cf)) return sendJ(404, { ok: false, error: 'mod_not_found', message: '未找到该 Mod' });
      let config = {};
      try { config = JSON.parse(fs.readFileSync(cf, 'utf8')); } catch (e) {}
      if (b.enabled !== undefined) config.enabled = b.enabled === true;
      if (b.speedMultiplier !== undefined && Number.isFinite(Number(b.speedMultiplier))) config.speedMultiplier = Number(b.speedMultiplier);
      fs.writeFileSync(cf, JSON.stringify(config, null, 2), 'utf8');
      reloadPlugins();
      return sendJ(200, { ok: true, mod: { id, config }, mods: MOD_SUMMARIES });
    }
    return sendJ(404, { ok: false, error: 'not_found', message: '未知节点管理接口' });
  } catch (e) {
    const status = (e && e.status) || 500;
    return sendJ(status, { ok: false, error: (e && e.code) || 'internal_error', message: (e && e.message) || 'error' });
  }
}

function normalizeNodePath(rawPathname) {
  let p = String(rawPathname || '/').replace(/\/+$/, '') || '/';
  if (p === '/admin' || p.endsWith('/admin')) return '/admin';
  const apiIdx = p.indexOf('/api/node-admin/');
  if (apiIdx >= 0) return p.slice(apiIdx);
  if (p === '/api/status' || p.endsWith('/api/status') || p.endsWith('/status')) return '/api/status';
  if (p === '/health' || p.endsWith('/health')) return '/health';
  if (p === '/ws' || p.endsWith('/ws')) return '/ws';
  return p;
}

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { pathname = '/'; }
  pathname = normalizeNodePath(pathname);
  if ((pathname === '/admin' || pathname === '/admin/') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(ADMIN_HTML);
    return;
  }
  if (pathname.indexOf('/api/node-admin/') === 0) { await handleNodeAdmin(req, res, pathname); return; }
  if ((pathname === '/api/status' || pathname === '/health') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    const st = game.statusInfo();
    st.rooms = roomManager.list();
    res.end(JSON.stringify(st));
    return;
  }
  // Task H2/I5: the game node is API + WebSocket only — never serve static pages here.
  res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({
    ok: false,
    error: 'game_node_api_only',
    message: '游戏服务器仅提供 API 与 WebSocket 通信，请访问门户端 (Portal) 登录进入房间大厅'
  }));
});


server.on('upgrade', (req, socket, head) => {
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { socket.destroy(); return; }
  // Stage5.1 J1: accept arbitrary reverse-proxy prefixes (/yxapi/ws) and any valid websocket upgrade to this node.
  const normPath = normalizeNodePath(pathname);
  const isWsUpgrade = String(req.headers.upgrade || '').toLowerCase() === 'websocket';
  if (normPath !== '/ws' && !isWsUpgrade) { socket.destroy(); return; }
  const key = req.headers['sec-websocket-key'];
  if (!key || String(req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = new WSClient(socket);
  sockets.add(ws);
  if (head && head.length) ws.onData(head);
});

setInterval(() => {
  for (const ws of sockets) {
    if (!ws.alive) { ws.close(1001, 'timeout'); continue; }
    ws.alive = false;
    ws.sendFrame(0x9, Buffer.from('hb'));
  }
}, 20000);

setInterval(() => { for (const g of roomManager.rooms.values()) g.ensureAI(); }, 8000);
// RoomManager pool maintenance: keep >=2 joinable normal rooms & reclaim stale elim lobbies
setInterval(() => roomManager.tick(), 2000);

server.listen(PORT, HOST, () => {
  console.log('STARFRONT v2 listening on http://' + HOST + ':' + PORT);
  console.log('Sector: ' + game.planets.size + ' worlds, ' + game.players.size + ' factions, ' + game.nodes.length + ' drifting caches');
  if (NODE_BOOTSTRAP_TOKEN) {
    console.log('================================================================');
    console.log('[NODE BOOTSTRAP] 游戏节点尚未配置管理员，请访问 /admin 并输入一次性令牌：');
    console.log('NODE_BOOTSTRAP_TOKEN: ' + NODE_BOOTSTRAP_TOKEN);
    console.log('================================================================');
  }
  startHeartbeat();
});

function shutdown() {
  console.log('Draining sector...');
  for (const ws of sockets) { try { ws.send({ t: 'shutdown' }); ws.close(1001, 'shutdown'); } catch (e) {} }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (e) => console.error('Uncaught:', (e && e.stack) || e));
process.on('unhandledRejection', (e) => console.error('Unhandled:', (e && e.stack) || e));
