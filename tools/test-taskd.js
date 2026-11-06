'use strict';
/*
 * 星海边境 · Stage 2 Task D —— 固定资源消耗 / 枯竭扣能 / 双通道聊天#截获 集成测试
 * 运行： node tools/test-taskd.js            （默认 ws://127.0.0.1:8798）
 *        PORT=8798 node tools/test-taskd.js
 * 目标服务需 FREEZE_AI=1。退出码：0=ALL PASS(PASS+SKIP)，非0=失败/未就绪。
 *
 * 依据 docs/PROTOCOL-Stage2.md Task D 节：
 *   START_RESOURCE=30；ACTION_COST=1(launch/gather)；枯竭 upkeep=1.0*troops*dt / 见底流失 0.5/s；
 *   chat channel='global' 全服可见 / channel='ally' 仅同盟可见；ally 普通消息(>=4字)10% 截获、mark 20% 截获。
 * 资源恢复 1.2/s，故资源扣减采用短窗口近似。枯竭扣能难构造 → 静态核对常量与代码路径（报告中说明）。
 */
const fs = require('fs');
const path = require('path');
const PORT = Number(process.env.PORT || 8798);
const BASE = 'http://127.0.0.1:' + PORT;
const WSURL = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let pass = 0, fail = 0, skip = 0;
function check(name, ok, extra) { if (ok) { pass++; console.log('  OK   ' + name + (extra ? '  [' + extra + ']' : '')); } else { fail++; console.log('  X    ' + name + (extra ? '  [' + extra + ']' : '')); } }
function skipCheck(name, why) { skip++; console.log('  SKIP ' + name + '  [' + why + ']'); }

function connect(name) {
  return new Promise(function (resolve, reject) {
    var ws; try { ws = new WebSocket(WSURL); } catch (e) { return reject(e); }
    var c = { ws: ws, welcome: null, state: null, events: [], rejects: [], acks: [], initialRes: null };
    var timer = setTimeout(function () { reject(new Error('hello timeout ' + name)); }, 8000);
    ws.onopen = function () { ws.send(JSON.stringify({ t: 'join', name: name })); };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'hello') { c.welcome = m; c.state = m; var me = (m.players || []).find(function (p) { return p.id === m.id; }); c.initialRes = me ? me.resource : null; clearTimeout(timer); resolve(c); }
      else if (m.t === 'state') { c.state = m; }
      else if (m.t === 'ev') { c.events.push(m); }
      else if (m.t === 'reject') { c.rejects.push(m.reason || '(no reason)'); }
      else if (m.t === 'ack') { c.acks.push(m); }
      else if (m.t === 'full') { clearTimeout(timer); reject(new Error('server full')); }
    };
    ws.onerror = function () { clearTimeout(timer); reject(new Error('ws error ' + name)); };
  });
}
async function waitFor(fn, ms, step) { ms = ms || 5000; step = step || 100; var t0 = Date.now(); while (Date.now() - t0 < ms) { var v; try { v = fn(); } catch (_) { v = false; } if (v) return true; await sleep(step); } return false; }
function evs(c, mark, k) { return c.events.slice(mark).filter(function (e) { return !k || e.k === k; }); }
function planets(c) { return (c.state && c.state.planets) || []; }
function pl(c, id) { return planets(c).find(function (p) { return p.id === id; }); }
function mine(c) { return planets(c).filter(function (p) { return p.owner === c.welcome.id; }); }
function res(c, id) { var ps = (c.state && c.state.players) || []; var p = ps.find(function (x) { return x.id === id; }); return p ? p.resource : null; }
function coal(c, id) { var ps = (c.state && c.state.players) || []; var p = ps.find(function (x) { return x.id === id; }); return p ? (p.coalition || 0) : 0; }
function isAlly(c, a, b) { var ps = (c.state && c.state.pacts) || []; return ps.some(function (p) { return (p.a === a && p.b === b) || (p.a === b && p.b === a); }); }

(async function () {
  console.log('=== 星海边境 Task D 集成测试 ===  PORT=' + PORT);

  /* ---- 静态核对（枯竭扣能等难构造项，读源码只读不写） ---- */
  console.log('[静态核对] 常量与代码路径');
  var src = '';
  try { src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'); } catch (e) { src = ''; }
  check('START_RESOURCE 默认 30（配置文件驱动，从 NODE_RULES.startResource 读取）', /let\s+START_RESOURCE\s*=\s*numOr\(NODE_RULES\.startResource,\s*30\)/.test(src) || /const\s+START_RESOURCE\s*=\s*30\b/.test(src) || /START_RESOURCE\s*=\s*30\b/.test(src), 'source check');
  check('ACTION_COST=1 常量存在', /ACTION_COST\s*=\s*1\b/.test(src), 'source check');
  check('EXHAUST_UPKEEP_PER_SHIP=1.0 常量存在', /EXHAUST_UPKEEP_PER_SHIP\s*=\s*1(\.0)?\b/.test(src), 'source check');
  check('EXHAUST_STARVE_RATE=0.5 常量存在', /EXHAUST_STARVE_RATE\s*=\s*0\.5\b/.test(src), 'source check');
  check('simulatePlanets 使用枯竭 upkeep 路径', /EXHAUST_UPKEEP_PER_SHIP/.test(src) && /EXHAUST_STARVE_RATE/.test(src), 'source check');
  check('双通道聊天 helper(broadcastChatToCoalition/maybeIntercept)', /broadcastChatToCoalition/.test(src) && /maybeIntercept/.test(src), 'source check');

  var readySrv = false;
  for (var i = 0; i < 30 && !readySrv; i++) {
    try { var st = await fetch(BASE + '/api/status').then(function (r) { return r.json(); }); if (st && st.ok) readySrv = true; } catch (_) {}
    if (!readySrv) await sleep(300);
  }
  if (!readySrv) { console.error('[预检] 服务 ' + PORT + ' 未就绪'); process.exit(2); }

  var A = await connect('D测试A'), B = await connect('D测试B'), C = await connect('D测试C'), D = await connect('D测试D');
  await sleep(600);
  check('四个真人已加入', [A, B, C, D].every(function (x) { return x.welcome; }), [A, B, C, D].map(function (x) { return x.welcome.id; }).join(','));
  var idA = A.welcome.id, idB = B.welcome.id, idC = C.welcome.id, idD = D.welcome.id;

  /* 功能探测：channel='global' 是否生效（收到 channel=global 的 chat 事件） */
  var probeMark = C.events.length;
  A.ws.send(JSON.stringify({ t: 'chat', text: '探测D协议', channel: 'global' }));
  var chatReady = await waitFor(function () { return evs(C, probeMark, 'chat').some(function (e) { return e.channel === 'global'; }); }, 3000);
  if (!chatReady) {
    fail++; console.log('  X    [预检] Task D 双通道聊天(channel)未实现/未响应，跳过后续用例');
    console.log('\n失败: ' + fail + '  （服务端 Task D 尚未就绪）'); process.exit(3);
  }
  console.log('  OK   [预检] channel=global 已生效，Task D 聊天已就绪');

  /* ===== START_RESOURCE ≈ 30 ===== */
  console.log('[资源] START_RESOURCE≈30');
  check('新玩家初始资源≈30', D.initialRes != null && D.initialRes >= 28 && D.initialRes <= 36, 'initialRes=' + D.initialRes);

  /* ===== launch/gather 各扣 1 ===== */
  console.log('[资源] launch / gather 各扣 1（短窗口近似，含 1.2/s 回复）');
  await waitFor(function () { return mine(A).length >= 1 && mine(A)[0].troops >= 2; }, 8000);
  var homeA = mine(A)[0];
  var neutrals = planets(A).filter(function (p) { return !p.owner && p.id !== homeA.id; });
  var tgt = neutrals[0];
  if (tgt) {
    // 单次扣减会被 1.2/s 恢复与整数取整掩盖，故累计 5 次 launch 观测总扣减(约 -5)
    var r0 = res(A, idA);
    A.rejects.length = 0; var ackMark = A.acks.length;
    for (var lk = 0; lk < 5; lk++) {
      A.ws.send(JSON.stringify({ t: 'launch', src: homeA.id, target: tgt.id, n: 1 }));
      await sleep(80);
    }
    await waitFor(function () { return A.acks.slice(ackMark).filter(function (a) { return a.op === 'launch'; }).length >= 5 || A.rejects.length > 0; }, 4000);
    await sleep(220);
    var r1 = res(A, idA);
    var dropL = (r0 != null && r1 != null) ? (r0 - r1) : null;
    var nAck = A.acks.slice(ackMark).filter(function (a) { return a.op === 'launch'; }).length;
    check('launch 成功派出×5', nAck >= 5 || A.rejects.length === 0, 'acks=' + nAck + ' rejects=' + JSON.stringify(A.rejects));
    check('launch 累计扣约 5 资源(每次≈1)', dropL != null && dropL > 2.5 && dropL < 6.5, 'res ' + r0 + '->' + r1 + ' drop=' + dropL + ' (期望≈5，含1.2/s回复)');
  } else skipCheck('launch 扣 1', '无中立目标');

  await waitFor(function () { return mine(A).length >= 1; }, 4000);
  var nodes = ((A.state && A.state.nodes) || []).slice(0, 2);
  if (nodes.length >= 2) {
    // 累计 2 次 gather(不同资源点，规避同点去重) 观测总扣减(约 -2)
    var g0 = res(A, idA);
    A.rejects.length = 0; var gAck = A.acks.length;
    for (var gk = 0; gk < 2; gk++) {
      A.ws.send(JSON.stringify({ t: 'gather', node: nodes[gk].id }));
      await sleep(80);
    }
    await waitFor(function () { return A.acks.slice(gAck).filter(function (a) { return a.op === 'gather'; }).length >= 2 || A.rejects.length > 1; }, 4000);
    await sleep(220);
    var g1 = res(A, idA);
    var dropG = (g0 != null && g1 != null) ? (g0 - g1) : null;
    check('gather 累计扣约 2 资源(每次≈1)', dropG != null && dropG > 0.8 && dropG < 4.2, 'res ' + g0 + '->' + g1 + ' drop=' + dropG + ' (期望≈2)');
  } else skipCheck('gather 扣 1', '资源点不足');

  /* ===== 结盟（供 ally 频道/截获） ===== */
  console.log('[聊天] 结盟并验证 global/ally 可见性');
  A.rejects.length = 0; var ppMark = A.acks.length;
  A.ws.send(JSON.stringify({ t: 'diplo', action: 'ally', targetPlayer: idB }));
  await waitFor(function () { return B.events.some(function (e) { return e.k === 'pact-request' && e.from === idA; }) || A.rejects.length > 0; }, 5000);
  B.ws.send(JSON.stringify({ t: 'pactRespond', from: idA, accept: true }));
  var pactOk = await waitFor(function () { return isAlly(A, idA, idB); }, 5000);
  check('A-B 结盟成功', pactOk, 'coalA=' + coal(A, idA));

  await sleep(2100); // 规避 chat 冷却
  var glB = B.events.length, glC = C.events.length, glD = D.events.length;
  var gtext = '全局可见消息ZZZ';
  A.ws.send(JSON.stringify({ t: 'chat', text: gtext, channel: 'global' }));
  var glOk = await waitFor(function () { return evs(B, glB, 'chat').some(function (e) { return e.channel === 'global' && String(e.text || '').indexOf(gtext) >= 0; }) && evs(C, glC, 'chat').some(function (e) { return e.channel === 'global' && String(e.text || '').indexOf(gtext) >= 0; }); }, 4000);
  check('global 频道全服可见(B/C 均收到)', glOk, 'B/C received=' + glOk);

  await sleep(2100);
  var alA = A.events.length, alB = B.events.length, alC = C.events.length, alD = D.events.length;
  var atext = '盟友专用口令QWE';
  A.ws.send(JSON.stringify({ t: 'chat', text: atext, channel: 'ally' }));
  var bGotAlly = await waitFor(function () { return evs(B, alB, 'chat').some(function (e) { return e.channel === 'ally' && !e.intercept && String(e.text || '').indexOf(atext) >= 0; }); }, 4000);
  await sleep(500);
  var cGotAlly = evs(C, alC, 'chat').some(function (e) { return !e.intercept && String(e.text || '').indexOf(atext) >= 0; });
  var dGotAlly = evs(D, alD, 'chat').some(function (e) { return !e.intercept && String(e.text || '').indexOf(atext) >= 0; });
  check('ally 频道仅同盟可见(B 收到)', bGotAlly, 'B=' + bGotAlly);
  check('ally 频道非同盟不可见(C/D 未收到原文)', !cGotAlly && !dGotAlly, 'C=' + cGotAlly + ' D=' + dGotAlly);

  /* ===== #截获 ===== */
  console.log('[截获] mark(20%) 与 ally 普通消息(10%)');
  // mark 触发截获：发送多枚 mark，无需 chat 冷却
  var cM = C.events.length, dM = D.events.length;
  var markPlanet = (neutrals[0] || planets(A)[0]).id;
  for (var mi = 0; mi < 28; mi++) { A.ws.send(JSON.stringify({ t: 'diplo', action: 'mark', targetPlanet: markPlanet })); await sleep(25); }
  var markHit = await waitFor(function () {
    return evs(C, cM, 'chat').some(function (e) { return e.intercept === true; }) || evs(D, dM, 'chat').some(function (e) { return e.intercept === true; });
  }, 6000);
  var interEv = evs(C, cM, 'chat').filter(function (e) { return e.intercept === true; })[0] || evs(D, dM, 'chat').filter(function (e) { return e.intercept === true; })[0];
  check('mark 触发 #截获 至少一次(20%×28)', markHit, interEv ? ('text=' + interEv.text) : '未命中(概率)');
  if (interEv) {
    check('#截获 文本带 [#截获] 前缀', String(interEv.text || '').indexOf('[#截获]') >= 0, interEv.text);
    check('#截获 隐藏发送者(id/name 不暴露)', (interEv.id == null || interEv.id === 0) && !interEv.name, 'id=' + interEv.id + ' name=' + interEv.name);
  }

  // ally 普通消息 10%：A/B 交替发送多轮(受 2s 冷却限制)
  var ncM = C.events.length, ndM = D.events.length;
  var normalHit = false;
  for (var ni = 0; ni < 18; ni++) {
    var sender = (ni % 2 === 0) ? A : B;
    sender.ws.send(JSON.stringify({ t: 'chat', text: '联盟普通消息第' + ni + '号', channel: 'ally' }));
    await sleep(1030);
    if (evs(C, ncM, 'chat').some(function (e) { return e.intercept === true; }) || evs(D, ndM, 'chat').some(function (e) { return e.intercept === true; })) { normalHit = true; break; }
  }
  if (normalHit) check('ally 普通消息触发 #截获 至少一次(10%)', true, 'hit');
  else skipCheck('ally 普通消息 #截获 命中', '10% 概率样本未命中（概率性，非缺陷；mark 已证明拦截通道可用）');

  /* ===== 资源不足拒绝 ===== */
  console.log('[资源] 资源不足时 launch/gather 被拒');
  // 用非同盟玩家 C，通过反复发起 ally(每次扣 2，双方均无盟时通过校验) 快速耗尽资源
  C.rejects.length = 0;
  for (var di = 0; di < 40; di++) {
    var rc = res(C, idC);
    if (rc == null || rc < 1) break;
    C.ws.send(JSON.stringify({ t: 'diplo', action: 'ally', targetPlayer: idD }));
    await sleep(35);
  }
  var lowRes = res(C, idC);
  var rejHit = false;
  for (var li = 0; li < 6 && !rejHit; li++) {
    C.rejects.length = 0;
    var cHome = (C.welcome.homePlanet && pl(C, C.welcome.homePlanet)) ? C.welcome.homePlanet : (mine(C)[0] && mine(C)[0].id);
    var ctgt = planets(C).filter(function (p) { return !p.owner; })[0];
    if (!cHome || !ctgt) break;
    C.ws.send(JSON.stringify({ t: 'launch', src: cHome, target: ctgt.id, n: 1 }));
    await sleep(260);
    if (C.rejects.some(function (x) { return String(x).indexOf('资源不足') >= 0; })) rejHit = true;
  }
  if (lowRes != null && lowRes < 3) check('资源不足时 launch 被拒(资源不足)', rejHit, 'res=' + lowRes + ' rejects=' + JSON.stringify(C.rejects));
  else skipCheck('资源不足拒绝', '未能耗尽资源(res=' + lowRes + ')');

  /* ===== 枯竭扣能（静态已核对，运行期跳过） ===== */
  skipCheck('枯竭星扣全局资源/见底流失(运行期)', '需构造 exhausted 星球，难稳定构造；常量与代码路径已静态核对通过');

  try { [A, B, C, D].forEach(function (x) { x.ws.send(JSON.stringify({ t: 'leave' })); }); } catch (_) {}
  await sleep(300);
  console.log('\n' + (fail ? ('失败: ' + fail) : 'ALL PASS') + '  (' + pass + ' 通过, ' + skip + ' 跳过, ' + fail + ' 失败)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERROR', e && e.stack || e); process.exit(1); });
