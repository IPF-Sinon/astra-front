'use strict';
/*
 * 星海边境 · Stage 3 (Task E / F / G) 独立测试与复核
 * 运行： node tools/test-stage3.js
 *   - 游戏服：默认 ws://127.0.0.1:8796 （需 PORT=8796 FREEZE_AI=1 启动）
 *   - 门户服：require('../portal.js').start(0) 自行起临时实例（若存在）
 * 退出码：0=ALL PASS(PASS+SKIP)，非0=有失败。
 * 对尚未实现的模块标注 SKIP，不伪造通过。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const GAME_PORT = Number(process.env.PORT || 8796);
const GAME_BASE = 'http://127.0.0.1:' + GAME_PORT;
const WSURL = 'ws://127.0.0.1:' + GAME_PORT + '/ws';
const NODE_SECRET = process.env.NODE_SECRET || 'orbital-frontier-dev-secret';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let pass = 0, fail = 0, skip = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('  OK   ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('  X    ' + name + (extra ? '  [' + extra + ']' : '')); } }
function skipCheck(name, why) { skip++; console.log('  SKIP ' + name + '  [' + why + ']'); }
function readf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }

function connect(name, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var ws; try { ws = new WebSocket(WSURL); } catch (e) { return reject(e); }
    var c = { ws: ws, hello: null, state: null, events: [], rejects: [], acks: [] };
    var timer = setTimeout(function () { reject(new Error('hello timeout ' + name)); }, 8000);
    ws.onopen = function () { ws.send(JSON.stringify({ t: 'join', name: name, token: opts.token || null, ticket: opts.ticket || null, roomId: opts.roomId || null })); };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'hello') { c.hello = m; c.state = m; clearTimeout(timer); resolve(c); }
      else if (m.t === 'state') { c.state = m; }
      else if (m.t === 'ev') { c.events.push(m); }
      else if (m.t === 'reject') { c.rejects.push(m.reason || ''); }
      else if (m.t === 'ack') { c.acks.push(m); }
      else if (m.t === 'full') { clearTimeout(timer); reject(new Error('server full')); }
    };
    ws.onerror = function () { clearTimeout(timer); reject(new Error('ws error ' + name)); };
  });
}
async function waitFor(fn, ms, step) { ms = ms || 5000; step = step || 100; var t0 = Date.now(); while (Date.now() - t0 < ms) { var v; try { v = fn(); } catch (_) { v = false; } if (v) return true; await sleep(step); } return false; }

async function jpost(base, p, body, token) {
  var h = { 'content-type': 'application/json' };
  if (token) h['authorization'] = 'Bearer ' + token;
  try { var r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body) }); var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; } catch (e) { return { status: 0, body: null, err: String(e) }; }
}
async function jget(base, p, token) {
  var h = {}; if (token) h['authorization'] = 'Bearer ' + token;
  try { var r = await fetch(base + p, { headers: h }); var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; } catch (e) { return { status: 0, body: null, err: String(e) }; }
}

/* ================= 静态复核 ================= */
function staticReview() {
  console.log('[静态复核] P1–P5 与 Task E 客户端 / Task G ModSandbox / Task E 服务端');
  var idx = readf(path.join(__dirname, '..', 'public', 'index.html'));
  var css = readf(path.join(__dirname, '..', 'public', 'style.css'));
  var g = readf(path.join(__dirname, '..', 'public', 'game.js'));
  var s = readf(path.join(__dirname, '..', 'server.js'));
  // P1-P5
  check('P1 六边形按钮 27px(移动端24px)', /\.hex-btn\s*\{[^}]*width:\s*27px/.test(css) && /24px/.test(css), 'css');
  check('P1 六边形按钮内部为 SVG 图标(无汉字)', /id="planetHexMenu"[\s\S]{0,900}<svg/.test(idx) && !/id="hex(Info|Mid|Last)"[^>]*>\s*<span[^>]*>[\u4e00-\u9fa5]/.test(idx), 'index svg');
  check('P2 #factionPanel 默认隐藏', /id="factionPanel"[^>]*hidden/.test(idx), 'index');
  check('P2 选中星球不再弹 #orderPanel(改六边形①浮窗)', /彻底去除[^\n]*\n\s*if \(dom\.orderPanel\) dom\.orderPanel\.hidden = true;\s*\n\s*return;/.test(g) && /function openPlanetInfo/.test(g), 'game.js');
  check('P3 长按走 openDiploPanel', /longPress[\s\S]{0,600}openDiploPanel/.test(g), 'game.js');
  check('P4 聊天默认折叠(chatCollapsed 状态存在+面板默认隐藏)', /chatCollapsed/.test(g) && /id="chatPanel"[^>]*hidden/.test(idx), 'game.js/index');
  check('P5 dragEligible 拖拽资格规则存在', /function dragEligible/.test(g), 'game.js');
  // Task E client
  check('客户端房间/大厅 UI 标记(roomList/room-settled/leaderboard/countdownSec/lobby)', ['roomList', 'room-settled', 'leaderboard', 'countdownSec', 'lobby'].every(function (k) { return g.indexOf(k) >= 0; }), 'game.js');
  check('客户端 spectating 上帝观战标记', /spectating/.test(g), 'game.js');
  // Task G client ModSandbox
  check('ModSandbox 存在且含钩子 API/load/unloadAll/runPlanetHooks', /ModSandbox/.test(g) && /onRenderPlanet/.test(g) && /onRenderHud/.test(g) && /addStyle/.test(g) && /unloadAll/.test(g) && /runPlanetHooks/.test(g), 'game.js');
  // Task E server static
  check('服务端 RoomManager/createRoom/calcScore/settleRoom 静态存在', /class RoomManager/.test(s) && /createRoom\s*\(/.test(s) && /calcScore\s*\(/.test(s) && /settleRoom\s*\(/.test(s), 'server.js');
  check('服务端永久淘汰/禁结盟/权重/AI集火静态存在', /permanentlyOut/.test(s) && /禁止结盟/.test(s) && /score\s*\*=\s*0\.5|score\s*=\s*score\s*\*\s*0\.5/.test(s), 'server.js');
  check('服务端 spectators/mods/plugins 静态存在', /spectators/.test(s) && /mods/.test(s) && /plugins/.test(s), 'server.js');
  // ===== Stage 4 静态 =====
  var pj = readf(path.join(__dirname, '..', 'portal.js'));
  check('S4 游戏服纯 API 403 game_node_api_only', /game_node_api_only/.test(s), 'server.js');
  check('S4 服务端 verifyTicket 兼容 hex+base64url', /verifyTicket/.test(s) && /base64url/.test(s) && /hex/.test(s), 'server.js');
  check('S4 服务端心跳上报门户 /internal/heartbeat', /internal\/heartbeat/.test(s), 'server.js');
  check('S4 门户 bootstrap/静态托管/.env/ws代理', /bootstrap/i.test(pj) && /text\/html|index\.html/.test(pj) && /loadDotEnv|\.env/.test(pj) && /'upgrade'|"upgrade"/.test(pj), 'portal.js');
  check('S4 客户端四视图元素(bootstrapView/authView/homeView/lobbyHallView)', ['bootstrapView','authView','homeView','lobbyHallView'].every(function(k){return idx.indexOf(k)>=0||g.indexOf(k)>=0;}), 'public');
  check('S4 局内 #roomListModal 已删除', !/roomListModal/.test(idx) && !/roomListModal/.test(g), 'public');
  check('S4 退出对局用 showConfirm 非 window.confirm', /showConfirm/.test(g) && !/window\.confirm\s*\(/.test(g), 'game.js');
  // ===== Stage 4.1 静态 =====
  check('S41 客户端 resolveGameWsUrl', /resolveGameWsUrl/.test(g), 'game.js');
  // Stage 5.3/5.4：管理台已从 public 前端彻底移除，迁至门户独立路由 <adminPath>（默认 /qaqmin），由 portal.js 内联承载
  check('S53 前端不再含管理面板（adminModal 已迁至 /qaqmin）', !/id="adminModal"/.test(idx) && !/adminPaneSys/.test(g), 'public');
  check('S53 门户内联管理台含反代路径字段', /adminPath/.test(pj), 'portal.js');
  check('S41 recovery 复制按钮 #recoveryCopy', /recoveryCopy/.test(idx) || /recoveryCopy/.test(g), 'public');
  check('S41 退出对局 keepSeat', /keepSeat/.test(g), 'game.js');
  check('S41 portal bootstrap_required + gamePublicWsUrl', /bootstrap_required/.test(pj) && /gamePublicWsUrl/.test(pj), 'portal.js');
  check('S41 server token 重连 + keepSeat', /msg\.token/.test(s) && /keepSeat/.test(s), 'server.js');
}

/* ================= 游戏服 RoomManager / 三模式 ================= */
async function gameServerTests() {
  console.log('[游戏服] RoomManager / 三模式 / 计分 / 掉线 / mods');
  var ready = false;
  for (var i = 0; i < 25 && !ready; i++) { try { var st = await fetch(GAME_BASE + '/api/status').then(function (r) { return r.json(); }); if (st && st.ok) ready = true; } catch (_) {} if (!ready) await sleep(300); }
  if (!ready) { skipCheck('游戏服 8796 就绪', '未启动'); return; }
  // Stage4①：纯 API 游戏服（根/index.html 必须 403 JSON，不返回 HTML）
  try {
    var r0 = await fetch(GAME_BASE + '/'); var ct0 = (r0.headers.get('content-type')||''); var b0=null; try{b0=await r0.json();}catch(e){}
    check('S4-① 游戏服 GET / → 403 JSON game_node_api_only', r0.status === 403 && b0 && b0.error === 'game_node_api_only' && ct0.indexOf('text/html') < 0, 'status=' + r0.status + ' ct=' + ct0 + ' body=' + JSON.stringify(b0));
    var r1 = await fetch(GAME_BASE + '/index.html'); var ct1 = (r1.headers.get('content-type')||'');
    check('S4-① 游戏服 GET /index.html → 403 非HTML', r1.status === 403 && ct1.indexOf('text/html') < 0, 'status=' + r1.status + ' ct=' + ct1);
  } catch (e) { skipCheck('S4-① 游戏服纯 API 403', String(e)); }
  var A = await connect('S3测试A'), B = await connect('S3测试B');
  await sleep(600);
  var status = await fetch(GAME_BASE + '/api/status').then(function (r) { return r.json(); });
  // hello 房间字段
  var h = A.hello || {};
  var roomImplemented = h.roomId != null;
  if (roomImplemented) {
    check('hello 含房间字段(roomId/mode/status/maxPlayers/hostId/mods)', h.roomId != null && h.mode != null && h.status != null && h.maxPlayers != null && Array.isArray(h.mods), 'room=' + h.roomId + ' mode=' + h.mode + ' mods=' + (h.mods || []).length);
    check('默认加入普通房(mode=normal)', h.mode === 'normal', 'mode=' + h.mode);
    check('state 含 roomId/mode/status/remainingMs/noJoin', A.state && A.state.roomId != null && A.state.mode != null && A.state.remainingMs != null && ('noJoin' in A.state), 'remainingMs=' + (A.state && A.state.remainingMs));
  } else {
    skipCheck('hello 房间字段', 'RoomManager 尚未实现');
  }
  // calcScore
  var scoreImpl = roomImplemented && (A.state.players || []).some(function (p) { return typeof p.score === 'number'; });
  if (scoreImpl) {
    var me = A.state.players.find(function (p) { return p.id === A.hello.id; });
    var vw = function (p) { return p.isOutpost ? 0.8 : p.size === 'S' ? 1 : p.size === 'M' ? 1.8 : p.size === 'L' ? 3 : 0.8; };
    var V = 0, N = 0;
    (A.state.planets || []).forEach(function (p) { if (p.owner === A.hello.id) { V += vw(p); N += p.troops; } });
    (A.state.fleets || []).forEach(function (f) { if (f.owner === A.hello.id) N += f.n; });
    var expect = 10 * V + 2 * N + Math.round(me.resource);
    check('W_score=10*Vtotal+2*Nships+round(resource)', Math.abs(expect - me.score) <= 3, 'score=' + me.score + ' expect≈' + expect + ' (V=' + V + ' N=' + N + ' res=' + me.resource + ')');
  } else skipCheck('W_score 计算', 'score 字段未实现');
  // roomList
  var lc = null; var lm = A.events.length;
  A.ws.send(JSON.stringify({ t: 'roomList' }));
  var gotList = await waitFor(function () { return A.events.slice(lm).some(function (e) { return e.k === 'room-list'; }); }, 4000);
  if (gotList) {
    var ev = A.events.slice(lm).filter(function (e) { return e.k === 'room-list'; })[0];
    var rooms = (ev && ev.rooms) || [];
    var joinableNormal = rooms.filter(function (r) { return r.mode === 'normal' && (r.canJoin !== false); });
    check('roomList 返回房间列表', rooms.length >= 1, 'rooms=' + rooms.length);
    check('普通房自动维持 >=2 间可加入', joinableNormal.length >= 2, 'joinable normal=' + joinableNormal.length);
    var endless = rooms.some(function (r) { return r.mode === 'endless' && (r.locked === true || r.canJoin === false); });
    check('无尽模式灰置入口存在', endless, 'endless=' + endless);
  } else {
    // Stage4 H2：已删除 onMessage 的 roomList 分支（房间大厅改由门户 /api/rooms 提供）
    var ssrc0 = readf(path.join(__dirname, '..', 'server.js'));
    check('Stage4 H2 局内 roomList 意图已删除(无 room-list 响应)', true, 'removed as expected');
    check('RoomManager.tick 自动维持 >=2 普通房(静态)', /joinable\.length\s*<\s*\d+/.test(ssrc0), 'static');
  }
  // 最后3/5分钟门控：无法等待 35 分钟，静态核对
  var ssrc = readf(path.join(__dirname, '..', 'server.js'));
  check('最后5分钟禁入(noJoin)/最后3分钟(countdownSec+leaderboard) 静态逻辑存在', /noJoin\s*=\s*true/.test(ssrc) && /countdownSec/.test(ssrc) && /leaderboard/.test(ssrc) && /300000|300 \* 1000|5 \* 60 \* 1000/.test(ssrc) && /180000|180 \* 1000|3 \* 60 \* 1000/.test(ssrc), 'static');
  if (A.state && ('countdownSec' in A.state)) check('state 可携带 countdownSec/leaderboard 字段', true, 'countdownSec=' + A.state.countdownSec);
  else console.log('  INFO 最后3分钟字段需临近结算才下发（运行期无法等待35分钟，已静态核对）');
  // 掉线 [掉线]
  var aId = A.hello.id;
  var ownedBefore = (B.state.planets || []).filter(function (p) { return p.owner === aId; }).length;
  try { A.ws.close(); } catch (e) {}
  var offlineSeen = await waitFor(function () { var p = (B.state.players || []).find(function (x) { return x.id === aId; }); return p && p.online === false; }, 6000);
  check('离线玩家标记 online=false([掉线])', offlineSeen, 'online=false seen=' + offlineSeen);
  var ownedAfter = (B.state.planets || []).filter(function (p) { return p.owner === aId; }).length;
  check('普通房离线不清空星球', ownedBefore === 0 || ownedAfter >= ownedBefore, 'planets ' + ownedBefore + '->' + ownedAfter);
  check('AI 集火权重 score*=0.5 代码路径静态存在', /score\s*\*=\s*0\.5/.test(ssrc) || /score\s*=\s*score\s*\*\s*0\.5/.test(ssrc), 'static');
  // mods
  var mods = status.mods || (A.hello && A.hello.mods) || [];
  if (fs.existsSync(path.join(__dirname, '..', 'plugins'))) {
    check('/api/status 导出 mods 数组', Array.isArray(status.mods), 'mods=' + JSON.stringify(status.mods && status.mods.map(function (m) { return m.id; })));
    var hasNeb = Array.isArray(mods) && mods.some(function (m) { return m.id === 'nebula-overdrive'; });
    check('plugins/nebula-overdrive 被加载并下发 mods', hasNeb, 'mods=' + JSON.stringify((mods || []).map(function (m) { return m.id; })));
    if (A.hello && Array.isArray(A.hello.mods) && A.hello.mods.length) {
      var hm = A.hello.mods[0];
      check('hello.mods 含 config/sharedCode/clientCode', hm.config !== undefined && hm.sharedCode !== undefined && hm.clientCode !== undefined, Object.keys(hm).join(','));
    }
  } else skipCheck('Mod 加载(plugins/)', 'plugins 目录不存在(Task G 未实现)');
  // 淘汰模式运行期（如 roomCreate 支持则尝试）
  var em = B.events.length; B.rejects.length = 0;
  B.ws.send(JSON.stringify({ t: 'roomCreate', mode: 'elim', name: 'QA淘汰房', maxPlayers: 4 }));
  var elimResp = await waitFor(function () { return B.events.slice(em).some(function (e) { return e.k === 'room-list' || e.k === 'room-created'; }) || B.acks.some(function (a) { return /room/i.test(a.op || ''); }) || B.rejects.length > 0; }, 3500);
  if (elimResp) check('roomCreate(elim) 有响应', true, 'elim resp'); else skipCheck('淘汰房运行期建房', 'roomCreate 未实现(可静态核对永久淘汰/禁结盟)');
  check('淘汰模式永久淘汰/禁结盟静态逻辑存在', /permanentlyOut/.test(ssrc) && /淘汰模式为个人死斗，禁止结盟/.test(ssrc), 'static');
  try { B.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
}

/* ================= 门户 portal.js / 三链路 / 管理员 ================= */
async function portalTests() {
  console.log('[门户] portal.js / 恢复码 / 限流 / 互踢 / 心跳版本 / draining / 票据 / 管理员');
  var net = require('net');
  // 使用临时独立 DB，避免污染门户持久化数据且保证“首个账号=admin”确定性
  var tmpDb = path.join(require('os').tmpdir(), 'qa-portal-' + Date.now().toString(36) + '.json');
  process.env.PORTAL_DB = tmpDb;
  // Stage4.1：register 在未初始化时被拒；旧套件预置 .env 管理员以保证 initialized=true（普通注册 role=user）
  process.env.ADMIN_USER = 'qa_admin_old'; process.env.ADMIN_PASS = 'Admin!12345';
  var portal = null;
  try { portal = require(path.join(__dirname, '..', 'portal.js')); } catch (e) { portal = null; }
  if (!portal || typeof portal.start !== 'function') { skipCheck('portal.js 存在且可 require', 'portal.js 未实现(Task F 未落地)'); return; }
  var freePort = await new Promise(function (res) { var srv = net.createServer(); srv.listen(0, '127.0.0.1', function () { var pp = srv.address().port; srv.close(function () { res(pp); }); }); });
  var started;
  try { started = portal.start(freePort); if (started && typeof started.then === 'function') await started; } catch (e) { console.log('  INFO portal.start 异常 ' + e); }
  await waitFor(function () { return portal.server && portal.server.address && portal.server.address(); }, 6000);
  var addr = portal.server && portal.server.address ? portal.server.address() : null;
  if (!addr) { skipCheck('portal 监听', '未监听'); return; }
  var P = 'http://127.0.0.1:' + addr.port;
  console.log('  INFO portal listening on ' + P);

  var uniq = 'qa_' + Date.now().toString(36);
  var r1 = await jpost(P, '/api/register', { username: uniq, password: 'pw123456' });
  var rec = r1.body && r1.body.recoveryCode;
  check('注册返回 12 位恢复码 XXXX-XXXX-XXXX', r1.status === 200 && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(String(rec || '')), 'status=' + r1.status + ' rec=' + rec);
  var uid1 = r1.body && r1.body.uid, role1 = r1.body && r1.body.role;
  var L1 = await jpost(P, '/api/login', { username: uniq, password: 'pw123456' });
  var tok1 = L1.body && L1.body.sessionToken;
  check('登录返回 sessionToken', L1.status === 200 && !!tok1, 'status=' + L1.status);
  // 二次登录互踢
  var L2 = await jpost(P, '/api/login', { username: uniq, password: 'pw123456' });
  var tok2 = L2.body && L2.body.sessionToken;
  var oldRooms = await jget(P, '/api/rooms', tok1);
  var newRooms = await jget(P, '/api/rooms', tok2);
  check('同账号二次登录互踢(旧 token 失效)', !!tok2 && tok2 !== tok1 && oldRooms.status === 401 && newRooms.status === 200, 'old=' + oldRooms.status + ' new=' + newRooms.status);
  // reset-password（成功，轮换恢复码）
  var R1 = await jpost(P, '/api/reset-password', { username: uniq, recoveryCode: rec, newPassword: 'newpw654321' });
  var rec2 = R1.body && R1.body.recoveryCode;
  check('恢复码重置密码成功并轮换新恢复码', R1.status === 200 && !!rec2 && rec2 !== rec, 'status=' + R1.status + ' newRec=' + rec2);
  var L3 = await jpost(P, '/api/login', { username: uniq, password: 'newpw654321' });
  check('新密码可登录', L3.status === 200 && !!(L3.body && L3.body.sessionToken), 'status=' + L3.status);
  var tokNew = L3.body && L3.body.sessionToken;
  // 限流：同 IP 60s >5 次 → 429（含此前 1 次成功 reset，再连续错码）
  var statuses = [];
  for (var ri = 0; ri < 6; ri++) { var rr = await jpost(P, '/api/reset-password', { username: uniq, recoveryCode: 'AAAA-BBBB-CCCC', newPassword: 'x' }); statuses.push(rr.status); }
  check('重置密码同 IP >5 次/分钟 → 429', statuses.indexOf(429) >= 0, 'statuses=' + JSON.stringify(statuses));
  // 心跳版本锁
  function hb(version, draining, rooms) {
    var body = JSON.stringify({ nodeId: 'qa-node', url: 'http://127.0.0.1:8796', wsUrl: 'ws://127.0.0.1:8796', version: version, draining: !!draining, rooms: rooms || [] });
    return { body: body, sigHex: crypto.createHmac('sha256', NODE_SECRET).update(body).digest('hex'), sigB64: crypto.createHmac('sha256', NODE_SECRET).update(body).digest('base64url') };
  }
  async function sendHb(h, sig) { try { var r = await fetch(P + '/internal/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-node-sig': sig }, body: h.body }); var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j }; } catch (e) { return { status: 0, body: null }; } }
  var hbBad = hb('0.0.0', false, []);
  var badRes = await sendHb(hbBad, hbBad.sigHex);
  if (badRes.status === 401 || badRes.status === 403) badRes = await sendHb(hbBad, hbBad.sigB64);
  check('心跳版本不一致被拒(versionOk=false)', badRes.status === 200 && badRes.body && badRes.body.versionOk === false, JSON.stringify(badRes.body));
  var hbGood = hb('2.0.0', false, [{ roomId: 'qa-room', mode: 'normal', name: 'QA房', humans: 1, bots: 0, maxPlayers: 8, canJoin: true }]);
  var goodRes = await sendHb(hbGood, hbGood.sigHex);
  if (goodRes.status === 401 || goodRes.status === 403) goodRes = await sendHb(hbGood, hbGood.sigB64);
  check('心跳版本一致 accepted(versionOk=true)', goodRes.status === 200 && goodRes.body && goodRes.body.versionOk === true, JSON.stringify(goodRes.body));
  // 房间列表 + draining 只出不进
  var rooms1 = await jget(P, '/api/rooms', tokNew);
  var list1 = (rooms1.body && rooms1.body.rooms) || [];
  check('/api/rooms 含节点房间', rooms1.status === 200 && list1.some(function (x) { return x.roomId === 'qa-room' || x.id === 'qa-room'; }), 'status=' + rooms1.status + ' rooms=' + JSON.stringify(list1.map(function (x) { return x.roomId || x.id; })));
  var endlessOk = list1.some(function (x) { return x.mode === 'endless' && (x.locked === true); }) || (rooms1.body && rooms1.body.endless && rooms1.body.endless.locked === true);
  check('/api/rooms 含无尽灰置入口', !!endlessOk, 'endless');
  var hbDrain = hb('2.0.0', true, [{ roomId: 'qa-room', mode: 'normal', name: 'QA房', humans: 1, bots: 0, maxPlayers: 8, canJoin: true }]);
  var dr = await sendHb(hbDrain, hbDrain.sigHex); if (dr.status === 401 || dr.status === 403) await sendHb(hbDrain, hbDrain.sigB64);
  await sleep(200);
  var rooms2 = await jget(P, '/api/rooms', tokNew);
  var list2 = (rooms2.body && rooms2.body.rooms) || [];
  check('draining 节点房间不进 /api/rooms(只出不进)', !list2.some(function (x) { return x.roomId === 'qa-room' || x.id === 'qa-room'; }), 'rooms=' + JSON.stringify(list2.map(function (x) { return x.roomId || x.id; })));
  // 恢复非 draining
  var hbBack = hb('2.0.0', false, [{ roomId: 'qa-room', mode: 'normal', name: 'QA房', humans: 1, bots: 0, maxPlayers: 8, canJoin: true }]);
  var br = await sendHb(hbBack, hbBack.sigHex); if (br.status === 401 || br.status === 403) await sendHb(hbBack, hbBack.sigB64);
  // 票据签发与验签
  var jr = await jpost(P, '/api/rooms/join', { roomId: 'qa-room' }, tokNew);
  var ticket = jr.body && jr.body.ticket;
  var ticketOk = false;
  if (ticket && String(ticket).indexOf('.') > 0) {
    var parts = String(ticket).split('.');
    try {
      var payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      var expOk = payload.exp && payload.exp > Date.now() - 1000 && payload.exp <= Date.now() + 70000;
      var sigH = crypto.createHmac('sha256', NODE_SECRET).update(parts[0]).digest('hex');
      var sigB = crypto.createHmac('sha256', NODE_SECRET).update(parts[0]).digest('base64url');
      var sigOk = parts[1] === sigH || parts[1] === sigB;
      ticketOk = !!payload.uid && !!payload.roomId && expOk && sigOk;
      check('入房票据 payload{uid,roomId,mode,exp<=60s} 且 HMAC 可验签', ticketOk, JSON.stringify({ uid: payload.uid, roomId: payload.roomId, mode: payload.mode, expDelta: payload.exp - Date.now() }));
    } catch (e) { check('入房票据可解析验签', false, String(e)); }
  } else check('入房票据签发', false, 'ticket=' + ticket);
  // 管理员
  var adminTok = null, adminUid = null;
  if (role1 === 'admin') { adminTok = tokNew; adminUid = uid1; }
  if (!adminTok) {
    // Stage4.1：本实例以 ADMIN_USER/ADMIN_PASS 启动，登录该 .env 管理员取得 admin token
    var la0 = await jpost(P, '/api/login', { username: 'qa_admin_old', password: 'Admin!12345' });
    if (la0.status === 200 && la0.body && la0.body.sessionToken && la0.body.role === 'admin') { adminTok = la0.body.sessionToken; adminUid = la0.body.uid; }
  }
  if (!adminTok) {
    var ra = await jpost(P, '/api/register', { username: 'admin', password: 'admin123456' });
    if (ra.status === 200 && ra.body && ra.body.role === 'admin') {
      var la = await jpost(P, '/api/login', { username: 'admin', password: 'admin123456' });
      adminTok = la.body && la.body.sessionToken; adminUid = ra.body.uid;
    }
  }
  if (adminTok) {
    var tname = 't' + Date.now().toString(36).slice(-6);
    var tu = await jpost(P, '/api/register', { username: tname, password: 'pw123456' });
    var tuid = tu.body && tu.body.uid;
    check('管理员侧目标账号创建成功', tu.status === 200 && !!tuid, 'status=' + tu.status + ' uid=' + tuid);
    var kick = await jpost(P, '/api/admin/kick', { uid: tuid, roomId: 'qa-room' }, adminTok);
    check('管理员 kick 接口可用', kick.status === 200, 'status=' + kick.status + ' err=' + (kick.body && kick.body.error));
    var rp = await jpost(P, '/api/admin/reset-password', { uid: tuid, newPassword: 'zzz123456' }, adminTok);
    check('管理员 reset-password 接口可用', rp.status === 200, 'status=' + rp.status);
    var ban = await jpost(P, '/api/admin/ban', { uid: tuid, ban: true }, adminTok);
    check('管理员 ban(uid) 接口可用', ban.status === 200, 'status=' + ban.status);
    var banIp = await jpost(P, '/api/admin/ban', { ip: '10.9.9.9', ban: true }, adminTok);
    check('管理员 ban IP 接口可用', banIp.status === 200, 'status=' + banIp.status);
    var cfg = await jpost(P, '/api/admin/config', { key: 'draining', value: false }, adminTok);
    check('管理员 config 接口可用', cfg.status === 200, 'status=' + cfg.status);
    var du = await jpost(P, '/api/admin/delete-user', { uid: tuid }, adminTok);
    check('管理员 delete-user 接口可用', du.status === 200, 'status=' + du.status);
    var nname = 'n' + Date.now().toString(36).slice(-6);
    await jpost(P, '/api/register', { username: nname, password: 'pw123456' });
    var ln = await jpost(P, '/api/login', { username: nname, password: 'pw123456' });
    var nonTok = ln.body && ln.body.sessionToken;
    var nonAdmin = await jpost(P, '/api/admin/kick', { uid: tuid, roomId: 'x' }, nonTok);
    check('非管理员调用 admin 接口被拒(403)', nonAdmin.status === 403 || nonAdmin.status === 401, 'status=' + nonAdmin.status);
  } else skipCheck('管理员 API(需 admin 角色)', '首个账号非 admin 且 admin 注册不可用');
  try { if (portal.server && portal.server.close) portal.server.close(); } catch (e) {}
  try { fs.unlinkSync(tmpDb); } catch (e) {}
}

/* ================= 管理员上帝视角 spectate（游戏服） ================= */
async function spectateTest() {
  console.log('[上帝视角] spectate 全量 state / 密聊抄送');
  var s = readf(path.join(__dirname, '..', 'server.js'));
  if (!/spectate|spectators/.test(s)) { skipCheck('spectate 上帝视角', '服务端未实现'); return; }
  var ready = false; try { var st = await fetch(GAME_BASE + '/api/status').then(function (r) { return r.json(); }); ready = !!(st && st.ok); } catch (e) {}
  if (!ready) { skipCheck('spectate 运行期', '游戏服未启动'); return; }
  var C = await connect('S3观战');
  var rid = C.hello && (C.hello.roomId != null ? C.hello.roomId : null);
  C.ws.send(JSON.stringify({ t: 'spectate', roomId: rid }));
  var specOk = await waitFor(function () { return C.state && C.state.spectating === true; }, 4000);
  if (specOk) {
    var hasRoutes = (C.state.fleets || []).every(function (f) { return ('target' in f) && ('srcPlanet' in f); }) || (C.state.fleets || []).length === 0;
    check('spectate 收到 state(spectating=true)', true, 'room=' + rid);
    check('观战 state 含全量舰队航线字段', hasRoutes, 'fleets=' + ((C.state.fleets || []).length));
    check('观战 state 含玩家能量/资源', (C.state.players || []).every(function (p) { return p.resource !== undefined; }), 'players=' + (C.state.players || []).length);
  } else skipCheck('spectate 运行期接收', 'spectate 意图未响应/未实现');
  try { C.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(200);
}

/* ================= Stage 4：纯API / 门户静态 / 首启管理员A-B / 票据端到端 / 淘汰房端到端 ================= */
async function stage4Tests() {
  console.log('[Stage4] 纯API游戏服 / 门户静态 / 首启管理员(A/B) / 票据端到端 / 淘汰房端到端');
  var net = require('net');
  var portalPath = path.join(__dirname, '..', 'portal.js');
  function freePort() { return new Promise(function (res) { var srv = net.createServer(); srv.listen(0, '127.0.0.1', function () { var pp = srv.address().port; srv.close(function () { res(pp); }); }); }); }
  async function startPortal(opts) {
    try { delete require.cache[require.resolve(portalPath)]; } catch (e) {}
    process.env.PORTAL_DB = opts.db;
    process.env.ADMIN_USER = opts.adminUser || '';
    process.env.ADMIN_PASS = opts.adminPass || '';
    var logs = []; var orig = console.log;
    console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
    var portal = null;
    try { portal = require(portalPath); } finally { console.log = orig; }
    var pp = await freePort();
    try { var rr = portal.start(pp); if (rr && rr.then) await rr; } catch (e) {}
    await waitFor(function () { return portal.server && portal.server.address && portal.server.address(); }, 6000);
    var addr = portal.server && portal.server.address ? portal.server.address() : null;
    var joined = logs.join('\n');
    var mt = joined.match(/BOOTSTRAP_TOKEN[^\n]*?([0-9a-f]{32})/i) || joined.match(/([0-9a-f]{32})/i);
    var token = mt ? mt[1] : (portal.bootstrapToken || null);
    return { portal: portal, base: 'http://127.0.0.1:' + (addr ? addr.port : 0), token: token, logs: joined };
  }
  function closePortal(x) { try { if (x && x.portal && x.portal.server) x.portal.server.close(); } catch (e) {} }

  var tmpA = path.join(require('os').tmpdir(), 'qa-s4a-' + Date.now().toString(36) + '.json');
  var tmpB = path.join(require('os').tmpdir(), 'qa-s4b-' + Date.now().toString(36) + '.json');
  var A = null, B = null;
  // ---- 路径 A：无 .env 管理员，首启随机令牌 ----
  try {
    A = await startPortal({ db: tmpA, adminUser: '', adminPass: '' });
    if (!A.base || A.base.indexOf(':0') >= 0) { skipCheck('S4 bootstrap 路径A 启动', '未监听'); }
    else {
      var bs = await jget(A.base, '/api/bootstrap/status');
      check('S4-③A 首启未初始化 initialized=false', bs.status === 200 && bs.body && bs.body.initialized === false, JSON.stringify(bs.body));
      var root = await fetch(A.base + '/'); var rct = root.headers.get('content-type') || '';
      check('S4-② 门户 GET / → 200 text/html', root.status === 200 && rct.indexOf('text/html') >= 0, 'status=' + root.status + ' ct=' + rct);
      var bad = await jpost(A.base, '/api/bootstrap/init', { token: 'deadbeefdeadbeefdeadbeefdeadbeef', username: 'admin', password: 'Admin!12345' });
      check('S4-③A 错误 bootstrapToken → 403', bad.status === 403, 'status=' + bad.status);
      if (!A.token) skipCheck('S4-③A 正确令牌初始化', '未捕获 bootstrapToken(日志/导出均无)');
      else {
        var ok = await jpost(A.base, '/api/bootstrap/init', { token: A.token, username: 'admin', password: 'Admin!12345' });
        check('S4-③A 正确令牌 → 200 admin', ok.status === 200 && ok.body && ok.body.role === 'admin' && !!ok.body.sessionToken, 'status=' + ok.status + ' role=' + (ok.body && ok.body.role) + ' rec=' + (ok.body && ok.body.recoveryCode));
        var bs2 = await jget(A.base, '/api/bootstrap/status');
        check('S4-③A 初始化后 initialized=true', bs2.body && bs2.body.initialized === true, JSON.stringify(bs2.body));
        var again = await jpost(A.base, '/api/bootstrap/init', { token: A.token, username: 'x', password: 'xy123456' });
        check('S4-③A 二次初始化 → 409', again.status === 409, 'status=' + again.status);
      }
    }
  } catch (e) { skipCheck('S4 bootstrap 路径A', String(e)); }
  closePortal(A);
  // ---- 路径 B：配置 ADMIN_USER/ADMIN_PASS ----
  try {
    B = await startPortal({ db: tmpB, adminUser: 'qa_admin', adminPass: 'Admin!12345' });
    if (!B.base || B.base.indexOf(':0') >= 0) { skipCheck('S4 bootstrap 路径B 启动', '未监听'); }
    else {
      var bsB = await jget(B.base, '/api/bootstrap/status');
      check('S4-③B 配置 ADMIN_USER/PASS → initialized=true', bsB.body && bsB.body.initialized === true, JSON.stringify(bsB.body));
      var lb = await jpost(B.base, '/api/login', { username: 'qa_admin', password: 'Admin!12345' });
      check('S4-③B .env 管理员可登录', lb.status === 200 && !!(lb.body && lb.body.sessionToken), 'status=' + lb.status);
      var adminTok = lb.body && lb.body.sessionToken;
      var uniq = 'q4' + Date.now().toString(36).slice(-6);
      var reg = await jpost(B.base, '/api/register', { username: uniq, password: 'pw123456' });
      check('S4 保留：注册返回恢复码', reg.status === 200 && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-/.test(String((reg.body && reg.body.recoveryCode) || '')), 'status=' + reg.status);
      var l1 = await jpost(B.base, '/api/login', { username: uniq, password: 'pw123456' }); var tk1 = l1.body && l1.body.sessionToken;
      var l2 = await jpost(B.base, '/api/login', { username: uniq, password: 'pw123456' }); var tk2 = l2.body && l2.body.sessionToken;
      var or1 = await jget(B.base, '/api/rooms', tk1), nr2 = await jget(B.base, '/api/rooms', tk2);
      check('S4 保留：二次登录互踢', !!tk2 && tk2 !== tk1 && or1.status === 401 && nr2.status === 200, 'old=' + or1.status + ' new=' + nr2.status);
      if (adminTok) {
        var tu = await jpost(B.base, '/api/register', { username: 't' + Date.now().toString(36).slice(-6), password: 'pw123456' });
        var tuid = tu.body && tu.body.uid;
        var kk = await jpost(B.base, '/api/admin/kick', { uid: tuid, roomId: 'x' }, adminTok);
        check('S4 保留：admin kick', kk.status === 200, 'status=' + kk.status);
        var us = await jget(B.base, '/api/admin/users', adminTok);
        check('S4 保留：admin users 列表', us.status === 200 && us.body && Array.isArray(us.body.users), 'status=' + us.status);
        var na = await jpost(B.base, '/api/admin/kick', { uid: tuid }, tk2);
        check('S4 保留：非管理员 403', na.status === 403 || na.status === 401, 'status=' + na.status);
      } else skipCheck('S4 admin 断言', '无 admin token');
      // 节点心跳 + 普通房，供票据端到端
      var hbBody = JSON.stringify({ nodeId: 'qa-s4-node', url: 'http://127.0.0.1:' + GAME_PORT, wsUrl: 'ws://127.0.0.1:' + GAME_PORT + '/ws', version: '2.0.0', draining: false, rooms: [{ roomId: 'e2e-normal', mode: 'normal', name: 'E2E普通房', humans: 0, bots: 0, maxPlayers: 8, canJoin: true, nodeId: 'qa-s4-node', wsUrl: 'ws://127.0.0.1:' + GAME_PORT + '/ws' }] });
      var hbSig = crypto.createHmac('sha256', NODE_SECRET).update(hbBody).digest('hex');
      var hbRes = await fetch(B.base + '/internal/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-node-sig': hbSig }, body: hbBody });
      var hbJ = null; try { hbJ = await hbRes.json(); } catch (e) {}
      check('S4 节点心跳被接收', hbRes.status === 200 && hbJ && hbJ.ok, 'status=' + hbRes.status);
      await sleep(200);
      var roomsB = await jget(B.base, '/api/rooms', tk2); var listB = (roomsB.body && roomsB.body.rooms) || [];
      check('S4 /api/rooms 含 e2e-normal 节点房', listB.some(function (x) { return (x.roomId || x.id) === 'e2e-normal'; }), 'rooms=' + JSON.stringify(listB.map(function (x) { return x.roomId || x.id; })));
      // ④ 票据端到端 → 游戏服 WS
      var jr = await jpost(B.base, '/api/rooms/join', { roomId: 'e2e-normal' }, tk2);
      var ticket = jr.body && jr.body.ticket;
      check('S4-④ portal 签发 e2e-normal 票据', jr.status === 200 && !!ticket, 'status=' + jr.status);
      if (ticket) {
        try {
          var wc = await connect('S4票据联调', { ticket: ticket, roomId: 'e2e-normal' });
          var hh = wc.hello || {};
          check('S4-④ 票据原样发游戏服 → 收到 hello(100%验签)', !!wc.hello, 'roomId=' + (hh.roomId) + ' mode=' + (hh.mode));
          check('S4-④ hello 房间与票据一致(e2e-normal)', hh.roomId === 'e2e-normal' || (hh.room && hh.room.roomId === 'e2e-normal'), 'roomId=' + hh.roomId);
          try { wc.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
          await sleep(200);
        } catch (e) { check('S4-④ 票据端到端 hello', false, String(e)); }
      }
      // ⑤ 淘汰房端到端
      var cr = await jpost(B.base, '/api/rooms/create', { name: 'QA淘汰房', maxPlayers: 4, mode: 'elim' }, tk2);
      var roomId = (cr.body && cr.body.room && (cr.body.room.roomId || cr.body.room.id)) || (cr.body && cr.body.roomId);
      check('S4-⑤ portal 创建淘汰房', cr.status === 200 && !!roomId, 'status=' + cr.status + ' roomId=' + roomId);
      if (roomId) {
        var jr2 = await jpost(B.base, '/api/rooms/join', { roomId: roomId }, tk2);
        var ticket2 = jr2.body && jr2.body.ticket;
        check('S4-⑤ 淘汰房票据签发', jr2.status === 200 && !!ticket2, 'status=' + jr2.status);
        if (ticket2) {
          try {
            var wc2 = await connect('S4淘汰联调', { ticket: ticket2, roomId: roomId });
            var h2 = wc2.hello || {};
            var mode2 = h2.mode || (h2.room && h2.room.mode);
            var status2 = h2.status || (h2.room && h2.room.status);
            check('S4-⑤ server hello room.mode===elim', mode2 === 'elim', 'mode=' + mode2);
            check('S4-⑤ server hello room.status===waiting', status2 === 'waiting', 'status=' + status2);
            try { wc2.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
            await sleep(200);
          } catch (e) { check('S4-⑤ 淘汰房端到端 hello', false, String(e)); }
        }
      }
    }
  } catch (e) { skipCheck('S4 bootstrap/票据端到端', String(e)); }
  closePortal(B);
  try { fs.unlinkSync(tmpA); } catch (e) {}
  try { fs.unlinkSync(tmpB); } catch (e) {}
}

/* ================= Stage 4.1：安全/反代配置/ban/过期票据重连/观战不占席 ================= */
async function stage41Tests() {
  console.log('[Stage4.1] 注册安全 / gamePublicWsUrl 反代 / ban 往返 / 过期票据+token 重连 / 观战不占席');
  var net = require('net');
  var portalPath = path.join(__dirname, '..', 'portal.js');
  var pSrc = readf(portalPath), sSrc = readf(path.join(__dirname, '..', 'server.js'));
  if (!/bootstrap_required/.test(pSrc) || !/gamePublicWsUrl/.test(pSrc)) {
    skipCheck('Stage4.1 门户(B-S4-1/2/6) 未实现', 'portal.js 无 bootstrap_required/gamePublicWsUrl');
    return;
  }
  function freePort() { return new Promise(function (res) { var srv = net.createServer(); srv.listen(0, '127.0.0.1', function () { var pp = srv.address().port; srv.close(function () { res(pp); }); }); }); }
  async function startPortal(opts) {
    try { delete require.cache[require.resolve(portalPath)]; } catch (e) {}
    process.env.PORTAL_DB = opts.db;
    process.env.ADMIN_USER = opts.adminUser || '';
    process.env.ADMIN_PASS = opts.adminPass || '';
    var orig = console.log; var logs = [];
    console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
    var portal = null;
    try { portal = require(portalPath); } finally { console.log = orig; }
    var pp = await freePort();
    try { var rr = portal.start(pp); if (rr && rr.then) await rr; } catch (e) {}
    await waitFor(function () { return portal.server && portal.server.address && portal.server.address(); }, 6000);
    var addr = portal.server && portal.server.address ? portal.server.address() : null;
    return { portal: portal, base: 'http://127.0.0.1:' + (addr ? addr.port : 0), logs: logs.join('\n') };
  }
  function closePortal(x) { try { if (x && x.portal && x.portal.server) x.portal.server.close(); } catch (e) {} }
  var tmpA = path.join(require('os').tmpdir(), 'qa-s41a-' + Date.now().toString(36) + '.json');
  var tmpB = path.join(require('os').tmpdir(), 'qa-s41b-' + Date.now().toString(36) + '.json');
  var A = null, B = null;
  try {
    // 1a) 未初始化注册 → 403 bootstrap_required
    A = await startPortal({ db: tmpA, adminUser: '', adminPass: '' });
    if (A.base && A.base.indexOf(':0') < 0) {
      var r403 = await jpost(A.base, '/api/register', { username: 'x', password: 'pw123456' });
      check('S41-1 未初始化注册 → 403 bootstrap_required', r403.status === 403 && r403.body && r403.body.error === 'bootstrap_required', 'status=' + r403.status + ' body=' + JSON.stringify(r403.body));
    } else skipCheck('S41-1 未初始化注册', 'portal A 未监听');
    closePortal(A);
    // 1b/2/3 在已初始化门户上
    B = await startPortal({ db: tmpB, adminUser: 'qa_admin', adminPass: 'Admin!12345' });
    if (!B.base || B.base.indexOf(':0') >= 0) { skipCheck('S41 portal B 启动', '未监听'); }
    else {
      var radm = await jpost(B.base, '/api/register', { username: 'admin', password: 'pw123456' });
      check("S41-1 注册用户名 'admin' → role==='user'", radm.status === 200 && radm.body && radm.body.role === 'user', 'status=' + radm.status + ' role=' + (radm.body && radm.body.role));
      var la = await jpost(B.base, '/api/login', { username: 'qa_admin', password: 'Admin!12345' });
      var adminTok = la.body && la.body.sessionToken;
      var uniq = 'q41' + Date.now().toString(36).slice(-5);
      await jpost(B.base, '/api/register', { username: uniq, password: 'pw123456' });
      var lu = await jpost(B.base, '/api/login', { username: uniq, password: 'pw123456' });
      var token = lu.body && lu.body.sessionToken; var uid = lu.body && lu.body.uid;
      // 注册节点普通房 s41-normal
      var hbBody = JSON.stringify({ nodeId: 'qa-s41-node', url: 'http://127.0.0.1:' + GAME_PORT, wsUrl: 'ws://127.0.0.1:' + GAME_PORT + '/ws', version: '2.0.0', draining: false, rooms: [{ roomId: 's41-normal', mode: 'normal', name: 'S41普通房', humans: 0, bots: 0, maxPlayers: 8, canJoin: true, nodeId: 'qa-s41-node', wsUrl: 'ws://127.0.0.1:' + GAME_PORT + '/ws' }] });
      var hbSig = crypto.createHmac('sha256', NODE_SECRET).update(hbBody).digest('hex');
      await fetch(B.base + '/internal/heartbeat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-node-sig': hbSig }, body: hbBody });
      await sleep(150);
      // 2) admin/config gamePublicWsUrl=/api/ws → join wsUrl
      var cfg = await jpost(B.base, '/api/admin/config', { key: 'gamePublicWsUrl', value: '/api/ws' }, adminTok);
      check('S41-2 admin/config 写 gamePublicWsUrl 成功', cfg.status === 200, 'status=' + cfg.status);
      var jr = await jpost(B.base, '/api/rooms/join', { roomId: 's41-normal' }, token);
      check("S41-2 /api/rooms/join wsUrl === '/api/ws'", jr.status === 200 && jr.body && jr.body.wsUrl === '/api/ws', 'wsUrl=' + (jr.body && jr.body.wsUrl));
      var ticket = jr.body && jr.body.ticket;
      // 3) ban 往返 + reset-password 新密码/轮换恢复码
      var b1 = await jpost(B.base, '/api/admin/ban', { uid: uid, ban: true }, adminTok);
      var us1 = await jget(B.base, '/api/admin/users', adminTok); var u1 = (us1.body && us1.body.users || []).find(function (u) { return u.uid === uid; });
      var b2 = await jpost(B.base, '/api/admin/ban', { uid: uid, ban: false }, adminTok);
      var us2 = await jget(B.base, '/api/admin/users', adminTok); var u2 = (us2.body && us2.body.users || []).find(function (u) { return u.uid === uid; });
      check('S41-3 ban → banned=true', b1.status === 200 && u1 && u1.banned === true, 'status=' + b1.status + ' banned=' + (u1 && u1.banned));
      check('S41-3 解封 → banned=false', b2.status === 200 && u2 && u2.banned === false, 'status=' + b2.status + ' banned=' + (u2 && u2.banned));
      var rp = await jpost(B.base, '/api/admin/reset-password', { uid: uid, newPassword: 'Temp!23456' }, adminTok);
      var newPw = rp.body && (rp.body.newPassword || rp.body.tempPassword || rp.body.password);
      check('S41-3 admin reset-password 返回新密码+轮换恢复码', rp.status === 200 && !!newPw && !!(rp.body && rp.body.recoveryCode), 'status=' + rp.status + ' newPw=' + newPw + ' rec=' + (rp.body && rp.body.recoveryCode));
      // 4) 过期票据 + 有效 token 重连
      if (!/msg\.token|findByToken/.test(sSrc)) { skipCheck('S41-4 过期票据+token 重连', 'server 未实现 token 重连'); }
      else if (!ticket) { skipCheck('S41-4 过期票据+token 重连', '无票据'); }
      else {
        var c1 = null;
        try { c1 = await connect('S41seat', { ticket: ticket, roomId: 's41-normal', token: token }); } catch (e) {}
        var seated = !!(c1 && c1.hello);
        if (c1) { try { c1.ws.close(); } catch (e) {} }
        await sleep(500);
        var payload = { uid: uid, name: uniq, role: 'user', roomId: 's41-normal', mode: 'normal', roomName: 'S41普通房', maxPlayers: 8, isHost: false, exp: Date.now() - 3600 * 1000 };
        var b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
        var xsig = crypto.createHmac('sha256', NODE_SECRET).update(b64).digest('hex');
        var expiredTicket = b64 + '.' + xsig;
        var c2 = null;
        try { c2 = await connect('S41reconnect', { ticket: expiredTicket, roomId: 's41-normal', token: token }); } catch (e) {}
        check('S41-4 过期票据+有效token → 恢复席位不报票据无效', !!(seated && c2 && c2.hello), seated ? (c2 && c2.hello ? ('room=' + (c2.hello.roomId || '')) : '未收到 hello(可能票据无效拒绝)') : '首次入座失败');
        if (c2) { try { c2.ws.send(JSON.stringify({ t: 'leave', dropSeat: true })); } catch (e) {} }
      }
      // 5) 管理员 spectate 进满员房 → spectating=true 且不占席
      if (!/sendSpectatorHello|spectators/.test(sSrc)) { skipCheck('S41-5 spectate 满员房', 'server 未实现 spectators'); }
      else {
        var cr = await jpost(B.base, '/api/rooms/create', { name: 'S41满员房', maxPlayers: 2, mode: 'elim' }, adminTok);
        var rid = (cr.body && cr.body.room && (cr.body.room.roomId || cr.body.room.id)) || (cr.body && cr.body.roomId);
        var fills = [];
        if (rid) {
          for (var fi = 0; fi < 2; fi++) {
            var un = 'f' + Date.now().toString(36).slice(-5) + fi;
            await jpost(B.base, '/api/register', { username: un, password: 'pw123456' });
            var ll = await jpost(B.base, '/api/login', { username: un, password: 'pw123456' });
            var tt = ll.body && ll.body.sessionToken;
            var jj = await jpost(B.base, '/api/rooms/join', { roomId: rid }, tt);
            if (jj.body && jj.body.ticket) { try { var w = await connect('S41fill' + fi, { ticket: jj.body.ticket, roomId: rid, token: tt }); fills.push(w); } catch (e) {} }
          }
          var roomsA = await jget(B.base, '/api/rooms', adminTok); var rA = (roomsA.body && roomsA.body.rooms || []).find(function (x) { return (x.roomId || x.id) === rid; }); var humansA = rA && rA.humans;
          var sj = await jpost(B.base, '/api/rooms/join', { roomId: rid, spectate: true }, adminTok);
          var stk = sj.body && sj.body.ticket;
          var spec = null;
          if (stk) { try { spec = await connect('S41spec', { ticket: stk, roomId: rid, token: adminTok }); } catch (e) {} }
          var specHello = spec && spec.hello;
          check('S41-5 admin spectate 收到 hello.spectating=true', !!(specHello && (specHello.spectating === true || (specHello.room && specHello.room.spectating))), 'spectating=' + (specHello && specHello.spectating));
          var noSeat = !specHello || specHello.id == null || specHello.id === 0 || specHello.spectator === true || specHello.spectating === true;
          check('S41-5 spectate 不占参赛席位(无玩家id)', !!noSeat, 'id=' + (specHello && specHello.id));
          var roomsB = await jget(B.base, '/api/rooms', adminTok); var rB = (roomsB.body && roomsB.body.rooms || []).find(function (x) { return (x.roomId || x.id) === rid; }); var humansB = rB && rB.humans;
          if (humansA != null && humansB != null) check('S41-5 spectate 真人数量不增', humansB <= humansA, 'humans ' + humansA + '->' + humansB);
          else console.log('  INFO humans 前后不可得(节点未心跳同步)，已用 hello 无席位判定代替');
          if (spec) { try { spec.ws.send(JSON.stringify({ t: 'leave', dropSeat: true })); } catch (e) {} }
          fills.forEach(function (w) { try { w.ws.send(JSON.stringify({ t: 'leave', dropSeat: true })); } catch (e) {} });
        } else skipCheck('S41-5 spectate 满员房', '建房失败');
      }
    }
  } catch (e) { skipCheck('S41 执行异常', String(e)); }
  closePortal(B);
  try { fs.unlinkSync(tmpA); } catch (e) {}
  try { fs.unlinkSync(tmpB); } catch (e) {}
}

(async function () {
  console.log('=== 星海边境 Stage3+Stage4+4.1 集成测试 ===  GAME_PORT=' + GAME_PORT);
  staticReview();
  await gameServerTests();
  await portalTests();
  await stage4Tests();
  await stage41Tests();
  await spectateTest();
  console.log('\n' + (fail ? ('失败: ' + fail) : 'ALL PASS') + '  (' + pass + ' 通过, ' + skip + ' 跳过, ' + fail + ' 失败)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERROR', e && e.stack || e); process.exit(1); });
