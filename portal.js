'use strict';
/*
 * 星海边境 · ORBITAL FRONTIER — Stage 3 Task F 独立门户端（portal.js）
 * 零依赖：仅 Node 内置 http / crypto / fs / path。默认端口 8686（PORTAL_PORT 覆盖）。
 *
 * 入口约定：
 *   const portal = require('./portal.js');   // require 时不自动监听
 *   portal.app      -> (req,res) 请求处理器
 *   portal.server   -> http.Server 实例（未监听）
 *   portal.start(port, cb) -> http.Server（port 省略时用 PORTAL_PORT/8686；start(0) 随机端口）
 *
 * 三链路鉴权：
 *   ① 节点心跳与版本锁  POST /internal/heartbeat  （头 x-node-sig = HMAC(body, NODE_SECRET)）
 *   ② 大厅房间列表/建房  GET /api/rooms · POST /api/rooms/create （Bearer sessionToken）
 *   ③ 一次性入房票据    POST /api/rooms/join     （HMAC 签名，60s 有效）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const child_process = require('child_process');

/** 读取根目录 .env（KEY=VALUE），仅注入未被外部设置的环境变量（Task H1）。 */
function loadDotEnv(file) {
  const fp = file || path.join(__dirname, '.env');
  try {
    if (!fs.existsSync(fp)) return;
    const raw = fs.readFileSync(fp, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const s = String(line).trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq <= 0) continue;
      const key = s.slice(0, eq).trim();
      let val = s.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) { /* ignore malformed .env */ }
}

loadDotEnv();

/* --------------------------------- 常量 -------------------------------- */

const PORTAL_VERSION = String(process.env.PORTAL_VERSION || '2.0.0');
const NODE_SECRET = String(process.env.NODE_SECRET || 'orbital-frontier-dev-secret');
const PORT = Number(process.env.PORTAL_PORT || 8686);
const DB_PATH = process.env.PORTAL_DB || path.join(__dirname, 'data', 'portal-db.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DEFAULT_GAME_WS = String(process.env.GAME_WS_URL || 'ws://127.0.0.1:8787/ws');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json; charset=utf-8'
};
let bootstrapToken = null;

const RECOVERY_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 32 字符，去掉易混的 0/1/I/O
const TICKET_TTL_MS = 60 * 1000;      // 一次性入房票据有效期 60s
const RESET_WINDOW_MS = 60 * 1000;    // 重置密码滑动窗口 60s
const RESET_MAX = 5;                  // 每 IP 每窗口最多 5 次尝试，第 6 次 429
const MAX_BODY = 4 * 1024 * 1024;     // 单请求体上限
const CONTROL_QUEUE_MAX = 500;        // 节点控制指令队列上限

const DEFAULT_CONFIG = Object.freeze({
  startResource: 30,
  captureRate: 1.0,
  draining: false,
  maxPlayers: 8,
  cooldownSec: 30,
  gamePublicWsUrl: String(process.env.GAME_PUBLIC_WS_URL || ''),
  gamePublicApiUrl: String(process.env.GAME_PUBLIC_API_URL || ''),
  proxyPrefix: '',
  allowRegistration: true,
  announcement: '',
  adminPath: String(process.env.ADMIN_PATH || '/qaqmin'),
  nodeDownloadUrl: String(process.env.NODE_DOWNLOAD_URL || 'https://github.com/IPF-Sinon/astra-front/releases/latest/download/server.js')
});

/* -------------------------------- 数据库 ------------------------------- */

function emptyDb() {
  return {
    users: {},          // uid -> { uid, username, passHash, salt, recoveryHash, role, banned, createdAt, activeSession, currentRoom }
    bannedIps: [],      // [ip]
    nodes: {},          // nodeId -> { nodeId, url, wsUrl, version, draining, rooms, mods, lastSeen, versionMismatch }
    rooms: {},          // roomId -> 门户侧登记的淘汰房
    config: Object.assign({}, DEFAULT_CONFIG),
    controlQueue: [],   // 待下发给游戏节点的控制指令（踢人/封禁实时断连）
    meta: { createdAt: Date.now() }
  };
}

/* ---------------- Stage 5 I6 / K5：单例本地受管游戏节点编排 ---------------- */
const LOCAL_NODE_ID = 'local-node';
const LOCAL_NODE_PORT = Number(process.env.GAME_PORT || 8787);
function managedDir(nodeId) { return path.join(__dirname, 'managed-nodes', String(nodeId).replace(/[^a-zA-Z0-9_-]/g, '_')); }
const localNode = {
  nodeId: LOCAL_NODE_ID,
  port: LOCAL_NODE_PORT,
  dir: managedDir(LOCAL_NODE_ID),
  serverPath: path.join(managedDir(LOCAL_NODE_ID), 'server.js'),
  configPath: path.join(managedDir(LOCAL_NODE_ID), 'game-node.config.json'),
  child: null, running: false, external: false, startedAt: 0, logs: [], exitCode: null, lastSeen: 0
};
function copyDirSync(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name), d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDirSync(s, d); else fs.copyFileSync(s, d);
  }
}
async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed ' + r.status);
  return await r.text();
}
async function ensureNodeInstalled(nodeId, downloadUrl) {
  const dir = managedDir(nodeId);
  fs.mkdirSync(dir, { recursive: true });
  const serverPath = path.join(dir, 'server.js');
  if (!fs.existsSync(serverPath)) {
    // Stage5.5: prefer the published release asset; local copy is only an offline fallback.
    const src = String(downloadUrl || (db && db.config && db.config.nodeDownloadUrl) || '').trim();
    let downloaded = false;
    if (src) {
      try {
        fs.writeFileSync(serverPath, await fetchText(src), 'utf8');
        downloaded = true;
        console.log('[portal] managed node server.js downloaded from ' + src);
      } catch (e) {
        console.log('[portal] server.js download failed (' + (e && e.message) + '); falling back to local copy');
      }
    }
    if (!downloaded) {
      fs.copyFileSync(path.join(__dirname, 'server.js'), serverPath);
      console.log('[portal] managed node server.js used LOCAL fallback copy (offline mode)');
    }
  }
  const pluginSrc = path.join(__dirname, 'plugins');
  if (fs.existsSync(pluginSrc)) copyDirSync(pluginSrc, path.join(dir, 'plugins'));
  return { dir: dir, serverPath: serverPath, configPath: path.join(dir, 'game-node.config.json') };
}
function pickPortalAdmin() {
  for (const uid of Object.keys(db.users)) { const u = db.users[uid]; if (u && u.role === 'admin') return u; }
  return null;
}
function selfPortalUrl() {
  let p = PORT;
  try { const a = (typeof server !== 'undefined' && server && server.address) ? server.address() : null; if (a && a.port) p = a.port; } catch (e) {}
  return 'http://127.0.0.1:' + p;
}
function buildNodeConfig(nodeId, port) {
  const admin = pickPortalAdmin();
  return {
    initialized: true, nodeId: String(nodeId), port: Number(port),
    portalUrl: selfPortalUrl(),
    nodeSecret: NODE_SECRET,
    admin: admin ? { uid: admin.uid, username: admin.username, passHash: admin.passHash, salt: admin.salt, role: 'admin' } : null,
    rules: { startResource: 30, resourceRegen: 1.2, reinforceRate: 1.0, shipSpeed: 340, captureRate: 1.0, maxPlayers: 8, normalDurationMin: 40, elimDurationMin: 25, draining: false }
  };
}
function nodeSsoTicket() { return signTicket({ name: 'portal-admin', role: 'admin', sso: true, exp: Date.now() + 60000 }); }
function portProbe(port) {
  return new Promise((resolve) => {
    let done = false;
    const sock = net.connect({ host: '127.0.0.1', port: Number(port) });
    const finish = (v) => { if (done) return; done = true; try { sock.destroy(); } catch (e) {} resolve(v); };
    sock.once('connect', () => finish(true));
    sock.once('error', () => finish(false));
    setTimeout(() => finish(false), 800);
  });
}
function recentNodeOnPort(port) {
  const now = Date.now();
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    if (!n || now - (n.lastSeen || 0) > 10000) continue;
    const blob = String(n.url || '') + ' ' + String(n.wsUrl || '') + ' ' + String(n.port || '');
    if (blob.indexOf(':' + port) >= 0 || Number(n.port) === Number(port)) return n;
  }
  return null;
}
function cleanupZombieNodes() {
  const now = Date.now();
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    if (!n || now - (n.lastSeen || 0) > 30000) { delete db.nodes[nodeId]; continue; }
  }
  // dedupe: same url/wsUrl/port keeps the freshest nodeId only
  const groups = {};
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    const key = String(n.url || '') + '|' + String(n.wsUrl || '') + '|' + String(n.port || '');
    if (!groups[key] || (n.lastSeen || 0) > (groups[key].lastSeen || 0)) groups[key] = Object.assign({ nodeId }, n);
  }
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    const key = String(n.url || '') + '|' + String(n.wsUrl || '') + '|' + String(n.port || '');
    if (groups[key] && groups[key].nodeId !== nodeId) delete db.nodes[nodeId];
  }
}
function localNodeSummary() {
  return {
    nodeId: localNode.nodeId, installed: fs.existsSync(localNode.serverPath), running: !!localNode.running,
    external: !!localNode.external, pid: localNode.child ? localNode.child.pid : null, port: localNode.port,
    uptimeMs: localNode.startedAt ? Date.now() - localNode.startedAt : 0,
    logTail: localNode.logs.slice(-40).join(''), logs: localNode.logs.slice(-200).join(''),
    ssoTicket: nodeSsoTicket(), configPath: localNode.configPath
  };
}
function externalNodes() {
  cleanupZombieNodes();
  return Object.values(db.nodes).map((n) => ({
    nodeId: n.nodeId, url: n.url || null, wsUrl: n.wsUrl || null, port: n.port || null,
    version: n.version || null, draining: !!n.draining, versionMismatch: !!n.versionMismatch,
    lastSeen: n.lastSeen || 0, rooms: Array.isArray(n.rooms) ? n.rooms.length : 0,
    ssoTicket: nodeSsoTicket()
  }));
}
function managedStatus() { return [localNodeSummary()]; }
async function ensureLocalNode(port, downloadUrl) {
  const p = Number(port) || localNode.port || LOCAL_NODE_PORT;
  const alreadyMsg = '本地游戏服已在运行中（门户仅允许启动单个本地游戏服）';
  if (localNode.running && localNode.child && localNode.child.exitCode === null) {
    return { ok: true, alreadyRunning: true, pid: localNode.child.pid, port: localNode.port, message: alreadyMsg };
  }
  const open = await portProbe(p);
  if (open) {
    const recent = recentNodeOnPort(p);
    if (recent) {
      localNode.running = true; localNode.external = true; localNode.port = p;
      localNode.startedAt = localNode.startedAt || Date.now(); localNode.lastSeen = Date.now();
      return { ok: true, alreadyRunning: true, adopted: true, external: true, pid: null, port: p, message: alreadyMsg };
    }
  }
  const inst = await ensureNodeInstalled(LOCAL_NODE_ID, downloadUrl);
  localNode.dir = inst.dir; localNode.serverPath = inst.serverPath; localNode.configPath = inst.configPath;
  const cfg = buildNodeConfig(LOCAL_NODE_ID, p);
  fs.writeFileSync(inst.configPath, JSON.stringify(cfg, null, 2), 'utf8');
  const child = child_process.spawn(process.execPath, [inst.serverPath, '--config', inst.configPath], {
    cwd: inst.dir,
    env: Object.assign({}, process.env, { PORT: String(p), NODE_SECRET: NODE_SECRET, PORTAL_URL: selfPortalUrl() })
  });
  localNode.child = child; localNode.running = true; localNode.external = false; localNode.port = p;
  localNode.startedAt = Date.now(); localNode.logs = []; localNode.exitCode = null;
  const onData = (buf) => { localNode.logs.push(String(buf)); if (localNode.logs.length > 200) localNode.logs.splice(0, localNode.logs.length - 200); };
  if (child.stdout) child.stdout.on('data', onData);
  if (child.stderr) child.stderr.on('data', onData);
  child.on('exit', (code) => { localNode.running = false; localNode.exitCode = code; });
  return { ok: true, nodeId: LOCAL_NODE_ID, pid: child.pid, port: p, started: true };
}
function stopLocalNode() {
  if (!localNode.running && !localNode.child) return { ok: true, alreadyStopped: true };
  if (localNode.external) { localNode.running = false; localNode.external = false; return { ok: true, external: true, message: '外部节点未由门户托管，仅解除纳管' }; }
  const pid = localNode.child ? localNode.child.pid : null;
  try { if (localNode.child) localNode.child.kill('SIGTERM'); } catch (e) {}
  localNode.running = false;
  return { ok: true, pid: pid };
}
async function restartLocalNode(port, downloadUrl) {
  stopLocalNode();
  await new Promise((r) => setTimeout(r, 400));
  return await ensureLocalNode(port, downloadUrl);
}

let db = emptyDb();

function normalizeDb(raw) {
  const d = emptyDb();
  if (raw && typeof raw === 'object') {
    if (Array.isArray(raw.users)) {
      for (const u of raw.users) if (u && u.uid) d.users[u.uid] = u;
    } else if (raw.users && typeof raw.users === 'object') {
      d.users = raw.users;
    }
    if (Array.isArray(raw.bannedIps)) d.bannedIps = raw.bannedIps.filter((x) => typeof x === 'string');
    if (raw.nodes && typeof raw.nodes === 'object') d.nodes = raw.nodes;
    if (raw.rooms && typeof raw.rooms === 'object') d.rooms = raw.rooms;
    if (raw.config && typeof raw.config === 'object') d.config = Object.assign({}, DEFAULT_CONFIG, raw.config);
    if (Array.isArray(raw.controlQueue)) d.controlQueue = raw.controlQueue;
    if (raw.meta && typeof raw.meta === 'object') d.meta = raw.meta;
  }
  return d;
}

function loadDb() {
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf8');
    db = normalizeDb(JSON.parse(raw));
  } catch (e) {
    db = emptyDb();
  }
  return db;
}

/** 内存态 → data/portal-db.json 原子写（临时文件 + rename）。 */
function save() {
  const dir = path.dirname(DB_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = DB_PATH + '.tmp-' + process.pid + '-' + Date.now().toString(36);
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_PATH);
}

/* ------------------------------- 工具函数 ------------------------------ */

function sha256(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), String(salt), 32).toString('hex');
}

function verifyPassword(password, salt, passHash) {
  if (typeof password !== 'string' || !salt || !passHash) return false;
  const got = crypto.scryptSync(password, String(salt), 32);
  let want;
  try { want = Buffer.from(String(passHash), 'hex'); } catch (e) { return false; }
  if (want.length !== got.length) return false;
  return crypto.timingSafeEqual(got, want);
}

/** 规范化恢复码：去空格/连字符、大写；12 位时重新分组为 XXXX-XXXX-XXXX。 */
function canonicalRecoveryCode(code) {
  const cleaned = String(code == null ? '' : code).toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (cleaned.length === 12) return cleaned.slice(0, 4) + '-' + cleaned.slice(4, 8) + '-' + cleaned.slice(8, 12);
  return cleaned;
}

/**
 * 生成 12 位高熵恢复码 XXXX-XXXX-XXXX。
 * 用 crypto.randomBytes(9)（72 bit）取高 60 bit，每 5 bit 映射到 32 字符集（无取模偏置）。
 */
function generateRecoveryCode() {
  const buf = crypto.randomBytes(9);
  let bits = 0n;
  for (let i = 0; i < buf.length; i++) bits = (bits << 8n) | BigInt(buf[i]);
  let raw = '';
  for (let i = 0; i < 12; i++) {
    const idx = Number((bits >> BigInt((11 - i) * 5)) & 31n);
    raw += RECOVERY_CHARSET[idx];
  }
  return raw.slice(0, 4) + '-' + raw.slice(4, 8) + '-' + raw.slice(8, 12);
}

function randomId(prefix, bytes) {
  return prefix + crypto.randomBytes(bytes).toString('hex');
}

function isIpBanned(ip) {
  return Array.isArray(db.bannedIps) && db.bannedIps.indexOf(ip) !== -1;
}

function clientIp(req) {
  let ip = (req && req.socket && req.socket.remoteAddress) || 'unknown';
  if (ip.indexOf('::ffff:') === 0) ip = ip.slice(7); // IPv4-mapped IPv6
  return ip;
}

function findUserByUsername(username) {
  const key = String(username == null ? '' : username).trim().toLowerCase();
  for (const uid of Object.keys(db.users)) {
    const u = db.users[uid];
    if (u && String(u.username).trim().toLowerCase() === key) return u;
  }
  return null;
}

function findUserByToken(token) {
  const t = String(token == null ? '' : token);
  if (!t) return null;
  for (const uid of Object.keys(db.users)) {
    const u = db.users[uid];
    if (u && u.activeSession && u.activeSession === t) return u;
  }
  return null;
}

function publicUser(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    username: u.username,
    role: u.role,
    banned: !!u.banned,
    createdAt: u.createdAt || null,
    activeRoom: u.currentRoom || null
  };
}

/** 创建用户记录（注册 / 首启管理员共用）。 */
function createUserRecord(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const recoveryCode = generateRecoveryCode();
  const user = {
    uid: randomId('u_', 8),
    username: username,
    passHash: hashPassword(password, salt),
    salt: salt,
    recoveryHash: sha256(canonicalRecoveryCode(recoveryCode)),
    role: role === 'admin' ? 'admin' : 'user',
    banned: false,
    createdAt: Date.now(),
    activeSession: null,
    currentRoom: null
  };
  db.users[user.uid] = user;
  return { user, recoveryCode };
}

/** Task H1: 首次启动管理员初始化（.env 管理员 / 随机 bootstrapToken）。 */
function initAdminBootstrap() {
  if (Object.keys(db.users).length > 0) { bootstrapToken = null; return null; }
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASS;
  if (adminUser && adminPass) {
    const made = createUserRecord(String(adminUser), String(adminPass), 'admin');
    save();
    console.log('[PORTAL] 已从 .env 初始化管理员账号: ' + made.user.username + ' · 恢复码: ' + made.recoveryCode);
    return made.user;
  }
  bootstrapToken = crypto.randomBytes(16).toString('hex');
  console.log('================================================================');
  console.log('[PORTAL BOOTSTRAP] 尚未检测到任何账户！');
  console.log('请在网页「创建首个管理员账号」界面输入以下一次性服务端随机令牌：');
  console.log('BOOTSTRAP_TOKEN: ' + bootstrapToken);
  console.log('================================================================');
  return null;
}

/** base64url 无填充。 */
function b64url(input) {
  return Buffer.from(String(input), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  return Buffer.from(t, 'base64').toString('utf8');
}

function hmacHex(data, secret) {
  return crypto.createHmac('sha256', String(secret == null ? NODE_SECRET : secret)).update(String(data), 'utf8').digest('hex');
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(String(a), 'hex');
    const bb = Buffer.from(String(b), 'hex');
    if (!ba.length || ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch (e) { return false; }
}

/** 入房票据：base64url(JSON payload) + '.' + HMAC-SHA256(payloadB64, NODE_SECRET)，hex。 */
function signTicket(payload) {
  const b64 = b64url(JSON.stringify(payload));
  return b64 + '.' + hmacHex(b64);
}

function verifyTicket(ticket, secret) {
  const s = String(ticket == null ? '' : ticket);
  const dot = s.lastIndexOf('.');
  if (dot <= 0) return null;
  const b64 = s.slice(0, dot);
  const sig = s.slice(dot + 1).toLowerCase();
  if (!safeEqualHex(sig, hmacHex(b64, secret))) return null;
  try {
    const payload = JSON.parse(fromB64url(b64));
    if (!payload || typeof payload !== 'object') return null;
    if (!payload.exp || Number(payload.exp) <= Date.now()) return null;
    return payload;
  } catch (e) { return null; }
}

/* ---------------------------- 限流 / 控制队列 --------------------------- */

const resetHits = new Map(); // ip -> [ts]

/** 滑动窗口限流：返回 false 表示超限（超限请求不计数，保持窗口内锁定）。 */
function resetAllowed(ip) {
  const now = Date.now();
  let arr = resetHits.get(ip) || [];
  arr = arr.filter((t) => now - t < RESET_WINDOW_MS);
  if (arr.length >= RESET_MAX) { resetHits.set(ip, arr); return false; }
  arr.push(now);
  resetHits.set(ip, arr);
  return true;
}

function pushControl(evt) {
  if (!Array.isArray(db.controlQueue)) db.controlQueue = [];
  db.controlQueue.push(Object.assign({ at: Date.now() }, evt));
  while (db.controlQueue.length > CONTROL_QUEUE_MAX) db.controlQueue.shift();
}

/** 心跳时取出待下发的控制指令（当前实现为广播队列，取出即清空）。 */
function drainControls(nodeId) {
  if (!Array.isArray(db.controlQueue) || !db.controlQueue.length) return [];
  const all = db.controlQueue;
  db.controlQueue = [];
  return all.filter((c) => !c.nodeId || c.nodeId === nodeId);
}

/* ------------------------------ HTTP 辅助 ------------------------------ */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-node-sig',
    'Access-Control-Max-Age': '600'
  };
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }, corsHeaders()));
  res.end(body);
}

function fail(res, status, code, message) {
  send(res, status, { ok: false, error: code, message: message || code });
}

function readRaw(req, limit) {
  return new Promise((resolve, reject) => {
    const max = limit || MAX_BODY;
    const chunks = [];
    let len = 0;
    req.on('data', (c) => {
      len += c.length;
      if (len > max) {
        const e = new Error('payload_too_large');
        e.status = 413; e.code = 'payload_too_large';
        reject(e);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (e) => { e.status = e.status || 400; e.code = e.code || 'bad_request'; reject(e); });
  });
}

/** Task H1: 托管 public/ 静态前端（仅 GET/HEAD 非 api/internal/health 走这里）。 */
function serveStatic(req, res, pathname, method) {
  let rel = pathname;
  try { rel = decodeURIComponent(rel); } catch (e) { rel = pathname; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const fp = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, ''));
  if (!fp.startsWith(PUBLIC_DIR)) return false;
  let st;
  try { st = fs.statSync(fp); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const ext = path.extname(fp).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
  });
  if (method === 'HEAD') { res.end(); return true; }
  fs.createReadStream(fp).on('error', () => { try { res.destroy(); } catch (e) {} }).pipe(res);
  return true;
}

async function readJson(req) {
  const raw = await readRaw(req);
  if (!raw) return {};
  let obj;
  try { obj = JSON.parse(raw); } catch (e) {
    const err = new Error('请求体不是合法 JSON');
    err.status = 400; err.code = 'invalid_json';
    throw err;
  }
  return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : {};
}

function bearerToken(req) {
  const h = String((req.headers && req.headers.authorization) || '').trim();
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** 校验 Bearer 会话 → { ok, user, token } 或 { ok:false, status, error }。 */
function requireAuth(req) {
  const ip = clientIp(req);
  if (isIpBanned(ip)) return { ok: false, status: 403, error: 'ip_banned' };
  const token = bearerToken(req);
  if (!token) return { ok: false, status: 401, error: 'missing_token' };
  const user = findUserByToken(token);
  if (!user) return { ok: false, status: 401, error: 'invalid_token' };
  if (user.banned) return { ok: false, status: 403, error: 'account_banned' };
  return { ok: true, user, token };
}

function requireAdmin(req) {
  const a = requireAuth(req);
  if (!a.ok) return a;
  if (a.user.role !== 'admin') return { ok: false, status: 403, error: 'forbidden_admin' };
  return a;
}

/* ---------------- Stage5.4 §5.1: dynamic hidden admin path ---------------- */
const RESERVED_PATH_PREFIXES = ['/api', '/internal', '/ws', '/assets', '/health'];
const DEFAULT_ADMIN_PATH = '/qaqmin';
function normAdminPath(raw) {
  let p = String(raw == null ? '' : raw).trim();
  if (!p) return DEFAULT_ADMIN_PATH;
  if (p[0] !== '/') p = '/' + p;
  p = p.replace(/\/+$/, '');
  if (!p || p === '/') return DEFAULT_ADMIN_PATH;
  for (const pre of RESERVED_PATH_PREFIXES) {
    if (p === pre || p.indexOf(pre + '/') === 0) return DEFAULT_ADMIN_PATH;
  }
  return p;
}
function currentAdminPath() { return normAdminPath(db && db.config ? db.config.adminPath : DEFAULT_ADMIN_PATH); }

/* Stage5.4 §5.1: self-contained admin console page (no external assets). */
const ADMIN_CONSOLE_HTML = "<!doctype html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>星海边境 · 管理控制台</title>\n<style>\n*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 18% 8%,#0a2434,#03070d 62%);color:#d9f2ff;font:13px/1.6 system-ui,\"Noto Sans SC\",sans-serif}\n.wrap{max-width:1120px;margin:0 auto;padding:26px 20px 60px}\n.brand{font-size:19px;letter-spacing:4px;color:#6ee7ff;text-shadow:0 0 16px rgba(0,255,255,.35)}\n.brand small{display:block;font-size:11px;letter-spacing:2px;color:#5d93a6;margin-top:4px}\n.card{background:rgba(5,20,32,.74);border:1px solid rgba(64,220,255,.24);border-radius:14px;padding:16px;margin:14px 0;box-shadow:0 0 26px rgba(0,170,255,.10);backdrop-filter:blur(10px)}\nh3{margin:2px 0 12px;color:#68d7ef;font-weight:600;letter-spacing:1px;font-size:14px}\nlabel{display:block;color:#8ec9dd;margin:6px 0 3px;font-size:12px}\ninput,select,textarea{font:inherit;padding:7px 10px;border-radius:8px;border:1px solid #1d6075;background:#06141d;color:#dff;outline:none;width:100%}\nbutton{font:inherit;cursor:pointer;padding:8px 14px;border-radius:9px;border:1px solid #26a6c7;background:linear-gradient(180deg,#0c4052,#07222e);color:#dff}\nbutton:hover{border-color:#6ee7ff;box-shadow:0 0 14px rgba(0,255,255,.25)}\n.row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}.row>div{flex:1 1 180px}\n.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}\n.k{color:#7fc9da;font-size:12px}.v{color:#eaffff;font-weight:600}\n.ok{color:#8cffbe}.err{color:#ff9c9c}.muted{color:#6f9dae;font-size:12px}\npre{white-space:pre-wrap;max-height:260px;overflow:auto;background:#020b10;border:1px solid #123b49;border-radius:8px;padding:10px;color:#9fdfea;font-size:12px;margin:0}\ntable{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid rgba(60,160,190,.18)}th{color:#7fc9da;font-weight:600}\n.pill{background:#0a3342;border:1px solid #1b7b93;border-radius:999px;padding:1px 8px;font-size:11px}\n.hint{color:#6f9dae;font-size:12px;margin:4px 0 10px}\n</style></head><body><div class=\"wrap\">\n<div class=\"brand\">ORBITAL FRONTIER · 管理控制台<small>PORTAL ADMIN CONSOLE · 与游戏大厅完全隔离</small></div>\n<div class=\"card\" id=\"loginCard\"><h3>管理员登录</h3><div class=\"row\"><div><label>用户名</label><input id=\"lgUser\" autocomplete=\"username\"></div><div><label>密码</label><input id=\"lgPass\" type=\"password\" autocomplete=\"current-password\"></div><button onclick=\"doLogin()\">登录</button><span id=\"lgMsg\"></span></div><div class=\"hint\">仅 role=admin 账户可进入；登录态保存在本标签页 sessionStorage。</div></div>\n<div id=\"panel\" style=\"display:none\">\n<div class=\"card\"><h3>① 系统与反向代理</h3>\n<div class=\"row\"><div><label>反代模式</label><select id=\"cfgMode\"><option value=\"builtin\">门户内置 /ws 代理（推荐）</option><option value=\"prefix\">子路径反代（如 /yxapi）</option><option value=\"direct\">独立域名 / 端口直连</option></select></div><div><label>子路径前缀</label><input id=\"cfgPrefix\" placeholder=\"/yxapi\"></div><div><label>独立 WS 地址</label><input id=\"cfgWs\" placeholder=\"ws://host:8787/ws\"></div></div>\n<div class=\"row\"><div><label>管理面板路径 adminPath</label><input id=\"cfgAdminPath\" placeholder=\"/qaqmin\"></div><div><label>公开注册</label><select id=\"cfgAllowReg\"><option value=\"true\">允许</option><option value=\"false\">关闭</option></select></div><div><label>节点排空 draining</label><select id=\"cfgDraining\"><option value=\"false\">关闭</option><option value=\"true\">开启</option></select></div></div>\n<div><label>大厅公告 announcement</label><textarea id=\"cfgAnnounce\" rows=\"2\" placeholder=\"星域公告（大厅顶部滚动显示）\"></textarea></div>\n<div class=\"row\" style=\"margin-top:12px\"><button onclick=\"saveSystem()\">保存系统配置</button><span id=\"sysMsg\"></span></div></div>\n<div class=\"card\"><h3>② 本地受管游戏服（单实例）</h3><div class=\"hint\">门户本地仅托管 1 个游戏服实例；扩容请在独立服务器运行 server.js 并通过心跳接入。</div>\n<div class=\"row\"><div><label>监听端口</label><input id=\"ndPort\" type=\"number\" value=\"8787\"></div><div><label>更新源 URL（留空用门户内置镜像）</label><input id=\"ndSrc\" placeholder=\"下载源 URL（可留空使用内置镜像）\"></div></div>\n<div class=\"row\" style=\"margin-top:12px\"><button onclick=\"nodeStart()\">一键初始化并启动</button><button onclick=\"nodeRestart()\">重启</button><button onclick=\"nodeStop()\">停止</button><button onclick=\"openNodeAdmin()\">打开游戏服独立面板</button><span id=\"ndMsg\"></span></div>\n<div class=\"grid\" id=\"ndState\" style=\"margin-top:12px\"></div>\n<label style=\"margin-top:12px\">实时控制台日志</label><pre id=\"ndLog\">（未启动）</pre></div>\n<div class=\"card\"><h3>③ 账户与安全</h3>\n<div class=\"row\"><div><label>搜索指挥官</label><input id=\"usSearch\" placeholder=\"用户名 / uid\" oninput=\"renderUsers()\"></div><div><label>新建用户名</label><input id=\"cuName\" placeholder=\"2-12 字符\"></div><div><label>初始密码</label><input id=\"cuPass\" type=\"password\"></div><div><label>角色</label><select id=\"cuRole\"><option value=\"user\">user</option><option value=\"admin\">admin</option></select></div><button onclick=\"createUser()\">创建账号</button><span id=\"cuMsg\"></span></div>\n<div class=\"row\" style=\"margin-top:10px\"><div><label>封禁 IP</label><input id=\"banIp\" placeholder=\"1.2.3.4\"></div><button onclick=\"banIp()\">封禁该 IP</button><span id=\"ipMsg\"></span></div>\n<div style=\"margin-top:14px;overflow:auto\"><table><thead><tr><th>用户名</th><th>UID</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody id=\"usBody\"></tbody></table></div>\n<div id=\"ipList\" class=\"muted\" style=\"margin-top:10px\"></div></div>\n<div class=\"card\"><button onclick=\"doLogout()\">退出登录</button><span id=\"outMsg\" class=\"muted\"></span></div>\n</div></div>\n<script>\nvar TOKEN=sessionStorage.getItem(\"of.adminToken\")||\"\";var USERS=[];var NODE=null;var CFG={};\nfunction $(id){return document.getElementById(id)}\nfunction msg(id,t,ok){var e=$(id);if(e){e.textContent=t||\"\";e.className=ok?\"ok\":\"err\";}}\nfunction authHeaders(){return {\"content-type\":\"application/json\",authorization:\"Bearer \"+TOKEN}}\nfunction jget(u){return fetch(u,{headers:authHeaders()}).then(function(r){return r.json().then(function(j){j.__s=r.status;return j})})}\nfunction jpost(u,b){return fetch(u,{method:\"POST\",headers:authHeaders(),body:JSON.stringify(b||{})}).then(function(r){return r.json().then(function(j){j.__s=r.status;return j})})}\nfunction doLogin(){var u=$(\"lgUser\").value,p=$(\"lgPass\").value;fetch(\"/api/login\",{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({username:u,password:p})}).then(function(r){return r.json()}).then(function(j){if(j.ok&&j.sessionToken){if(j.role!==\"admin\"){msg(\"lgMsg\",\"该账号不是管理员\",false);return;}TOKEN=j.sessionToken;sessionStorage.setItem(\"of.adminToken\",TOKEN);enter();}else msg(\"lgMsg\",j.message||j.error||\"登录失败\",false);});}\nfunction doLogout(){TOKEN=\"\";sessionStorage.removeItem(\"of.adminToken\");location.reload();}\nfunction enter(){$(\"loginCard\").style.display=\"none\";$(\"panel\").style.display=\"block\";loadStatus();loadNode();loadUsers();}\nfunction loadStatus(){fetch(\"/api/portal/status\").then(function(r){return r.json()}).then(function(j){CFG=j||{};var mode=j.proxyPrefix?\"prefix\":(j.gamePublicWsUrl?\"direct\":\"builtin\");$(\"cfgMode\").value=mode;$(\"cfgPrefix\").value=j.proxyPrefix||\"\";$(\"cfgWs\").value=j.gamePublicWsUrl||\"\";$(\"cfgAdminPath\").value=j.adminPath||\"/qaqmin\";$(\"cfgAllowReg\").value=(j.allowRegistration===false?\"false\":\"true\");$(\"cfgDraining\").value=(j.draining===true?\"true\":\"false\");$(\"cfgAnnounce\").value=j.announcement||\"\";});}\nfunction saveSystem(){var mode=$(\"cfgMode\").value;var cfg={adminPath:$(\"cfgAdminPath\").value,allowRegistration:$(\"cfgAllowReg\").value===\"true\",announcement:$(\"cfgAnnounce\").value,draining:$(\"cfgDraining\").value===\"true\"};if(mode===\"prefix\"){cfg.proxyPrefix=$(\"cfgPrefix\").value;}else if(mode===\"builtin\"){cfg.proxyPrefix=\"\";cfg.gamePublicWsUrl=\"\";cfg.gamePublicApiUrl=\"\";}else{cfg.proxyPrefix=\"\";cfg.gamePublicWsUrl=$(\"cfgWs\").value;cfg.gamePublicApiUrl=\"\";}jpost(\"/api/admin/config\",{config:cfg}).then(function(j){if(j.__s===200&&j.ok){var np=j.adminPath||(j.config&&j.config.adminPath)||\"/qaqmin\";msg(\"sysMsg\",\"已保存 · 新地址：\"+np+\"，请手动访问\",true);loadStatus();}else msg(\"sysMsg\",j.error||j.message||\"保存失败\",false);});}\nfunction loadNode(){jget(\"/api/admin/node-manager/status\").then(function(j){NODE=j;var n=j.localNode||{};var html=[[\"状态\",n.running?\"● 在线运行中\":\"○ 未启动\"],[\"PID\",n.pid||\"-\"],[\"端口\",n.port||\"-\"],[\"托管\",n.external?\"外部纳管\":\"门门户子进程\"]].map(function(x){return \"<div><div class=k>\"+x[0]+\"</div><div class=v>\"+x[1]+\"</div></div>\"}).join(\"\");$(\"ndState\").innerHTML=html;$(\"ndLog\").textContent=(n.logTail||n.logs||\"\")||\"（未启动）\";var ext=(j.externalNodes||[]);if(ext.length){$(\"ndState\").innerHTML+=\"<div><div class=k>已接入外部节点</div><div class=v>\"+ext.map(function(e){return e.nodeId}).join(\", \")+\"</div></div>\";}});}\nfunction nodePort(){return Number($(\"ndPort\").value)||8787}\nfunction nodeStart(){msg(\"ndMsg\",\"启动中…\",true);jpost(\"/api/admin/node-manager/start\",{port:nodePort(),downloadUrl:$(\"ndSrc\").value}).then(function(j){msg(\"ndMsg\",j.ok?(j.alreadyRunning?(j.message||\"已在运行\"):(\"已启动 · PID \"+(j.pid||\"-\"))):(j.message||j.error||\"启动失败\"),!!j.ok);setTimeout(loadNode,900);});}\nfunction nodeRestart(){msg(\"ndMsg\",\"重启中…\",true);jpost(\"/api/admin/node-manager/restart\",{port:nodePort(),downloadUrl:$(\"ndSrc\").value}).then(function(j){msg(\"ndMsg\",j.ok?\"已重启\":(j.message||j.error||\"重启失败\"),!!j.ok);setTimeout(loadNode,1200);});}\nfunction nodeStop(){jpost(\"/api/admin/node-manager/stop\",{}).then(function(j){msg(\"ndMsg\",j.ok?\"已停止\":(j.message||j.error||\"停止失败\"),!!j.ok);setTimeout(loadNode,600);});}\nfunction openNodeAdmin(){var n=(NODE&&NODE.localNode)||{};var sso=(NODE&&NODE.ssoTicket)||\"\";var prefix=(CFG&&CFG.proxyPrefix)||\"\";var port=n.port||nodePort();var url=prefix?(prefix+\"/admin?sso=\"+encodeURIComponent(sso)):(\"http://\"+location.hostname+\":\"+port+\"/admin?sso=\"+encodeURIComponent(sso));window.open(url,\"_blank\");}\nfunction loadUsers(){jget(\"/api/admin/users\").then(function(j){USERS=(j.users||[]);renderUsers();var ips=j.bannedIps||[];$(\"ipList\").textContent=ips.length?(\"已封禁 IP：\"+ips.join(\", \")):\"暂无封禁 IP\";});}\nfunction esc(s){return String(s==null?'':s).replace(/[&<>\"']/g,function(c){if(c==='&')return '&amp;';if(c==='<')return '&lt;';if(c==='>')return '&gt;';if(c==='\"')return '&quot;';return '&#39;';})}\nfunction renderUsers(){\n  var q = ($('usSearch').value || '').toLowerCase();\n  var rows = USERS.filter(function(u){ return !q || String(u.username||'').toLowerCase().indexOf(q) >= 0 || String(u.uid||'').indexOf(q) >= 0; });\n  $('usBody').innerHTML = rows.map(function(u){\n    var st = u.banned ? '<span class=err>已封禁</span>' : '<span class=ok>正常</span>';\n    var btn = '<button data-act=reset data-uid=\"' + esc(u.uid) + '\">重置密码</button> '\n      + '<button data-act=ban data-uid=\"' + esc(u.uid) + '\" data-ban=\"' + (u.banned ? 'false' : 'true') + '\">' + (u.banned ? '解封' : '封号') + '</button> '\n      + '<button data-act=del data-uid=\"' + esc(u.uid) + '\" data-name=\"' + esc(u.username) + '\">删除</button>';\n    return '<tr><td>' + esc(u.username) + '</td><td class=muted>' + esc(u.uid) + '</td><td><span class=pill>' + esc(u.role||'user') + '</span></td><td>' + st + '</td><td>' + btn + '</td></tr>';\n  }).join('') || '<tr><td colspan=5 class=muted>无匹配账户</td></tr>';\n}\ndocument.addEventListener('click', function(e){\n  var b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;\n  if (!b) return;\n  var a = b.getAttribute('data-act'), uid = b.getAttribute('data-uid');\n  if (a === 'reset') resetPwd(uid);\n  else if (a === 'ban') toggleBan(uid, b.getAttribute('data-ban') === 'true');\n  else if (a === 'del') delUser(uid, b.getAttribute('data-name'));\n});\nfunction createUser(){var u=$(\"cuName\").value,p=$(\"cuPass\").value,r=$(\"cuRole\").value;if(!u||!p){msg(\"cuMsg\",\"请填写用户名与密码\",false);return;}jpost(\"/api/admin/create-user\",{username:u,password:p,role:r}).then(function(j){if(j.__s===200&&j.ok){msg(\"cuMsg\",\"已创建 \"+j.username+\" · 恢复码 \"+j.recoveryCode,true);loadUsers();}else msg(\"cuMsg\",j.error||j.message||\"创建失败\",false);});}\nfunction resetPwd(uid){var np=\"OF\"+Math.random().toString(36).slice(2,10)+\"!\";jpost(\"/api/admin/reset-password\",{uid:uid,newPassword:np}).then(function(j){if(j.__s===200&&j.ok){alert(\"临时密码：\"+np+\"\\n新恢复码：\"+(j.recoveryCode||\"-\"));loadUsers();}else alert(j.error||j.message||\"重置失败\");});}\nfunction toggleBan(uid,ban){jpost(\"/api/admin/ban\",{uid:uid,ban:ban}).then(function(j){if(j.__s===200&&j.ok)loadUsers();else alert(j.error||j.message||\"操作失败\");});}\nfunction banIp(){var ip=$(\"banIp\").value.trim();if(!ip){msg(\"ipMsg\",\"请输入 IP\",false);return;}jpost(\"/api/admin/ban\",{ip:ip,ban:true}).then(function(j){msg(\"ipMsg\",j.__s===200&&j.ok?\"已封禁 \"+ip:(j.error||\"失败\"),j.__s===200&&j.ok);if(j.__s===200&&j.ok){$(\"banIp\").value=\"\";loadUsers();}});}\nfunction delUser(uid,name){if(!confirm(\"确定删除账号 \"+name+\" ？该操作不可恢复。\"))return;jpost(\"/api/admin/delete-user\",{uid:uid}).then(function(j){if(j.__s===200&&j.ok)loadUsers();else alert(j.error||j.message||\"删除失败\");});}\n(function(){if(TOKEN){jget(\"/api/admin/users\").then(function(j){if(j.__s===200)enter();});}})();\n</script></body></html>\n";

/** K3: hide finished/closed rooms and label full/closing rooms with a readable reason. */
function normalizeRoomRow(room) {
  if (!room || typeof room !== 'object' || !room.roomId) return null;
  if (room.status === 'settled' || room.status === 'destroyed' || room.settled === true) return null;
  const out = Object.assign({}, room);
  const maxP = Number(room.maxPlayers);
  const humans = Number(room.humans);
  if (room.status === 'closing' || room.noJoin === true) { out.canJoin = false; out.reason = '决战禁入'; }
  else if (Number.isFinite(maxP) && maxP > 0 && Number.isFinite(humans) && humans >= maxP) { out.canJoin = false; out.reason = '已满员'; }
  else if (out.canJoin === undefined) { out.canJoin = (room.status === 'running' || room.status === 'waiting' || room.status === 'open'); }
  return out;
}

/** 收集版本匹配且未排空的节点上的房间（含门户侧登记房 + 灰置无尽入口）。 */
function listRooms() {
  const out = [];
  const seen = new Set();
  const pushRoom = (room, extra) => {
    const norm = normalizeRoomRow(room);
    if (!norm) return;
    const id = String(norm.roomId);
    if (seen.has(id)) return;
    seen.add(id);
    out.push(Object.assign({}, norm, extra));
  };
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    if (!n || n.versionMismatch) continue;   // 版本不一致：拒绝纳入可用列表
    if (n.draining) continue;                // 排空节点：只出不进
    const rooms = Array.isArray(n.rooms) ? n.rooms : [];
    for (const r of rooms) pushRoom(r, { nodeId: n.nodeId, nodeUrl: n.url || null, wsUrl: n.wsUrl || null, origin: 'node' });
  }
  for (const roomId of Object.keys(db.rooms || {})) {
    const r = db.rooms[roomId];
    if (r && r.status !== 'destroyed') pushRoom(r, { origin: r.origin || 'portal', wsUrl: r.wsUrl || DEFAULT_GAME_WS });
  }
  // 无尽模式：灰置入口（不占用参赛席位）
  if (!seen.has('endless')) {
    out.push({ roomId: 'endless', mode: 'endless', name: '无尽模式', status: 'locked', locked: true, canJoin: false, origin: 'portal' });
  }
  return out;
}

function findRoom(roomId) {
  if (!roomId) return null;
  if (db.rooms && db.rooms[roomId]) return db.rooms[roomId];
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    if (!n || !Array.isArray(n.rooms)) continue;
    for (const r of n.rooms) if (r && String(r.roomId) === String(roomId)) return Object.assign({}, r, { nodeId: n.nodeId, wsUrl: n.wsUrl || null });
  }
  return null;
}

function pickHealthyNode() {
  for (const nodeId of Object.keys(db.nodes)) {
    const n = db.nodes[nodeId];
    if (n && !n.versionMismatch && !n.draining) return n;
  }
  return null;
}

/* --------------------------------- 处理器 ------------------------------- */

async function app(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); }
  catch (e) { return fail(res, 400, 'bad_url'); }
  let p = url.pathname || '/';
  if (p.length > 1 && p.endsWith('/')) p = p.replace(/\/+$/, '');
  const method = req.method || 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  try {
    /* ---------------------------- 健康/版本 ---------------------------- */
    if ((p === '/health' || p === '/api/portal/status') && method === 'GET') {
      return send(res, 200, {
        ok: true,
        name: '星海边境 · ORBITAL FRONTIER Portal',
        version: PORTAL_VERSION,
        nodeSecretConfigured: NODE_SECRET !== 'orbital-frontier-dev-secret',
        users: Object.keys(db.users).length,
        nodes: Object.keys(db.nodes).length,
        nodeList: Object.values(db.nodes).map((n) => ({ nodeId: n.nodeId, url: n.url, wsUrl: n.wsUrl, version: n.version, draining: !!n.draining, versionMismatch: !!n.versionMismatch, lastSeen: n.lastSeen })),
        gamePublicWsUrl: db.config.gamePublicWsUrl || '',
        gamePublicApiUrl: db.config.gamePublicApiUrl || '',
        proxyPrefix: db.config.proxyPrefix || '',
        adminPath: currentAdminPath(),
        nodeDownloadUrl: db.config.nodeDownloadUrl || '',
        allowRegistration: db.config.allowRegistration !== false,
        announcement: db.config.announcement || '',
        time: Date.now()
      });
    }

    /* -------------------- 首启状态 / 首个管理员创建 (H1) ------------------- */
    if (p === '/api/bootstrap/status' && method === 'GET') {
      return send(res, 200, { ok: true, initialized: Object.keys(db.users).length > 0 });
    }

    if (p === '/api/bootstrap/init' && method === 'POST') {
      if (Object.keys(db.users).length > 0) return fail(res, 409, 'already_initialized', '系统已完成初始化');
      const body = await readJson(req);
      const token = String(body.token == null ? '' : body.token).trim();
      if (!bootstrapToken || !safeEqualHex(token, bootstrapToken)) {
        return fail(res, 403, 'invalid_bootstrap_token', '服务端随机令牌错误');
      }
      const username = String(body.username == null ? '' : body.username).trim();
      const password = String(body.password == null ? '' : body.password);
      const nameLen = Array.from(username).length;
      if (nameLen < 2 || nameLen > 12) return fail(res, 400, 'invalid_username', '用户名需为 2-12 个字符');
      if (!password) return fail(res, 400, 'invalid_password', '密码不能为空');
      const made = createUserRecord(username, password, 'admin');
      const sessionToken = randomId('st_', 32);
      made.user.activeSession = sessionToken;
      made.user.lastLoginAt = Date.now();
      made.user.lastIp = clientIp(req);
      bootstrapToken = null; // 一次性令牌立即作废
      save();
      return send(res, 200, {
        ok: true,
        uid: made.user.uid,
        username: made.user.username,
        role: 'admin',
        sessionToken: sessionToken,
        recoveryCode: made.recoveryCode
      });
    }

    /* ------------------------------- 注册 ------------------------------ */
    if (p === '/api/register' && method === 'POST') {
      // B-S4-1: no unauthorised first-account signup before bootstrap admin exists.
      if (Object.keys(db.users).length === 0) {
        return fail(res, 403, 'bootstrap_required', '系统尚未完成首次管理员初始化，请先使用控制台令牌创建管理员');
      }
      if (db.config && db.config.allowRegistration === false) {
        return fail(res, 403, 'registration_disabled', '管理员已关闭公开注册，请联系管理员创建账号');
      }
      const body = await readJson(req);
      const username = String(body.username == null ? '' : body.username).trim();
      const password = String(body.password == null ? '' : body.password);
      const nameLen = Array.from(username).length;
      if (nameLen < 2 || nameLen > 12) return fail(res, 400, 'invalid_username', '用户名需为 2-12 个字符');
      if (!password) return fail(res, 400, 'invalid_password', '密码不能为空');
      if (findUserByUsername(username)) return fail(res, 409, 'username_taken', '用户名已被占用');

      const salt = crypto.randomBytes(16).toString('hex');
      const recoveryCode = generateRecoveryCode();
      const user = {
        uid: randomId('u_', 8),
        username: username,
        passHash: hashPassword(password, salt),
        salt: salt,
        recoveryHash: sha256(canonicalRecoveryCode(recoveryCode)),
        role: 'user',
        banned: false,
        createdAt: Date.now(),
        activeSession: null,
        currentRoom: null
      };
      db.users[user.uid] = user;
      save();
      return send(res, 200, {
        ok: true,
        uid: user.uid,
        username: user.username,
        role: user.role,
        recoveryCode: recoveryCode,
        notice: '恢复码仅明文返回一次，请立即妥善保管'
      });
    }

    /* ------------------------------- 登录 ------------------------------ */
    if (p === '/api/login' && method === 'POST') {
      const ip = clientIp(req);
      const body = await readJson(req);
      const username = String(body.username == null ? '' : body.username).trim();
      const password = String(body.password == null ? '' : body.password);
      if (isIpBanned(ip)) return fail(res, 403, 'ip_banned', '该 IP 已被封禁');
      const user = findUserByUsername(username);
      if (!user) return fail(res, 401, 'invalid_credentials', '账号或密码错误');
      if (user.banned) return fail(res, 403, 'account_banned', '该账号已被封禁');
      if (!verifyPassword(password, user.salt, user.passHash)) return fail(res, 401, 'invalid_credentials', '账号或密码错误');

      // 单设备登录互踢：覆盖 activeSession，并通知节点踢掉旧连接
      if (user.activeSession) {
        pushControl({ type: 'kick', uid: user.uid, roomId: user.currentRoom || null, reason: 'session-takeover' });
      }
      const sessionToken = randomId('st_', 32);
      user.activeSession = sessionToken;
      user.lastLoginAt = Date.now();
      user.lastIp = ip;
      save();
      return send(res, 200, {
        ok: true,
        sessionToken: sessionToken,
        uid: user.uid,
        username: user.username,
        role: user.role,
        activeRoom: user.currentRoom || null
      });
    }

    /* --------------------------- 恢复码重置密码 ------------------------- */
    if (p === '/api/reset-password' && method === 'POST') {
      const ip = clientIp(req);
      if (isIpBanned(ip)) return fail(res, 403, 'ip_banned', '该 IP 已被封禁');
      if (!resetAllowed(ip)) return fail(res, 429, 'too_many_requests', '重置尝试过于频繁，请 60 秒后重试');
      const body = await readJson(req);
      const username = String(body.username == null ? '' : body.username).trim();
      const recoveryCode = body.recoveryCode;
      const newPassword = String(body.newPassword == null ? '' : body.newPassword);
      if (!newPassword) return fail(res, 400, 'invalid_password', '新密码不能为空');
      const user = findUserByUsername(username);
      if (!user) return fail(res, 401, 'invalid_recovery_code', '恢复码校验失败');
      if (user.banned) return fail(res, 403, 'account_banned', '该账号已被封禁');
      if (sha256(canonicalRecoveryCode(recoveryCode)) !== user.recoveryHash) {
        return fail(res, 401, 'invalid_recovery_code', '恢复码校验失败');
      }
      // 轮换密码与恢复码（旧恢复码立即失效）
      user.salt = crypto.randomBytes(16).toString('hex');
      user.passHash = hashPassword(newPassword, user.salt);
      const rotated = generateRecoveryCode();
      user.recoveryHash = sha256(canonicalRecoveryCode(rotated));
      user.passwordResetAt = Date.now();
      save();
      return send(res, 200, {
        ok: true,
        uid: user.uid,
        username: user.username,
        recoveryCode: rotated,
        rotated: true,
        notice: '恢复码已轮换，旧恢复码已失效，请保存新的恢复码'
      });
    }

    /* ----------------------- 链路① 节点心跳与版本锁 ---------------------- */
    if (p === '/internal/heartbeat' && method === 'POST') {
      const raw = await readRaw(req);
      const sigHeader = String((req.headers && req.headers['x-node-sig']) || '').trim().replace(/^sha256=/i, '');
      const expect = hmacHex(raw);
      if (!sigHeader || !safeEqualHex(sigHeader, expect)) {
        return fail(res, 401, 'bad_signature', 'x-node-sig HMAC 校验失败');
      }
      let body;
      try { body = JSON.parse(raw); } catch (e) { return fail(res, 400, 'invalid_json', '心跳请求体必须是合法 JSON'); }
      if (!body || typeof body !== 'object') return fail(res, 400, 'invalid_json');
      const nodeId = String(body.nodeId == null ? '' : body.nodeId).trim();
      if (!nodeId) return fail(res, 400, 'invalid_node', '缺少 nodeId');

      const versionOk = String(body.version) === PORTAL_VERSION;
      const prev = db.nodes[nodeId] || {};
      db.nodes[nodeId] = {
        nodeId: nodeId,
        url: typeof body.url === 'string' ? body.url : (prev.url || null),
        wsUrl: typeof body.wsUrl === 'string' ? body.wsUrl : (prev.wsUrl || null),
        version: body.version == null ? null : String(body.version),
        draining: body.draining === true,
        rooms: Array.isArray(body.rooms) ? body.rooms : (Array.isArray(prev.rooms) ? prev.rooms : []),
        mods: Array.isArray(body.mods) ? body.mods : (Array.isArray(prev.mods) ? prev.mods : []),
        players: Number.isFinite(body.players) ? body.players : (prev.players || 0),
        lastSeen: Date.now(),
        versionMismatch: !versionOk,
        accepted: versionOk
      };
      // B-S4-7: sync portal-side room registry with the node's live rooms; drop zombie rooms.
      const nowSeen = Date.now();
      const seenRooms = new Set();
      const nodeRooms = Array.isArray(body.rooms) ? body.rooms : [];
      for (const r of nodeRooms) {
        if (!r || !r.roomId) continue;
        const rid = String(r.roomId);
        seenRooms.add(rid);
        const pr = db.rooms[rid];
        if (!pr) continue;
        pr.status = r.status || pr.status;
        if (r.name) pr.name = r.name;
        if (Number.isFinite(Number(r.maxPlayers))) pr.maxPlayers = Number(r.maxPlayers);
        if (Number.isFinite(Number(r.humans))) pr.humans = Number(r.humans);
        pr.nodeId = nodeId;
        pr.lastSeen = nowSeen;
        pr.onNode = true;
        if (pr.status === 'settled') delete db.rooms[rid];
      }
      for (const rid of Object.keys(db.rooms || {})) {
        const pr = db.rooms[rid];
        if (!pr) continue;
        if (pr.status === 'settled') { delete db.rooms[rid]; continue; }
        if (pr.onNode && pr.nodeId === nodeId && !seenRooms.has(rid)) {
          if (!pr.lastSeen) pr.lastSeen = nowSeen;
          if (nowSeen - pr.lastSeen > 60000) delete db.rooms[rid];
        }
      }
      const controls = drainControls(nodeId);
      save();
      return send(res, 200, {
        ok: true,
        versionOk: versionOk,
        versionMismatch: !versionOk,
        accepted: versionOk,
        nodeId: nodeId,
        portalVersion: PORTAL_VERSION,
        serverTime: Date.now(),
        heartbeatIntervalMs: 3000,
        controls: controls
      });
    }

    /* ------------------ 链路② 房间列表（Bearer） ---------------------- */
    if (p === '/api/rooms' && method === 'GET') {
      const auth = requireAuth(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      let rooms = listRooms();
      // K3: ordinary players only see joinable active rooms + the endless teaser; admins keep full visibility.
      if (auth.user.role !== 'admin') rooms = rooms.filter((r) => r.mode === 'endless' || r.canJoin !== false);
      return send(res, 200, {
        ok: true,
        rooms: rooms,
        count: rooms.length,
        portalVersion: PORTAL_VERSION,
        config: db.config
      });
    }

    /* ------------------ 链路② 创建淘汰房（Bearer） -------------------- */
    if (p === '/api/rooms/create' && method === 'POST') {
      const auth = requireAuth(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const mode = body.mode === 'normal' ? 'normal' : 'elim';
      let maxPlayers = Number(body.maxPlayers);
      if (!Number.isFinite(maxPlayers)) maxPlayers = 8;
      maxPlayers = Math.max(2, Math.min(8, Math.round(maxPlayers)));
      let name = String(body.name == null ? '' : body.name).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24);
      if (!name) name = (auth.user.username || '房主') + ' 的淘汰房';
      const roomId = String(body.roomId || '').trim() || randomId('elim-', 4);
      const node = pickHealthyNode();
      const room = {
        roomId: roomId,
        mode: mode,
        name: name,
        status: 'waiting',
        maxPlayers: maxPlayers,
        hostId: auth.user.uid,
        hostName: auth.user.username,
        noJoin: false,
        canJoin: true,
        createdAt: Date.now(),
        nodeId: node ? node.nodeId : null,
        origin: 'portal'
      };
      db.rooms[roomId] = room;
      auth.user.currentRoom = roomId;
      save();
      return send(res, 200, {
        ok: true,
        roomId: roomId,
        mode: room.mode,
        name: room.name,
        status: room.status,
        maxPlayers: room.maxPlayers,
        hostId: room.hostId,
        room: room,
        nodeId: room.nodeId,
        wsUrl: node ? (node.wsUrl || DEFAULT_GAME_WS) : DEFAULT_GAME_WS,
        joinEndpoint: '/api/rooms/join'
      });
    }

    /* ------------------ 链路③ 一次性入房票据（Bearer） ---------------- */
    if (p === '/api/rooms/join' && method === 'POST') {
      const auth = requireAuth(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const roomId = String(body.roomId == null ? '' : body.roomId).trim();
      if (!roomId) return fail(res, 400, 'invalid_room', '缺少 roomId');
      const room = findRoom(roomId);
      const spectate = body.spectate === true && auth.user.role === 'admin';
      if (roomId === 'endless' || (room && room.locked)) return fail(res, 423, 'room_locked', '该模式尚未开放');
      // B-S4-4: admin spectate bypasses noJoin and full-room limits.
      if (!spectate && room && room.noJoin && auth.user.currentRoom !== roomId) {
        return fail(res, 403, 'room_locked', '该房间已停止加入');
      }
      if (!spectate && room) {
        const maxP = Number(room.maxPlayers);
        const humans = Number(room.humans);
        if (Number.isFinite(maxP) && maxP > 0 && Number.isFinite(humans) && humans >= maxP) {
          return fail(res, 403, 'room_full', '该房间已满员');
        }
      }
      const mode = (room && room.mode) || (body.mode === 'normal' || body.mode === 'elim' || body.mode === 'endless' ? body.mode : 'normal');
      const payload = {
        uid: auth.user.uid,
        name: auth.user.username,
        role: auth.user.role,
        roomId: roomId,
        mode: mode,
        roomName: (room && room.name) || null,
        maxPlayers: (room && room.maxPlayers) || 8,
        isHost: !!(room && room.hostId === auth.user.uid),
        exp: Date.now() + TICKET_TTL_MS
      };
      if (spectate) payload.spectate = true;
      const ticket = signTicket(payload);
      if (!spectate) auth.user.currentRoom = roomId;
      save();
      const node = room && room.nodeId && db.nodes[room.nodeId] ? db.nodes[room.nodeId] : null;
      const configWsUrl = db.config.gamePublicWsUrl || '';
      const resolvedWs = configWsUrl || (node ? (node.wsUrl || DEFAULT_GAME_WS) : DEFAULT_GAME_WS);
      return send(res, 200, {
        ok: true,
        ticket: ticket,
        wsUrl: resolvedWs,
        configWsUrl: configWsUrl || null,
        roomId: roomId,
        mode: mode,
        roomName: (room && room.name) || null,
        status: (room && room.status) || null,
        nodeId: (room && room.nodeId) || (node && node.nodeId) || null,
        role: auth.user.role,
        spectate: spectate,
        exp: payload.exp,
        ttlMs: TICKET_TTL_MS
      });
    }

    /* ---------------------------- 管理员接口 --------------------------- */
    if (p === '/api/admin/users' && method === 'GET') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      return send(res, 200, {
        ok: true,
        users: Object.values(db.users).map(publicUser),
        bannedIps: db.bannedIps,
        config: db.config,
        nodes: Object.values(db.nodes),
        announcement: db.config.announcement || '',
        allowRegistration: db.config.allowRegistration !== false,
        draining: db.config.draining === true,
        proxyPrefix: db.config.proxyPrefix || ''
      });
    }

    // Stage5.1 J4: administrators may create accounts even when public registration is disabled.
    if (p === '/api/admin/create-user' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const username = String(body.username == null ? '' : body.username).trim();
      const password = String(body.password == null ? '' : body.password);
      const role = body.role === 'admin' ? 'admin' : 'user';
      const nameLen = Array.from(username).length;
      if (nameLen < 2 || nameLen > 12) return fail(res, 400, 'invalid_username', '用户名需为 2-12 个字符');
      if (!password) return fail(res, 400, 'invalid_password', '密码不能为空');
      if (findUserByUsername(username)) return fail(res, 409, 'username_taken', '用户名已被占用');
      const made = createUserRecord(username, password, role);
      save();
      return send(res, 200, { ok: true, uid: made.user.uid, username: made.user.username, role: made.user.role, recoveryCode: made.recoveryCode });
    }

    if (p === '/api/admin/kick' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const uid = String(body.uid == null ? '' : body.uid).trim();
      if (!uid) return fail(res, 400, 'invalid_uid');
      const target = db.users[uid];
      if (!target) return fail(res, 404, 'user_not_found');
      const roomId = String(body.roomId || target.currentRoom || '') || null;
      target.activeSession = null;
      target.currentRoom = null;
      pushControl({ type: 'kick', uid: uid, roomId: roomId, by: auth.user.uid, reason: 'admin-kick' });
      save();
      return send(res, 200, { ok: true, kicked: uid, roomId: roomId });
    }

    if (p === '/api/admin/ban' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      // B-S4-2: support both {ban:boolean} and legacy {banned:boolean}; explicit ban always wins.
      const ban = body.ban !== undefined ? (body.ban !== false) : (body.banned !== false);
      const uid = String(body.uid == null ? '' : body.uid).trim();
      const ip = body.ip == null ? '' : String(body.ip).trim();
      if (!uid && !ip) return fail(res, 400, 'invalid_target', '需提供 uid 或 ip');
      if (uid) {
        const target = db.users[uid];
        if (!target) return fail(res, 404, 'user_not_found');
        target.banned = ban;
        if (ban) {
          pushControl({ type: 'kick', uid: uid, roomId: target.currentRoom || null, by: auth.user.uid, reason: 'admin-ban' });
          target.activeSession = null;
          target.currentRoom = null;
        }
      }
      if (ip) {
        const idx = db.bannedIps.indexOf(ip);
        if (ban && idx === -1) db.bannedIps.push(ip);
        if (!ban && idx !== -1) db.bannedIps.splice(idx, 1);
        if (ban) pushControl({ type: 'ban-ip', ip: ip, by: auth.user.uid });
      }
      save();
      return send(res, 200, { ok: true, ban: ban, uid: uid || null, ip: ip || null, bannedIps: db.bannedIps.slice() });
    }

    if (p === '/api/admin/delete-user' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const uid = String(body.uid == null ? '' : body.uid).trim();
      if (!uid) return fail(res, 400, 'invalid_uid');
      if (!db.users[uid]) return fail(res, 404, 'user_not_found');
      delete db.users[uid];
      for (const roomId of Object.keys(db.rooms)) {
        if (db.rooms[roomId] && db.rooms[roomId].hostId === uid) db.rooms[roomId].hostId = null;
      }
      save();
      return send(res, 200, { ok: true, deleted: uid });
    }

    if (p === '/api/admin/reset-password' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const uid = String(body.uid == null ? '' : body.uid).trim();
      const newPassword = String(body.newPassword == null ? '' : body.newPassword);
      if (!uid) return fail(res, 400, 'invalid_uid');
      if (!newPassword) return fail(res, 400, 'invalid_password');
      const target = db.users[uid];
      if (!target) return fail(res, 404, 'user_not_found');
      target.salt = crypto.randomBytes(16).toString('hex');
      target.passHash = hashPassword(newPassword, target.salt);
      const rotated = generateRecoveryCode();
      target.recoveryHash = sha256(canonicalRecoveryCode(rotated));
      target.activeSession = null;
      target.passwordResetAt = Date.now();
      save();
      return send(res, 200, { ok: true, uid: uid, newPassword: newPassword, recoveryCode: rotated, rotated: true });
    }

    if (p === '/api/admin/config' && method === 'POST') {
      const auth = requireAdmin(req);
      if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      if (body.config && typeof body.config === 'object') {
        Object.assign(db.config, body.config);
      }
      if (body.key != null) {
        const key = String(body.key).trim();
        if (!key) return fail(res, 400, 'invalid_key');
        db.config[key] = body.value;
        if (key === 'draining') {
          for (const nodeId of Object.keys(db.nodes)) db.nodes[nodeId].draining = body.value === true;
        }
      }
      // Stage5.4 §5.1: adminPath is normalised before it is persisted.
      if (body.key === 'adminPath' || (body.config && Object.prototype.hasOwnProperty.call(body.config, 'adminPath'))) {
        db.config.adminPath = normAdminPath(db.config.adminPath);
      }
      // Stage5.1 J1: a single reverse-proxy prefix derives public WS/API paths automatically.
      if (body.key === 'proxyPrefix' || (body.config && Object.prototype.hasOwnProperty.call(body.config, 'proxyPrefix'))) {
        const raw = String(db.config.proxyPrefix || '').trim().replace(/\/+$/, '');
        db.config.proxyPrefix = raw;
        if (raw) { db.config.gamePublicWsUrl = raw + '/ws'; db.config.gamePublicApiUrl = raw; }
        else { db.config.gamePublicWsUrl = ''; db.config.gamePublicApiUrl = ''; }
      }
      pushControl({ type: 'config', config: Object.assign({}, db.config) });
      save();
      return send(res, 200, { ok: true, config: db.config, adminPath: currentAdminPath() });
    }

    /* ---------------- Stage 5 I6/I7：游戏服镜像与节点编排 ---------------- */
    if (p === '/internal/bundle/server.js' && method === 'GET') {
      try {
        const buf = fs.readFileSync(path.join(__dirname, 'server.js'));
        res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
        res.end(buf);
      } catch (e) { return fail(res, 500, 'bundle_missing', '基准镜像缺失'); }
      return;
    }
    if (p === '/api/admin/node-manager/install' && method === 'POST') {
      const auth = requireAdmin(req); if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const port = Number(body.port) || LOCAL_NODE_PORT;
      try { const inst = await ensureNodeInstalled(LOCAL_NODE_ID, body.downloadUrl || ''); const cfg = buildNodeConfig(LOCAL_NODE_ID, port); fs.writeFileSync(inst.configPath, JSON.stringify(cfg, null, 2), 'utf8'); save(); return send(res, 200, { ok: true, nodeId: LOCAL_NODE_ID, dir: inst.dir, configPath: inst.configPath, singleInstance: true }); }
      catch (e) { return fail(res, 500, 'install_failed', String(e && e.message || e)); }
    }
    if (p === '/api/admin/node-manager/start' && method === 'POST') {
      const auth = requireAdmin(req); if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req);
      const nodeId = String(body.nodeId || '').trim(); if (!nodeId) return fail(res, 400, 'invalid_node_id');
      const port = Number(body.port) || 8787;
      try { const r = await ensureLocalNode(port, body.downloadUrl || ''); return send(res, 200, Object.assign({ ok: true }, r)); }
      catch (e) { return fail(res, 500, 'start_failed', String(e && e.message || e)); }
    }
    if (p === '/api/admin/node-manager/stop' && method === 'POST') {
      const auth = requireAdmin(req); if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req); void body;
      return send(res, 200, stopLocalNode());
    }
    if (p === '/api/admin/node-manager/restart' && method === 'POST') {
      const auth = requireAdmin(req); if (!auth.ok) return fail(res, auth.status, auth.error);
      const body = await readJson(req); const nodeId = String(body.nodeId || '').trim(); if (!nodeId) return fail(res, 400, 'invalid_node_id');
      const port = Number(body.port) || 8787;
      try { const r = await restartLocalNode(port, body.downloadUrl || ''); return send(res, 200, Object.assign({ ok: true, restarted: true }, r)); }
      catch (e) { return fail(res, 500, 'restart_failed', String(e && e.message || e)); }
    }
    if (p === '/api/admin/node-manager/status' && method === 'GET') {
      const auth = requireAdmin(req); if (!auth.ok) return fail(res, auth.status, auth.error);
      return send(res, 200, { ok: true, nodes: managedStatus(), localNode: localNodeSummary(), externalNodes: externalNodes(), ssoTicket: nodeSsoTicket(), portalUrl: selfPortalUrl() });
    }
    // Stage5.4 §5.1: hidden, configurable standalone admin console — must run before static hosting.
    if ((method === 'GET' || method === 'HEAD') && (p === currentAdminPath() || p === currentAdminPath() + '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(method === 'HEAD' ? '' : ADMIN_CONSOLE_HTML);
      return;
    }
    // Task H1: 作为唯一 Web 入口，托管 public/ 静态前端（非 API/内部/健康请求）
    if ((method === 'GET' || method === 'HEAD') && !p.startsWith('/api') && !p.startsWith('/internal') && p !== '/health') {
      if (serveStatic(req, res, p, method)) return;
    }

    return fail(res, 404, 'not_found', '未知接口: ' + method + ' ' + p);
  } catch (err) {
    const status = (err && err.status) || 500;
    const code = (err && err.code) || 'internal_error';
    return fail(res, status, code, err && err.message ? String(err.message) : code);
  }
}

/* --------------------------------- 生命周期 ----------------------------- */

const server = http.createServer(app);

/** Task H1: 门户 /ws 反向代理 → 健康游戏节点（默认 127.0.0.1:8787）。 */
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://localhost').pathname; } catch (e) { try { socket.destroy(); } catch (_) {} return; }
  if (pathname !== '/ws') { try { socket.destroy(); } catch (e) {} return; }
  let host = '127.0.0.1', port = 8787;
  try {
    const node = pickHealthyNode();
    if (node && node.wsUrl) {
      const u = new URL(node.wsUrl);
      host = u.hostname || host;
      port = Number(u.port) || (u.protocol === 'wss:' ? 443 : 80);
    }
  } catch (e) { /* fall back to default 8787 */ }
  const upstream = net.connect(port, host, () => {
    let raw = (req.method || 'GET') + ' ' + req.url + ' HTTP/1.1\r\n';
    const h = req.rawHeaders || [];
    for (let i = 0; i + 1 < h.length; i += 2) raw += h[i] + ': ' + h[i + 1] + '\r\n';
    raw += '\r\n';
    try { upstream.write(raw); if (head && head.length) upstream.write(head); } catch (e) {}
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on('error', () => { try { socket.destroy(); } catch (e) {} });
  socket.on('error', () => { try { upstream.destroy(); } catch (e) {} });
  socket.on('close', () => { try { upstream.destroy(); } catch (e) {} });
});


/**
 * 启动监听；返回 http.Server。start(0) 使用随机端口。
 * 回调在 'listening' 后触发，同时 server.ready 为等价的 Promise。
 */
function start(port, cb) {
  if (typeof port === 'function') { cb = port; port = undefined; }
  if (server.listening) {
    if (typeof cb === 'function') server.once('listening', () => cb(server));
    if (typeof cb === 'function' && server.listening) cb(server);
    return server;
  }
  const p = (port === undefined || port === null || port === '') ? PORT : Number(port);
  server.ready = new Promise((resolve) => server.once('listening', () => resolve(server)));
  server.listen(p, process.env.HOST || '0.0.0.0', () => { if (typeof cb === 'function') cb(server); });
  return server;
}

function stop() {
  return new Promise((resolve) => {
    if (!server.listening) return resolve(false);
    server.close(() => resolve(true));
  });
}

loadDb();
initAdminBootstrap();

if (require.main === module) {
  start(PORT, () => {
    const addr = server.address();
    console.log('[portal] 星海边境门户端 v' + PORTAL_VERSION + ' listening on http://0.0.0.0:' + (addr && addr.port));
  });
}

module.exports = {
  start,
  stop,
  server,
  app,
  // 运行时/测试辅助
  PORTAL_VERSION,
  NODE_SECRET,
  DB_PATH,
  get db() { return db; },
  save,
  loadDb,
  signTicket,
  verifyTicket,
  loadDotEnv,
  initAdminBootstrap,
  get bootstrapToken() { return bootstrapToken; },
  canonicalRecoveryCode,
  generateRecoveryCode,
  // 便于测试隔离
  _resetRuntimeState() {
    resetHits.clear();
    db = emptyDb();
    save();
    return db;
  }
};
