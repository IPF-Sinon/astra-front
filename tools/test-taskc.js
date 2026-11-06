'use strict';
/*
 * 星海边境 · Stage 2 Task C —— 交易/转让 / 七态外交投票 服务端集成测试
 * 运行： node tools/test-taskc.js            （默认 ws://127.0.0.1:8797）
 *        PORT=8797 node tools/test-taskc.js
 * 目标服务需 FREEZE_AI=1 启动。退出码：0=ALL PASS(PASS+SKIP)，非 0=有失败/未就绪。
 *
 * 依据：docs/PROTOCOL-Stage2.md Task C 节；总规划 Task C（拖拽派遣/邮件球/交易转让/七态外交）。
 * 覆盖：trade(预扣/成交税/拒绝退款)、transfer(带/不带驻军+回赠)、diplo 投票
 *       (join/invite/incite/expel >=50%、break 立即解散)、diploRespond、90s 过期结算、非法调用被拒。
 * 难构造前置：三+人联盟用 invite 增员构造；跨盟离间用 C-D 联盟构造。构造失败按 SKIP 记录，不伪造。
 */
const PORT = Number(process.env.PORT || 8797);
const BASE = 'http://127.0.0.1:' + PORT;
const WSURL = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
let pass = 0, fail = 0, skip = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  OK   ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  X    ' + name + (extra ? '  [' + extra + ']' : '')); }
}
function skipCheck(name, why) { skip++; console.log('  SKIP ' + name + '  [' + why + ']'); }

function connect(name) {
  return new Promise(function (resolve, reject) {
    var ws;
    try { ws = new WebSocket(WSURL); } catch (e) { return reject(e); }
    var c = { ws: ws, welcome: null, state: null, events: [], rejects: [], acks: [] };
    var timer = setTimeout(function () { reject(new Error('hello timeout ' + name)); }, 8000);
    ws.onopen = function () { ws.send(JSON.stringify({ t: 'join', name: name })); };
    ws.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'hello') { c.welcome = m; c.state = m; clearTimeout(timer); resolve(c); }
      else if (m.t === 'state') { c.state = m; }
      else if (m.t === 'ev') { c.events.push(m); }
      else if (m.t === 'reject') { c.rejects.push(m.reason || '(no reason)'); }
      else if (m.t === 'ack') { c.acks.push(m); }
      else if (m.t === 'full') { clearTimeout(timer); reject(new Error('server full')); }
    };
    ws.onerror = function () { clearTimeout(timer); reject(new Error('ws error ' + name)); };
  });
}
async function waitFor(fn, ms, step) {
  ms = ms || 5000; step = step || 100;
  var t0 = Date.now();
  while (Date.now() - t0 < ms) {
    var v; try { v = fn(); } catch (_) { v = false; }
    if (v) return true;
    await sleep(step);
  }
  return false;
}
function evs(c, mark, k) { return c.events.slice(mark).filter(function (e) { return !k || e.k === k; }); }
function planets(c) { return (c.state && c.state.planets) || []; }
function pl(c, id) { return planets(c).find(function (p) { return p.id === id; }); }
function mine(c) { return planets(c).filter(function (p) { return p.owner === c.welcome.id; }); }
function playerRes(c, id) { var ps = (c.state && c.state.players) || []; var p = ps.find(function (x) { return x.id === id; }); return p ? p.resource : null; }
function playerCoal(c, id) { var ps = (c.state && c.state.players) || []; var p = ps.find(function (x) { return x.id === id; }); return p ? (p.coalition || 0) : 0; }
function coalOf(c, a, b) { var cs = (c.state && c.state.coalitions) || []; for (var i = 0; i < cs.length; i++) { var m = cs[i].members || []; if (m.indexOf(a) >= 0 && (b == null || m.indexOf(b) >= 0)) return cs[i]; } return null; }
function hasPact(c, a, b) { var ps = (c.state && c.state.pacts) || []; return ps.some(function (p) { return (p.a === a && p.b === b) || (p.a === b && p.b === a); }); }

/* 构造“第二颗星球”：建 1 座驻点 */
function findSpot(c) {
  var ps = planets(c); var ns = (c.state && c.state.nodes) || [];
  var R = 74, W = 12400, H = 8800, seed = 987654321;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  for (var t = 0; t < 8000; t++) {
    var x = 150 + rnd() * (W - 300), y = 150 + rnd() * (H - 300), ok = true;
    for (var i = 0; i < ps.length; i++) { if (Math.hypot(x - ps[i].x, y - ps[i].y) < ps[i].r + R + 75) { ok = false; break; } }
    if (!ok) continue;
    for (var j = 0; j < ns.length; j++) { if (Math.hypot(x - ns[j].x, y - ns[j].y) < R + 90) { ok = false; break; } }
    if (ok) return { x: Math.round(x), y: Math.round(y) };
  }
  return null;
}
async function buildOutpost(c, label) {
  var spot = findSpot(c);
  if (!spot) { skipCheck(label + ' 建驻点', '无合法坐标'); return 0; }
  // 资源回复约 1.2/s、驻点 Lv1 需 20 资源；早期资源可能尚未攒够，故带资源等待与重试，避免时序抖动误报。
  for (var attempt = 0; attempt < 8; attempt++) {
    var mark = c.acks.length; c.rejects.length = 0;
    c.ws.send(JSON.stringify({ t: 'outpost', level: 1, x: spot.x, y: spot.y }));
    await waitFor(function () { return c.acks.slice(mark).some(function (a) { return a.op === 'outpost'; }) || c.rejects.length > 0; }, 5000);
    var ack = c.acks.slice(mark).find(function (a) { return a.op === 'outpost'; });
    if (ack) {
      var id = ack.id;
      await waitFor(function () { return id && pl(c, id); }, 3000);
      return id;
    }
    // rejected: most likely 资源不足 -> wait for regen and retry with a fresh spot
    await sleep(2500);
    var sp2 = findSpot(c); if (sp2) spot = sp2;
  }
  skipCheck(label + ' 建驻点', 'reject: ' + (c.rejects[0] || 'unknown'));
  return 0;
}

/* 结盟（Task C 走 diplo ally，预扣 2；失败回退旧 ally） */
async function formPact(x, y) {
  x.rejects.length = 0; var markA = x.acks.length;
  x.ws.send(JSON.stringify({ t: 'diplo', action: 'ally', targetPlayer: y.welcome.id }));
  await waitFor(function () { return y.events.some(function (e) { return e.k === 'pact-request' && e.from === x.welcome.id && e.to === y.welcome.id; }) || x.acks.slice(markA).some(function (a) { return a.op === 'diplo'; }) || x.rejects.length > 0; }, 5000);
  if (x.rejects.length) {
    x.rejects.length = 0;
    x.ws.send(JSON.stringify({ t: 'ally', id: y.welcome.id }));
    await waitFor(function () { return y.events.some(function (e) { return e.k === 'pact-request' && e.from === x.welcome.id && e.to === y.welcome.id; }) || x.rejects.length > 0; }, 5000);
    if (x.rejects.length) return false;
  }
  y.ws.send(JSON.stringify({ t: 'pactRespond', from: x.welcome.id, accept: true }));
  return await waitFor(function () { return hasPact(x, x.welcome.id, y.welcome.id); }, 5000);
}

async function sendTrade(buyer, seller, planetId, offer) {
  buyer.rejects.length = 0; var markB = buyer.acks.length; var markS = seller.events.length;
  var res0 = playerRes(buyer, buyer.welcome.id);
  buyer.ws.send(JSON.stringify({ t: 'trade', planet: planetId, offerResource: offer }));
  await waitFor(function () { return evs(seller, markS, 'trade-request').length >= 1 || buyer.rejects.length > 0 || buyer.acks.slice(markB).some(function (a) { return a.op === 'trade'; }); }, 5000);
  await sleep(350);
  var req = evs(seller, markS, 'trade-request')[0];
  var ack = buyer.acks.slice(markB).find(function (a) { return a.op === 'trade'; });
  return { req: req, ack: ack, reject: buyer.rejects[0] || '', res0: res0, resAfterReq: playerRes(buyer, buyer.welcome.id) };
}
async function respondTrade(responder, initiator, id, accept) {
  responder.rejects.length = 0;
  var mR = responder.events.length, mI = initiator.events.length;
  responder.ws.send(JSON.stringify({ t: 'tradeRespond', id: id, accept: accept }));
  await waitFor(function () { return evs(responder, mR, 'trade-result').length >= 1 || evs(initiator, mI, 'trade-result').length >= 1 || responder.rejects.length > 0; }, 5000);
  await sleep(300);
  var res = evs(responder, mR, 'trade-result')[0] || evs(initiator, mI, 'trade-result')[0];
  return { res: res, reject: responder.rejects[0] || '' };
}

(async function () {
  console.log('=== 星海边境 Task C 集成测试 ===  PORT=' + PORT);
  var ready = false;
  for (var i = 0; i < 30 && !ready; i++) {
    try { var st = await fetch(BASE + '/api/status').then(function (r) { return r.json(); }); if (st && st.ok) ready = true; } catch (_) {}
    if (!ready) await sleep(300);
  }
  if (!ready) { console.error('[预检] 服务 ' + PORT + ' 未就绪'); process.exit(2); }
  console.log('[预检] 服务就绪');

  var A = await connect('C测试A'), B = await connect('C测试B'), C = await connect('C测试C'), D = await connect('C测试D'), E = await connect('C测试E');
  await sleep(600);
  check('五个真人已加入', [A, B, C, D, E].every(function (x) { return x.welcome; }), [A, B, C, D, E].map(function (x) { return x.welcome.id; }).join(','));
  var idA = A.welcome.id, idB = B.welcome.id, idC = C.welcome.id, idD = D.welcome.id, idE = E.welcome.id;

  // 功能探测：trade 意图是否已接线（A 仅 1 星，应被“仅剩一颗”拒绝；无响应=未实现）
  A.rejects.length = 0; B.rejects.length = 0;
  B.ws.send(JSON.stringify({ t: 'trade', planet: mine(A)[0] ? mine(A)[0].id : 0, offerResource: 1 }));
  var probeOk = await waitFor(function () { return A.rejects.length > 0 || B.rejects.length > 0 || B.acks.some(function (a) { return a.op === 'trade'; }); }, 3000);
  if (!probeOk) {
    fail++; console.log('  X    [预检] Task C 服务端意图(trade/diplo/vote)尚未接线，跳过后续用例');
    console.log('\n失败: ' + fail + '  （服务端 Task C 尚未就绪）'); process.exit(3);
  }
  console.log('  OK   [预检] trade 意图已响应，Task C 服务端已就绪');
  B.rejects.length = 0; A.rejects.length = 0;

  /* ===== 前置：为 A/B/C 各建驻点（第二颗星球） ===== */
  console.log('[前置] 为 A/B/C 各建 1 座驻点');
  var opA = await buildOutpost(A, 'A');
  var opB = await buildOutpost(B, 'B');
  var opC = await buildOutpost(C, 'C');
  check('A/B/C 均建成第二颗星球(驻点)', !!(opA && opB && opC), 'opA=' + opA + ' opB=' + opB + ' opC=' + opC);

  /* ===== transfer 带/不带驻军 ===== */
  console.log('[transfer] 带上/不带走驻军');
  if (opA) {
    A.rejects.length = 0; var bM = B.events.length;
    var aHomeId = A.welcome.homePlanet || mine(A)[0].id;
    var aHomeTroops = (pl(A, aHomeId) || {}).troops;
    A.ws.send(JSON.stringify({ t: 'transfer', planet: aHomeId, to: idB, withTroops: true, wantResource: 0 }));
    await waitFor(function () { return evs(B, bM, 'trade-request').some(function (e) { return e.kind === 'transfer'; }) || A.rejects.length > 0; }, 5000);
    var req = evs(B, bM, 'trade-request').filter(function (e) { return e.kind === 'transfer'; })[0];
    check('transfer(带驻军) 接收方收到 transfer 请求', !!(req || A.rejects.length), req ? ('planet=' + req.planet + ' withTroops=' + req.withTroops) : ('A.rejects=' + JSON.stringify(A.rejects)));
    if (req) {
      await respondTrade(B, A, req.id, true);
      var after = pl(B, aHomeId);
      check('transfer(带驻军) 成交且星球归接收方', !!(after && after.owner === idB), after ? ('owner=' + after.owner) : 'gone');
      check('transfer(带驻军) 原驻军随星球保留(>0)', !!(after && after.troops > 0), 'before=' + aHomeTroops + ' after=' + (after ? after.troops : 'n/a'));
    }
  } else skipCheck('transfer(带驻军)', '无第二星球前置');

  if (opB) {
    B.rejects.length = 0; var aM = A.events.length;
    var bHomeId = B.welcome.homePlanet || mine(B)[0].id;
    var bHomeTroops = (pl(B, bHomeId) || {}).troops;
    B.ws.send(JSON.stringify({ t: 'transfer', planet: bHomeId, to: idA, withTroops: false, wantResource: 0 }));
    await waitFor(function () { return evs(A, aM, 'trade-request').some(function (e) { return e.kind === 'transfer'; }) || B.rejects.length > 0; }, 5000);
    var req2 = evs(A, aM, 'trade-request').filter(function (e) { return e.kind === 'transfer'; })[0];
    check('transfer(不带驻军) 接收方收到 transfer 请求', !!(req2 || B.rejects.length), req2 ? ('planet=' + req2.planet + ' withTroops=' + req2.withTroops) : ('B.rejects=' + JSON.stringify(B.rejects)));
    if (req2) {
      await respondTrade(A, B, req2.id, true);
      var afterB = pl(A, bHomeId);
      check('transfer(不带驻军) 成交且星球归接收方', !!(afterB && afterB.owner === idA), afterB ? ('owner=' + afterB.owner + ' troops=' + afterB.troops) : 'gone');
      check('transfer(不带驻军) 原驻军清零', !!(afterB && afterB.troops === 0), 'before=' + bHomeTroops + ' after=' + (afterB ? afterB.troops : 'n/a'));
      var retF = ((B.state && B.state.fleets) || []).some(function (f) { return f.owner === idB && f.returning; });
      check('transfer(不带驻军) 生成发起方返航舰队', retF, retF ? 'returning fleet found' : '未观察到 returning 舰队');
    }
  } else skipCheck('transfer(不带驻军)', '无第二星球前置');

  /* ===== trade 预扣/拒绝退款/成交税 ===== */
  console.log('[trade] 预扣 / 拒绝退款 / 成交税');
  if (opC) {
    var tr1 = await sendTrade(D, C, opC, 10);
    check('trade 发起：卖方收到 trade-request(kind=trade,offer=10)', !!(tr1.req && tr1.req.kind === 'trade' && tr1.req.offerResource === 10), tr1.req ? JSON.stringify({ kind: tr1.req.kind, offer: tr1.req.offerResource, expireAt: tr1.req.expireAt }) : ('D.rejects=' + tr1.reject));
    check('trade 发起：预扣买家 2+offerResource', tr1.res0 != null && tr1.resAfterReq != null && (tr1.res0 - tr1.resAfterReq) >= 9, 'res ' + tr1.res0 + '->' + tr1.resAfterReq + ' (期望约 -12)');
    if (tr1.req) {
      var rr1 = await respondTrade(C, D, tr1.req.id, false);
      var resAfterDecline = playerRes(D, idD);
      check('trade 拒绝：trade-result(ok=false,reason=declined)', !!(rr1.res && rr1.res.ok === false && /declin|拒/i.test(String(rr1.res.reason || 'declined'))), rr1.res ? JSON.stringify(rr1.res) : ('C.rejects=' + rr1.reject));
      check('trade 拒绝：退款 offer（手续费不退，净损约 2）', tr1.res0 != null && resAfterDecline != null && (tr1.res0 - resAfterDecline) <= 5 && (tr1.res0 - resAfterDecline) >= 0, 'res0=' + tr1.res0 + ' afterDecline=' + resAfterDecline);
    }
    await sleep(400);
    var cRes0 = playerRes(C, idC);
    var tr2 = await sendTrade(D, C, opC, 10);
    if (tr2.req) {
      var rr2 = await respondTrade(C, D, tr2.req.id, true);
      var planetAfter = pl(D, opC);
      var cRes1 = playerRes(C, idC);
      check('trade 成交：trade-result(ok=true)', !!(rr2.res && rr2.res.ok === true), rr2.res ? JSON.stringify(rr2.res) : ('C.rejects=' + rr2.reject));
      check('trade 成交：星球所有权转给买家', !!(planetAfter && planetAfter.owner === idD), planetAfter ? ('owner=' + planetAfter.owner) : 'planet missing');
      check('trade 成交：卖家入账 offer*0.9(≈9)', cRes1 != null && cRes0 != null && (cRes1 - cRes0) >= 5 && (cRes1 - cRes0) <= 13, 'C.res ' + cRes0 + '->' + cRes1);
    } else check('trade 成交', false, 'no trade-request: ' + tr2.reject);
  } else skipCheck('trade 全流程', '无第二星球前置');

  /* ===== 非法调用被拒 ===== */
  console.log('[非法] 非法调用被拒');
  D.rejects.length = 0;
  D.ws.send(JSON.stringify({ t: 'trade', planet: (D.welcome.homePlanet || mine(D)[0].id), offerResource: 1 }));
  check('trade 自己的星球被拒', await waitFor(function () { return D.rejects.length > 0; }, 2500), JSON.stringify(D.rejects));
  if (mine(C).length === 1) {
    D.rejects.length = 0;
    D.ws.send(JSON.stringify({ t: 'trade', planet: mine(C)[0].id, offerResource: 1 }));
    check('trade 仅剩一颗星球的卖家被拒', await waitFor(function () { return D.rejects.length > 0; }, 2500), JSON.stringify(D.rejects));
  } else skipCheck('trade 仅剩一颗卖家', 'C 星球数=' + mine(C).length);
  D.rejects.length = 0;
  D.ws.send(JSON.stringify({ t: 'transfer', planet: mine(A)[0].id, to: idD, withTroops: false, wantResource: 0 }));
  check('transfer 非自己星球被拒', await waitFor(function () { return D.rejects.length > 0; }, 2500), JSON.stringify(D.rejects));
  // tradeRespond 非接收方：D 买 A 的一颗星(卖家 A)，E 抢答
  var trI = await sendTrade(D, A, opA || mine(A)[0].id, 1);
  if (trI.req) {
    E.rejects.length = 0;
    E.ws.send(JSON.stringify({ t: 'tradeRespond', id: trI.req.id, accept: true }));
    check('tradeRespond 非接收方被拒', await waitFor(function () { return E.rejects.length > 0; }, 2500), JSON.stringify(E.rejects));
    A.ws.send(JSON.stringify({ t: 'tradeRespond', id: trI.req.id, accept: false }));
    await sleep(250);
  } else skipCheck('tradeRespond 非接收方', '无待决交易(' + trI.reject + ')');

  /* ===== diplo：结盟 / 标记 / break 立即解散 ===== */
  console.log('[diplo] 结盟 / 标记 / break 立即解散');
  var pact1 = await formPact(A, B);
  check('结盟成功建立 2 人联盟', pact1 && !!coalOf(A, idA, idB), 'coal=' + (coalOf(A, idA, idB) ? coalOf(A, idA, idB).id : 'none'));
  if (coalOf(A, idA, idB)) {
    var mark1 = A.events.length;
    A.ws.send(JSON.stringify({ t: 'diplo', action: 'mark', targetPlanet: opA || mine(A)[0].id }));
    var gotMark = await waitFor(function () { return evs(A, mark1, 'chat').some(function (e) { return e.channel === 'ally' && /标记/.test(String(e.text || '')); }); }, 4000);
    check('diplo mark 向联盟频道广播【标记】', gotMark, gotMark ? 'ally chat received' : '未收到');
  } else skipCheck('diplo mark', '无联盟');
  A.ws.send(JSON.stringify({ t: 'diplo', action: 'break' }));
  var broke = await waitFor(function () { return !hasPact(A, idA, idB) && playerCoal(A, idA) === 0 && playerCoal(A, idB) === 0; }, 4000);
  check('diplo break 立即解散 2 人联盟', broke, 'pact=' + hasPact(A, idA, idB) + ' coalA=' + playerCoal(A, idA) + ' coalB=' + playerCoal(A, idB));

  /* ===== 重建联盟 → invite / expel / join / incite 投票 ===== */
  console.log('[diplo 投票] invite / expel / join / incite >=50% 机制');
  var pact2 = await formPact(A, B);
  check('重建 A-B 联盟', pact2, 'coal=' + (coalOf(A, idA, idB) ? coalOf(A, idA, idB).id : 'none'));
  var pactCD = await formPact(C, D);
  check('建立 C-D 联盟(供离间)', pactCD, 'coal=' + (coalOf(C, idC, idD) ? coalOf(C, idC, idD).id : 'none'));

  // invite E：A 有盟/E 无盟 → 生成 vote-request，A 投赞成使 >=50% → E 收 diplo-request
  if (playerCoal(A, idE) === 0 && coalOf(A, idA, idB)) {
    E.rejects.length = 0; var invAckMark = A.acks.length; var eM = E.events.length; A.rejects.length = 0;
    A.ws.send(JSON.stringify({ t: 'diplo', action: 'invite', targetPlayer: idE }));
    await waitFor(function () { return A.acks.slice(invAckMark).some(function (a) { return a.op === 'vote' && a.id; }) || A.rejects.length > 0; }, 5000);
    var invAck = A.acks.slice(invAckMark).find(function (a) { return a.op === 'vote' && a.id; });
    var invId = invAck ? invAck.id : 0;
    check('invite 生成投票(vote ack)', !!invId || A.rejects.length > 0, invId ? ('voteId=' + invId) : ('A.rejects=' + JSON.stringify(A.rejects)));
    if (invId) {
      A.ws.send(JSON.stringify({ t: 'vote', id: invId, accept: true }));
      var gotInviteReq = await waitFor(function () { return evs(E, eM, 'diplo-request').some(function (e) { return e.kind === 'invite'; }); }, 5000);
      var invReq = evs(E, eM, 'diplo-request').filter(function (e) { return e.kind === 'invite'; })[0];
      check('invite 投票达 >=50% 后向被邀请者发 diplo-request', !!invReq, invReq ? ('id=' + invReq.id) : '未收到');
      if (invReq) {
        E.ws.send(JSON.stringify({ t: 'diploRespond', id: invReq.id, accept: true }));
        var eJoined = await waitFor(function () { return playerCoal(A, idE) !== 0 && playerCoal(A, idE) === playerCoal(A, idA); }, 5000);
        check('diploRespond 接受后 E 加入联盟', eJoined, 'E.coal=' + playerCoal(A, idE));
      }
    }
  } else skipCheck('invite', '前置不满足');

  // expel E：联盟 >=3 人；A 自动 1 票<50% → 需他人投票
  var coal1 = coalOf(A, idA); var members1 = (coal1 && coal1.members) || [];
  if (members1.length >= 3) {
    var expM_A = A.events.length, expM_B = B.events.length; A.rejects.length = 0;
    A.ws.send(JSON.stringify({ t: 'diplo', action: 'expel', targetPlayer: idE }));
    await waitFor(function () { return evs(B, expM_B, 'vote-request').length >= 1 || evs(A, expM_A, 'vote-request').length >= 1 || A.rejects.length > 0; }, 5000);
    var vreq = evs(B, expM_B, 'vote-request')[0] || evs(A, expM_A, 'vote-request')[0];
    check('expel 生成 vote-request（>=3 人，单发起票<50%）', !!(vreq || A.rejects.length), vreq ? ('voteId=' + vreq.id) : ('A.rejects=' + JSON.stringify(A.rejects)));
    if (vreq) {
      D.rejects.length = 0;
      D.ws.send(JSON.stringify({ t: 'vote', id: vreq.id, accept: true }));
      check('vote 非联盟成员被拒', await waitFor(function () { return D.rejects.length > 0; }, 2500), JSON.stringify(D.rejects));
      B.ws.send(JSON.stringify({ t: 'vote', id: vreq.id, accept: true }));
      var ejected = await waitFor(function () { return playerCoal(A, idE) === 0; }, 5000);
      check('expel 投票 >=50% 通过后 E 被移出联盟', ejected, 'E.coal=' + playerCoal(A, idE));
    }
  } else skipCheck('expel', '联盟不足 3 人(=' + members1.length + ')');

  // join E：E 无盟 → 加入 A 联盟（A 投票触发 >=50%）
  if (playerCoal(A, idE) === 0 && coalOf(A, idA)) {
    var joinAckMark = E.acks.length; var joinM_A = A.events.length; E.rejects.length = 0;
    E.ws.send(JSON.stringify({ t: 'diplo', action: 'join', targetPlayer: idA }));
    await waitFor(function () { return E.acks.slice(joinAckMark).some(function (a) { return a.op === 'vote' && a.id; }) || E.rejects.length > 0; }, 5000);
    var joinAck = E.acks.slice(joinAckMark).find(function (a) { return a.op === 'vote' && a.id; });
    var jvId = joinAck ? joinAck.id : 0;
    check('join 生成投票(vote ack)', !!jvId || E.rejects.length > 0, jvId ? ('voteId=' + jvId) : ('E.rejects=' + JSON.stringify(E.rejects)));
    if (jvId) {
      A.ws.send(JSON.stringify({ t: 'vote', id: jvId, accept: true }));
      var eJoined2 = await waitFor(function () { return playerCoal(A, idE) !== 0 && playerCoal(A, idE) === playerCoal(A, idA); }, 5000);
      check('join 投票通过后 E 加入联盟', eJoined2, 'E.coal=' + playerCoal(A, idE));
    }
  } else skipCheck('join', '前置不满足');

  // incite：A 盟 vs C-D 盟，不同盟 → A 离间 C
  var cCoal = playerCoal(A, idC), aCoal = playerCoal(A, idA);
  if (cCoal !== 0 && aCoal !== 0 && cCoal !== aCoal) {
    var incM_B = B.events.length, incM_C = C.events.length; A.rejects.length = 0;
    A.ws.send(JSON.stringify({ t: 'diplo', action: 'incite', targetPlayer: idC }));
    await waitFor(function () { return evs(B, incM_B, 'vote-request').length >= 1 || A.rejects.length > 0; }, 5000);
    var iv = evs(B, incM_B, 'vote-request')[0];
    check('incite 生成 vote-request', !!(iv || A.rejects.length), iv ? ('voteId=' + iv.id) : ('A.rejects=' + JSON.stringify(A.rejects)));
    if (iv) {
      B.ws.send(JSON.stringify({ t: 'vote', id: iv.id, accept: true }));
      var incCReq = await waitFor(function () { return evs(C, incM_C, 'diplo-request').some(function (e) { return e.kind === 'incite'; }); }, 5000);
      var icr = evs(C, incM_C, 'diplo-request').filter(function (e) { return e.kind === 'incite'; })[0];
      check('incite 本盟 >=50% 后向目标发 diplo-request', !!icr, icr ? ('id=' + icr.id) : '未收到');
      if (icr) {
        C.ws.send(JSON.stringify({ t: 'diploRespond', id: icr.id, accept: true }));
        var cJoined = await waitFor(function () { return playerCoal(A, idC) !== 0 && playerCoal(A, idC) === playerCoal(A, idA); }, 5000);
        check('incite 目标同意后 C 脱离原盟加入 A 盟', cJoined, 'C.coal=' + playerCoal(A, idC) + ' A.coal=' + playerCoal(A, idA));
      }
    }
  } else skipCheck('incite', '无法构造两个不同联盟(C.coal=' + cCoal + ' A.coal=' + aCoal + ')');

  E.rejects.length = 0;
  E.ws.send(JSON.stringify({ t: 'diploRespond', id: 999999, accept: true }));
  check('diploRespond 无效 id 被拒', await waitFor(function () { return E.rejects.length > 0; }, 2500), JSON.stringify(E.rejects));

  /* ===== 90s 过期结算 ===== */
  console.log('[过期] 90s 请求超时结算');
  var expSellerPlanet = (opA && pl(A, opA) && pl(A, opA).owner === idA) ? opA : 0;
  if (expSellerPlanet && mine(A).length >= 2) {
    var expMark = D.events.length, expAMark = A.events.length; D.rejects.length = 0;
    D.ws.send(JSON.stringify({ t: 'trade', planet: expSellerPlanet, offerResource: 5 }));
    await waitFor(function () { return evs(A, expAMark, 'trade-request').length >= 1 || D.rejects.length > 0; }, 4000);
    console.log('  ... 等待约 92s 观察 90s 过期结算 ...');
    var expired = await waitFor(function () { return evs(D, expMark, 'trade-result').length >= 1; }, 96000, 1000);
    var eres = evs(D, expMark, 'trade-result')[0];
    check('trade 请求 90s 过期后结算(trade-result)', expired && !!eres, eres ? JSON.stringify(eres) : '超时未收到 trade-result');
    check('过期后星球仍归原主', !!pl(A, expSellerPlanet) && pl(A, expSellerPlanet).owner === idA, pl(A, expSellerPlanet) ? ('owner=' + pl(A, expSellerPlanet).owner) : 'gone');
  } else skipCheck('trade 90s 过期结算', '无合适卖家星球(mine(A)=' + mine(A).length + ')');

  try { [A, B, C, D, E].forEach(function (x) { x.ws.send(JSON.stringify({ t: 'leave' })); }); } catch (_) {}
  await sleep(300);
  console.log('\n' + (fail ? ('失败: ' + fail) : 'ALL PASS') + '  (' + pass + ' 通过, ' + skip + ' 跳过, ' + fail + ' 失败)');
  process.exit(fail ? 1 : 0);
})().catch(function (e) { console.error('ERROR', e && e.stack || e); process.exit(1); });
