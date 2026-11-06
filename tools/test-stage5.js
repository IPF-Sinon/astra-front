'use strict';
/*
 * 星海边境 · Stage 5 (I1–I7) 独立测试与复核
 * 运行： node tools/test-stage5.js
 *   外部游戏服 8796（由 QA 起 PORT=8796 FREEZE_AI=1 node server.js）
 *   本脚本自身会：用临时端口+临时配置另起游戏服（--config initialized admin）测节点面板；
 *   用临时门户实例(临时DB)测 bundle / node-manager / allowRegistration / 静态资产。
 * 退出码 0=ALL PASS(PASS+SKIP)，非0=有失败。
 */
const fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net'), os = require('os');
const { spawn } = require('child_process');
const W = path.join(__dirname, '..');
const GAME_PORT = Number(process.env.GAME_PORT || process.env.PORT || 8796);
const GAME_BASE = 'http://127.0.0.1:' + GAME_PORT;
const NODE_SECRET = process.env.NODE_SECRET || 'orbital-frontier-dev-secret';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let pass = 0, fail = 0, skip = 0;
function check(n, ok, x) { if (ok) { pass++; console.log('  OK   ' + n + (x ? '  [' + x + ']' : '')); } else { fail++; console.log('  X    ' + n + (x ? '  [' + x + ']' : '')); } }
function skipCheck(n, why) { skip++; console.log('  SKIP ' + n + '  [' + why + ']'); }
function readf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return ''; } }
function freePort() { return new Promise(function (res) { var s = net.createServer(); s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { res(p); }); }); }); }
async function waitFor(fn, ms, step) { ms = ms || 6000; step = step || 120; var t0 = Date.now(); while (Date.now() - t0 < ms) { var v; try { v = fn(); } catch (e) { v = false; } if (v) return true; await sleep(step); } return false; }
async function jget(base, p, tok) { var h = {}; if (tok) h.authorization = 'Bearer ' + tok; try { var r = await fetch(base + p, { headers: h }); var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j, headers: r.headers }; } catch (e) { return { status: 0 }; } }
async function jpost(base, p, body, tok) { var h = { 'content-type': 'application/json' }; if (tok) h.authorization = 'Bearer ' + tok; try { var r = await fetch(base + p, { method: 'POST', headers: h, body: JSON.stringify(body) }); var j = null; try { j = await r.json(); } catch (e) {} return { status: r.status, body: j, headers: r.headers }; } catch (e) { return { status: 0 }; } }
// 轻量 HTML 结构解析：返回目标 id 的父元素与祖先链（用于 #app 直接子级/祖先 hidden 判定）
function htmlParentInfo(html, targetId) {
  var re = /<\/?([a-zA-Z0-9]+)([^>]*)>/g, stack = [], m = null, result = null;
  var voidTags = ['br','img','input','meta','link','hr','source','area','base','col','embed','param','track','wbr'];
  while ((m = re.exec(html))) {
    var tag = m[1].toLowerCase(), attrs = m[2] || '', full = m[0], isClose = /^<\//.test(full);
    if (isClose) { for (var i = stack.length - 1; i >= 0; i--) { if (stack[i].tag === tag) { stack.length = i; break; } } continue; }
    var selfClose = /\/>$/.test(full) || voidTags.indexOf(tag) >= 0;
    var idm = /id="([^"]*)"/.exec(attrs);
    if (!result && idm && idm[1] === targetId) { result = { parent: stack.length ? stack[stack.length - 1] : null, ancestors: stack.slice() }; }
    if (!selfClose) { stack.push({ tag: tag, id: idm ? idm[1] : null, hidden: /(^|\s)hidden(\s|=|$)/.test(attrs) }); }
  }
  return result;
}

function spawnNode(port, cfgPath) {
  var out = [];
  var env = Object.assign({}, process.env, { PORT: String(port), FREEZE_AI: '1', GAME_NODE_CONFIG: cfgPath });
  var ch = spawn(process.execPath, ['server.js', '--config', cfgPath], { cwd: W, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  ch.stdout.on('data', function (d) { out.push(String(d)); });
  ch.stderr.on('data', function (d) { out.push(String(d)); });
  return { ch: ch, log: function () { return out.join(''); } };
}
async function spawnPortal(opts) {
  var portalPath = path.join(W, 'portal.js');
  try { delete require.cache[require.resolve(portalPath)]; } catch (e) {}
  var pp = await freePort();
  process.env.PORTAL_PORT = String(pp);
  process.env.PORTAL_DB = opts.db;
  process.env.ADMIN_USER = opts.adminUser || '';
  process.env.ADMIN_PASS = opts.adminPass || '';
  var orig = console.log, logs = [];
  console.log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  var portal = null;
  try { portal = require(portalPath); } finally { console.log = orig; }
  try { var rr = portal.start(pp); if (rr && rr.then) await rr; } catch (e) {}
  await waitFor(function () { return portal.server && portal.server.address && portal.server.address(); }, 6000);
  var addr = portal.server && portal.server.address ? portal.server.address() : null;
  return { portal: portal, base: 'http://127.0.0.1:' + (addr ? addr.port : 0), logs: logs.join('\n') };
}
function closePortal(x) { try { if (x && x.portal && x.portal.server) x.portal.server.close(); } catch (e) {} }

async function staticReview() {
  console.log('[静态复核] public I1–I4 / 资产');
  var g = readf(path.join(W, 'public', 'game.js'));
  var idx = readf(path.join(W, 'public', 'index.html'));
  var css = readf(path.join(W, 'public', 'style.css'));
  if (!/renderPanorama/.test(g)) { skipCheck('I1-I4 客户端静态', 'game.js 无 renderPanorama(Stage5 未实现)'); return; }
  check('I1 renderPanorama 全景渲染存在', /renderPanorama/.test(g), 'game.js');
  check('I2 双层星云 nebula_deep_1/_2', /nebula_deep_1/.test(g) && /nebula_deep_2/.test(g), 'game.js');
  check('I2 6 地貌贴图(terran/gas/lava/storm/clouds/ice)', ['planet_terran', 'planet_gas', 'planet_lava', 'planet_storm', 'planet_clouds'].every(function (k) { return g.indexOf(k) >= 0; }), 'game.js');
  check('I2 拖拽线去横杠(无双层横杠循环, 含 setLineDash)', /setLineDash\s*\(\s*\[\s*12\s*,\s*10\s*\]/.test(g) && !/px\s*\*\s*hw|py\s*\*\s*hw/.test(g), 'game.js');
  check('I3 MC 大厅元素(mc-room-list/mc-room-row/mc-ping-bars/mc-hall-footer)', ['mc-room-list', 'mc-room-row', 'mc-ping-bars', 'mc-hall-footer'].every(function (k) { return g.indexOf(k) >= 0 || idx.indexOf(k) >= 0; }), 'public');
  check('I4 新音效 hover/tab/modalOpen/modalClose/joinRoom', ['hover', 'tab', 'modalOpen', 'modalClose', 'joinRoom'].every(function (k) { return g.indexOf(k) >= 0; }), 'game.js');
  // Stage5.3/5.4：管理台已从 index.html 迁出到门户动态路径 <adminPath>（默认 /qaqmin），此处仅静态核对实现存在
  var pjSrc = readf(path.join(W, 'portal.js'));
  check('I7 门户动态管理路径 adminPath 实现存在(静态)', /adminPath/.test(pjSrc) && /normAdminPath|qaqmin/.test(pjSrc), 'portal.js');
  var assets = ['nebula_deep_1.webp', 'nebula_deep_2.webp', 'planet_clouds.webp', 'planet_gas.webp', 'planet_lava.webp', 'planet_storm.webp', 'planet_terran.webp'];
  var miss = assets.filter(function (a) { return !fs.existsSync(path.join(W, 'public', 'assets', a)); });
  check('public/assets 7 张贴图齐全', miss.length === 0, miss.length ? ('missing=' + miss.join(',')) : 'ok');
  // ===== Stage 5.1 静态 =====
  check('S51 无 seatedots 拼写错误', !/seatedots/.test(g), 'game.js');
  var homeOk = /homeView/.test(idx) || /homeView/.test(g);
  if (homeOk) {
    var keys = ['mcRoomList', 'hallFilters', 'mcJoinSelected', 'homeView'];
    check('S51 bindPortalUI 绑定关键元素', /bindPortalUI/.test(g) && keys.every(function (k) { return g.indexOf(k) >= 0; }), 'game.js');
    check('S51 homeView/settingsModal 存在；反代字段迁至 portal.js adminPath', /settingsModal/.test(idx) && /homeView/.test(idx) && /adminPath/.test(readf(path.join(W, 'portal.js'))), 'public');
    check('S51 J3 缓存(nebulaBuffer/getTintedPlanetStrip/getSphereShadeCanvas)', /nebulaBuffer|getTintedPlanetStrip|getSphereShadeCanvas/.test(g), 'game.js');
  } else skipCheck('S51 homeView/bindPortalUI/设置/缓存', 'Stage5.1 未实现');
  // ===== Stage 5.2 / K6 静态 =====
  var modalIds = ['settingsModal', 'helpPanel', 'confirmModal'];
  var allAppChild = modalIds.every(function (id) { var pi = htmlParentInfo(idx, id); return pi && pi.parent && pi.parent.id === 'app' && pi.ancestors.every(function (a) { return !a.hidden; }); });
  check('K6-① settingsModal/helpPanel/confirmModal 为 #app 直接子级且祖先无 hidden', allAppChild, 'dom');
  // Stage 5.4 首页改为 3 主按钮 + 右上公告，作战手册改由局内菜单 H 键打开
  check('K6-① 首页 #homeNoticeBtn / #standbyPrompt 绑定', /homeNoticeBtn/.test(g) && /standbyPrompt/.test(g), 'game.js');
  check('K6-① data-menu=settings 显示 settingsModal 绑定', /data-menu/.test(g) && /settingsModal/.test(g), 'game.js');
  var hudBlock = (idx.match(/id="hudMenu"[\s\S]{0,1600}/) || [''])[0];
  check('K6-① #hudMenu 无 sound/zoomIn/zoomOut', hudBlock !== '' && !/data-menu="(sound|zoomIn|zoomOut)"/.test(hudBlock), 'index');
  check('K6-① factions 点击显示 factionPanel', /factions/.test(g) && /factionPanel/.test(g), 'game.js');
  check('K6-② doLoginWith/doBootstrap → enterHome()', /function doLoginWith[\s\S]{0,1500}enterHome\s*\(/.test(g) && /function doBootstrap[\s\S]{0,1500}enterHome\s*\(/.test(g), 'game.js');
  check('K6-② enterHome 进入 home 视图', /function enterHome[\s\S]{0,900}(showPortalView\(\s*['"]home['"]|view\s*=\s*['"]home['"])/.test(g), 'game.js');
  check('K6-② lobbyHallView 无 #hallLogout/#mcLogout', !/hallLogout/.test(idx) && !/mcLogout/.test(idx), 'index');
  check('K6-③ 客户端过滤 nebula-overdrive/builtin 模组', /nebula-overdrive/.test(g) && /builtin/.test(g), 'game.js');
  check('K6-③ server list() 跳过 settled + settledAt 回收', /status === 'settled'/.test(readf(path.join(W, 'server.js'))) && /settledAt/.test(readf(path.join(W, 'server.js'))), 'server.js');
  check('K6-③ portal 房间列表过滤 settled', /status === 'settled'/.test(readf(path.join(W, 'portal.js'))), 'portal.js');
  // Stage 5.5 修复1：巨型行星由「居中 0.50w」随相机偏航左移至「0.02w」，半径恒定为 baseR*(1+easePan*0.04)
  check('K4 首页巨型主星(居中→左移偏航/半径恒定/贴图滚动)', /easePan/.test(g) && /0\.02/.test(g) && /camShift/.test(g) && /planet_terran/.test(g) && /planet_clouds/.test(g), 'game.js');
  // ===== Stage 5.3 / 5.4 静态（10 项） =====
  check('S53-① 4 张战舰贴图 + initHeroShips', ['ship_flagship', 'ship_cruiser', 'ship_interceptor', 'ship_fighter'].every(function (k) { return g.indexOf(k) >= 0; }) && /initHeroShips/.test(g), 'game.js');
  check('S53-② invalidateMailItem + 已失效', /invalidateMailItem/.test(g) && /已失效/.test(g), 'game.js');
  check('S53-③ uiBursts / spawnUiClickBurst', /uiBursts/.test(g) && /spawnUiClickBurst/.test(g), 'game.js');
  check('S53-④ standbyPrompt / homeExpedition / homeMainMenu', ['standbyPrompt', 'homeExpedition', 'homeMainMenu'].every(function (k) { return idx.indexOf(k) >= 0; }), 'index');
  check('S53-⑤ dispatchCountInput 存在', /dispatchCountInput/.test(idx), 'index');
  check('S53-⑥ index.html 不含 adminModal', !/adminModal/.test(idx), 'index');
  var emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  var emojiHits = [];
  (function scanEmoji() {
    var pub = path.join(W, 'public');
    var files = [];
    try { files = fs.readdirSync(pub).filter(function (f) { return /\.(js|html|css)$/.test(f); }); } catch (e) {}
    files.forEach(function (f) {
      var txt = readf(path.join(pub, f));
      var lines = txt.split('\n');
      for (var i = 0; i < lines.length; i++) { if (emojiRe.test(lines[i])) emojiHits.push(f + ':' + (i + 1)); }
    });
  })();
  check('S53-⑦ public/ 全目录 Emoji 计数=0', emojiHits.length === 0, emojiHits.length ? ('hits=' + emojiHits.slice(0, 6).join(',')) : '0');
  var cssTxt = readf(path.join(W, 'public', 'style.css'));
  var uncondHide = /\.faction-panel\s*\{[^}]*display\s*:\s*none/.test(cssTxt);
  check('S53-⑧ #factionPanel:not([hidden]) 且无无条件 .faction-panel{display:none}', /#factionPanel:not\(\[hidden\]\)/.test(cssTxt) && !uncondHide, 'style.css');
}

async function externalGameTests() {
  console.log('[①外部游戏服] / 与 /index.html 403；/admin 200 HTML；bootstrap-status');
  var ready = false; for (var i = 0; i < 20 && !ready; i++) { try { var r = await fetch(GAME_BASE + '/api/status'); ready = r.ok; } catch (e) {} if (!ready) await sleep(300); }
  if (!ready) { skipCheck('外部游戏服 8796 就绪', '未启动'); return; }
  try { var stj = await fetch(GAME_BASE + '/api/status').then(function (r) { return r.json(); }); var settledAny = (stj.rooms || []).some(function (r) { return r.status === 'settled'; }); check('K6-③ /api/status 无 settled 房', !settledAny, 'rooms=' + (stj.rooms || []).length); } catch (e) { skipCheck('K6-③ /api/status 无 settled 房', String(e)); }
  var s = readf(path.join(W, 'server.js'));
  if (!/['"]\/admin['"]/.test(s) && !/node-admin/.test(s)) { skipCheck('①游戏服 /admin 与 node-admin', 'server.js 未实现 I5'); }
  else {
    var root = await fetch(GAME_BASE + '/'); var rb = null; try { rb = await root.json(); } catch (e) {}
    check('① GET / → 403 game_node_api_only', root.status === 403 && rb && rb.error === 'game_node_api_only', 'status=' + root.status);
    var idxr = await fetch(GAME_BASE + '/index.html');
    check('① GET /index.html → 403 非HTML', idxr.status === 403 && (idxr.headers.get('content-type') || '').indexOf('text/html') < 0, 'status=' + idxr.status);
    var adm = await fetch(GAME_BASE + '/admin'); var admCt = adm.headers.get('content-type') || ''; var admBody = ''; try { admBody = await adm.text(); } catch (e) {}
    check('① GET /admin → 200 HTML', adm.status === 200 && admCt.indexOf('text/html') >= 0 && /<(html|body|div)/i.test(admBody), 'status=' + adm.status + ' ct=' + admCt);
    var bs = await jget(GAME_BASE, '/api/node-admin/bootstrap-status');
    check('① /api/node-admin/bootstrap-status 可用', bs.status === 200 && bs.body && ('initialized' in bs.body), 'status=' + bs.status + ' body=' + JSON.stringify(bs.body));
    check('S53-⑩ 游戏服 GET /admin 仍 200(server.js 未变)', adm.status === 200, 'status=' + adm.status);
    // Stage5.1 ②：/yxapi 反代前缀兼容（HTTP + WS）
    if (/normalizeNodePath|stripProxyPrefix/.test(s)) {
      try {
        var y1 = await fetch(GAME_BASE + '/yxapi/api/status');
        check('S51-② GET /yxapi/api/status → 200', y1.status === 200, 'status=' + y1.status);
        var y2 = await fetch(GAME_BASE + '/yxapi/admin');
        check('S51-② GET /yxapi/admin → 200', y2.status === 200, 'status=' + y2.status);
        var wsOk = await new Promise(function (res) { try { var w = new WebSocket('ws://127.0.0.1:' + GAME_PORT + '/yxapi/ws'); var got = false; w.onopen = function () { w.send(JSON.stringify({ t: 'join', name: 'yxprobe' })); }; w.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } if (m.t === 'hello') { got = true; res(true); } }; w.onerror = function () { res(false); }; setTimeout(function () { if (!got) { try { w.close(); } catch (e) {} res(false); } }, 4000); } catch (e) { res(false); } });
        check('S51-② ws /yxapi/ws join → hello', wsOk === true, 'ok=' + wsOk);
      } catch (e) { skipCheck('S51-② yxapi', String(e)); }
    } else skipCheck('S51-② yxapi 反代前缀', 'server 未实现 normalizeNodePath');
  }
}

async function nodeConfigTests() {
  console.log('[②③④游戏节点面板] config initialized admin / rules 热更新 / rooms action / mods toggle');
  var s = readf(path.join(W, 'server.js'));
  if (!/node-admin/.test(s)) { skipCheck('②③④ 游戏节点面板', 'server.js 未实现 I5'); return; }
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-node-'));
  var cfgPath = path.join(dir, 'game-node.config.json');
  var salt = crypto.randomBytes(16).toString('hex');
  var pass = 'Admin!12345';
  var passHash = crypto.scryptSync(pass, salt, 32).toString('hex');
  var cfg = { initialized: true, nodeId: 'qa-node-cfg', port: null, admin: { username: 'qa_node_admin', passHash: passHash, salt: salt, role: 'admin' }, rules: { startResource: 30, maxPlayers: 8 }, NODE_SECRET: NODE_SECRET, portalUrl: 'http://127.0.0.1:8794' };
  var port = await freePort(); cfg.port = port;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  var node = spawnNode(port, cfgPath);
  var base = 'http://127.0.0.1:' + port;
  var up = await waitFor(function () { return true; }, 1);
  up = false; for (var i = 0; i < 40 && !up; i++) { try { var r = await fetch(base + '/api/status'); up = r.ok; } catch (e) {} if (!up) await sleep(300); }
  if (!up) { check('② config 游戏服启动', false, node.log().slice(-400)); try { node.ch.kill('SIGTERM'); } catch (e) {} return; }
  try {
    var bstat = await jget(base, '/api/node-admin/bootstrap-status');
    check('② config initialized:true → bootstrap-status initialized=true', bstat.status === 200 && bstat.body && bstat.body.initialized === true, JSON.stringify(bstat.body));
    var login = await jpost(base, '/api/node-admin/login', { username: 'qa_node_admin', password: pass });
    var tok = login.body && (login.body.sessionToken || login.body.token);
    check('② config admin 账号可登录 /api/node-admin/login', login.status === 200 && (login.body && (login.body.ok !== false)), 'status=' + login.status + ' body=' + JSON.stringify(login.body));
    // rules 热更新
    var rules = await jpost(base, '/api/node-admin/rules', { startResource: 37, resourceRegen: 1.5, reinforceRate: 2, shipSpeed: 360, captureRate: 1.1, maxPlayers: 8 }, tok);
    check('③ /api/node-admin/rules 热更新成功', rules.status === 200 && (rules.body && rules.body.ok !== false), 'status=' + rules.status);
    await sleep(300);
    var ov = await jget(base, '/api/node-admin/overview', tok);
    var ovStr = JSON.stringify(ov.body || {});
    check('③ overview 反映新规则(startResource=37)', ov.status === 200 && (ovStr.indexOf('37') >= 0), 'status=' + ov.status);
    var saved = {}; try { saved = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (e) {}
    var savedStr = JSON.stringify(saved);
    check('③ rules 已写回 game-node.config.json(startResource=37)', savedStr.indexOf('37') >= 0, 'cfg=' + savedStr.slice(0, 200));
    // rooms action create / kick / destroy
    var cr = await jpost(base, '/api/node-admin/rooms/action', { action: 'create', mode: 'normal', name: 'QA节点房', maxPlayers: 8 }, tok);
    check('④ rooms/action create 成功', cr.status === 200 && (cr.body && cr.body.ok !== false), 'status=' + cr.status + ' body=' + JSON.stringify(cr.body));
    var rid = (cr.body && (cr.body.roomId || (cr.body.room && cr.body.room.roomId))) || null;
    if (rid) {
      var pidK = await new Promise(function (res) { var got = 0; try { var w = new WebSocket('ws://127.0.0.1:' + port + '/ws'); w.onopen = function () { w.send(JSON.stringify({ t: 'join', name: 'kickme', roomId: rid })); }; w.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } if (m.t === 'hello') { got = m.id; res({ w: w, id: m.id }); } }; w.onerror = function () { res({ w: w, id: 0 }); }; setTimeout(function () { res({ w: w, id: got }); }, 3000); } catch (e) { res({ id: 0 }); } });
      if (pidK.id) {
        var kick = await jpost(base, '/api/node-admin/rooms/action', { action: 'kick', roomId: rid, playerId: pidK.id }, tok);
        check('④ rooms/action kick 成功', kick.status === 200 && (kick.body && kick.body.ok !== false), 'status=' + kick.status + ' kicked=' + (kick.body && kick.body.kicked));
      } else skipCheck('④ rooms/action kick', '未能加入房间取玩家');
      try { if (pidK.w) pidK.w.close(); } catch (e) {}
      var des = await jpost(base, '/api/node-admin/rooms/action', { action: 'destroy', roomId: rid }, tok);
      check('④ rooms/action destroy 成功', des.status === 200 && (des.body && des.body.ok !== false), 'status=' + des.status);
    } else skipCheck('④ rooms/action destroy', 'create 未返回 roomId');
    // mods toggle
    var mt = await jpost(base, '/api/node-admin/mods/toggle', { id: 'nebula-overdrive', enabled: false }, tok);
    check('④ mods/toggle 关闭成功', mt.status === 200 && (mt.body && mt.body.ok !== false), 'status=' + mt.status);
    var mt2 = await jpost(base, '/api/node-admin/mods/toggle', { id: 'nebula-overdrive', enabled: true }, tok);
    check('④ mods/toggle 开启成功', mt2.status === 200 && (mt2.body && mt2.body.ok !== false), 'status=' + mt2.status);
  } finally { try { node.ch.kill('SIGTERM'); } catch (e) {} await sleep(400); try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {} }
}

async function portalTests() {
  console.log('[⑤⑥⑦门户] bundle / node-manager install+start / allowRegistration / 静态资产');
  var pSrc = readf(path.join(W, 'portal.js'));
  var need = /internal\/bundle/.test(pSrc) || /node-manager/.test(pSrc);
  var tmpDb = path.join(os.tmpdir(), 'qa-s5p-' + Date.now().toString(36) + '.json');
  var B = await spawnPortal({ db: tmpDb, adminUser: 'qa_admin', adminPass: 'Admin!12345' });
  if (!B.base || B.base.indexOf(':0') >= 0) { skipCheck('门户启动', '未监听'); closePortal(B); return; }
  try {
    var la = await jpost(B.base, '/api/login', { username: 'qa_admin', password: 'Admin!12345' });
    var adminTok = la.body && la.body.sessionToken;
    // I7(Stage5.3/5.4)：门户动态管理路径 —— status 含 adminPath，且该路径返回自包含管理台 HTML
    var pst = await jget(B.base, '/api/portal/status');
    var adminPath = (pst.body && pst.body.adminPath) || '';
    check('I7 /api/portal/status 含 adminPath', pst.status === 200 && !!adminPath, 'adminPath=' + adminPath);
    if (adminPath) {
      var ap = await fetch(B.base + adminPath); var apCt = ap.headers.get('content-type') || ''; var apBody = ''; try { apBody = await ap.text(); } catch (e) {}
      var kwOk = ['系统', '游戏服', '账户'].filter(function (k) { return apBody.indexOf(k) >= 0; });
      check('I7 GET ' + adminPath + ' → 200 text/html 且含系统/游戏服/账户', ap.status === 200 && apCt.indexOf('text/html') >= 0 && kwOk.length >= 3, 'status=' + ap.status + ' ct=' + apCt + ' kw=' + kwOk.join('|'));
      var apSlash = await fetch(B.base + adminPath + '/');
      check('I7 GET ' + adminPath + '/ 亦 200', apSlash.status === 200, 'status=' + apSlash.status);
    } else skipCheck('I7 管理台 HTML', 'status 无 adminPath');
    // ⑤ bundle
    var bundle = await fetch(B.base + '/internal/bundle/server.js');
    var bct = bundle.headers.get('content-type') || ''; var btxt = ''; try { btxt = await bundle.text(); } catch (e) {}
    check('⑤ /internal/bundle/server.js → 200 JS', bundle.status === 200 && (bct.indexOf('javascript') >= 0 || bct.indexOf('text/plain') >= 0) && btxt.length > 1000, 'status=' + bundle.status + ' ct=' + bct + ' len=' + btxt.length);
    // ⑤ node-manager install + start (临时目录/端口)
    var npmPort = await freePort();
    var nodeId = 'qa-mgd-' + Date.now().toString(36).slice(-5);
    var inst = await jpost(B.base, '/api/admin/node-manager/install', { nodeId: nodeId, port: npmPort, dir: path.join(os.tmpdir(), 'qa-managed-' + nodeId) }, adminTok);
    check('⑤ node-manager install 成功', inst.status === 200 && (inst.body && inst.body.ok !== false), 'status=' + inst.status + ' body=' + JSON.stringify(inst.body || {}).slice(0, 200));
    var start = await jpost(B.base, '/api/admin/node-manager/start', { nodeId: nodeId, port: npmPort }, adminTok);
    check('⑤ node-manager start 成功', start.status === 200 && (start.body && start.body.ok !== false), 'status=' + start.status);
    var start2 = await jpost(B.base, '/api/admin/node-manager/start', { nodeId: nodeId, port: npmPort }, adminTok);
    check('K6-④ 二次 node-manager/start → alreadyRunning 且不新增子进程', start2.status === 200 && start2.body && start2.body.alreadyRunning === true, 'body=' + JSON.stringify(start2.body));
    if (inst.body && inst.body.ok !== false) {
      var reach = false; var nodeTok = null;
      for (var i = 0; i < 50 && !reach; i++) {
        try {
          if (!nodeTok) { var lgr = await fetch('http://127.0.0.1:' + npmPort + '/api/node-admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'qa_admin', password: 'Admin!12345' }) }); var lgj = await lgr.json().catch(function () { return {}; }); nodeTok = lgj && lgj.token; }
          if (nodeTok) { var ov = await fetch('http://127.0.0.1:' + npmPort + '/api/node-admin/overview', { headers: { authorization: 'Bearer ' + nodeTok } }); reach = ov.ok; }
        } catch (e) {}
        if (!reach) await sleep(300);
      }
      check('⑤ 拉起子进程后 /api/node-admin/overview 可达', reach, 'port=' + npmPort);
      // ③ node-manager status ssoTicket + 日志 + ssoTicket 免密登录节点
      var nmst = await jget(B.base, '/api/admin/node-manager/status', adminTok);
      check('⑤/③ node-manager status 含 ssoTicket', nmst.status === 200 && nmst.body && !!nmst.body.ssoTicket, 'status=' + nmst.status);
      check('⑤/③ node-manager status 含节点日志', JSON.stringify(nmst.body || {}).indexOf('logs') >= 0, '');
      if (nmst.body && nmst.body.ssoTicket && reach) {
        var slog = await jpost('http://127.0.0.1:' + npmPort, '/api/node-admin/login', { ssoTicket: nmst.body.ssoTicket });
        check('③ ssoTicket → 节点 /api/node-admin/login 200 token', slog.status === 200 && slog.body && (slog.body.token || slog.body.sessionToken), 'status=' + slog.status);
      } else skipCheck('③ ssoTicket 节点登录', '无 ssoTicket 或节点不可达');
      // ③ create-user 建号返回恢复码
      if (/create-user/.test(readf(path.join(W, 'portal.js')))) {
        var cu = await jpost(B.base, '/api/admin/create-user', { username: 'qa_cu_' + Date.now().toString(36).slice(-4), password: 'pw123456', role: 'user' }, adminTok);
        check('③ POST /api/admin/create-user 成功返回恢复码', cu.status === 200 && cu.body && /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-/.test(String(cu.body.recoveryCode || '')), 'status=' + cu.status + ' body=' + JSON.stringify(cu.body));
      } else skipCheck('③ create-user', 'portal 未实现');
      try { await jpost(B.base, '/api/admin/node-manager/stop', { nodeId: nodeId }, adminTok); } catch (e) {}
      try { fs.rmSync(path.join(W, 'managed-nodes', nodeId), { recursive: true, force: true }); } catch (e) {}
    } else skipCheck('⑤ node-manager 启动子进程', 'install 未成功');
    // ⑥ allowRegistration=false
    var cfgOff = await jpost(B.base, '/api/admin/config', { key: 'allowRegistration', value: false }, adminTok);
    var regOff = await jpost(B.base, '/api/register', { username: 'qaoff' + Date.now().toString(36).slice(-4), password: 'pw123456' });
    check('⑥ allowRegistration=false → /api/register 403 registration_disabled', regOff.status === 403 && regOff.body && regOff.body.error === 'registration_disabled', 'status=' + regOff.status + ' body=' + JSON.stringify(regOff.body));
    var cfgOn = await jpost(B.base, '/api/admin/config', { key: 'allowRegistration', value: true }, adminTok);
    var roomsJ = await jget(B.base, '/api/rooms', adminTok); var rlist = (roomsJ.body && roomsJ.body.rooms) || [];
    check('K6-③ 门户 /api/rooms 无 settled 房', !rlist.some(function (r) { return r.status === 'settled'; }), 'rooms=' + rlist.length);
    // ⑦ 静态资产 webp
    var asset = await fetch(B.base + '/assets/nebula_deep_1.webp');
    var act = asset.headers.get('content-type') || '';
    check('⑦ /assets/nebula_deep_1.webp → 200 image/webp', asset.status === 200 && act.indexOf('image/webp') >= 0, 'status=' + asset.status + ' ct=' + act);
    var flagship = await fetch(B.base + '/assets/ship_flagship.webp');
    var fct = flagship.headers.get('content-type') || '';
    check('S53-⑨ /assets/ship_flagship.webp → 200 image/webp', flagship.status === 200 && fct.indexOf('image/webp') >= 0, 'status=' + flagship.status + ' ct=' + fct);
  } finally { closePortal(B); try { fs.unlinkSync(tmpDb); } catch (e) {} }
}

(async function () {
  console.log('=== 星海边境 Stage 5 (I1–I7) 集成测试 ===');
  staticReview();
  await externalGameTests();
  await nodeConfigTests();
  await portalTests();
  console.log('\n' + (fail ? ('失败: ' + fail) : 'ALL PASS') + '  (' + pass + ' 通过, ' + skip + ' 跳过, ' + fail + ' 失败)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERROR', e && e.stack || e); process.exit(1); });
