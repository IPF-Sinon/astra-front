'use strict';
/*
 * 星海边境 · Stage 2 Task B —— 18s 联合出兵（B4）服务端集成测试
 * 运行： node tools/test-taskb.js        （默认连 ws://127.0.0.1:8799）
 *        PORT=8799 node tools/test-taskb.js
 * 目标服务需以 FREEZE_AI=1 启动，避免 AI 干扰。
 *
 * 覆盖协议（docs/PROTOCOL-Stage2.md · B4）：
 *   ① jointLaunch 生成 joint-state（accepted 含发起者）并向被请求盟友 B 发 joint-request
 *   ② B jointVote accept 后 joint-state 更新 accepted 含 B
 *   ③ A jointGo 后收到 joint-launched，且 src -> target 出现己方 march 舰队
 *   ④ 无效操作被拒：非被请求者投票 / 非发起者 jointGo
 *   ⑤ 同一 (initiator, src, target) 未结束 joint 防重（第二次 jointLaunch 被拒）
 *
 * 盟友关系：先走“结盟 → 对方 pactRespond 接受”流程建立真实盟友关系（A-B）。
 *   若该流程在测试环境下难以成立，会打印 NOTE 并继续——B4 协议本身不强制 jointLaunch
 *   校验盟友身份；此时仅退化为“验证 joint 协议可被调用 + 拒绝/超时逻辑”。
 *   盟友在轨舰队分摊（execJoint 第 2 步）需要 B 有舰队停在 A.src 轨道，测试未构造该
 *   前置（会引入额外不稳定性），故第 2 步分摊只做协议级验证，见下方注释。
 *
 * 退出码：0 = ALL PASS，非 0 = 有失败。
 */
const PORT = Number(process.env.PORT || 8799);
const BASE = 'http://127.0.0.1:' + PORT;
const WS_URL = 'ws://127.0.0.1:' + PORT + '/ws';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  OK  ' + name + (extra ? '  [' + extra + ']' : '')); }
  else { fail++; console.log('  X   ' + name + (extra ? '  [' + extra + ']' : '')); }
}

function connect(name, token) {
  return new Promise((resolve, reject) => {
    let ws;
    try { ws = new WebSocket(WS_URL); } catch (e) { return reject(e); }
    const c = { ws, welcome: null, state: null, events: [], rejects: [], acks: [], closed: false };
    const timer = setTimeout(() => reject(new Error('hello timeout for ' + name)), 8000);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, token: token || null }));
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.t === 'hello') { c.welcome = m; c.state = m; clearTimeout(timer); resolve(c); }
      else if (m.t === 'state') { c.state = m; }
      else if (m.t === 'ev') c.events.push(m);
      else if (m.t === 'reject') c.rejects.push(m.reason || '(no reason)');
      else if (m.t === 'ack') c.acks.push(m);
      else if (m.t === 'full') { clearTimeout(timer); reject(new Error('server full')); }
    };
    ws.onerror = () => { clearTimeout(timer); reject(new Error('ws error for ' + name)); };
    ws.onclose = () => { c.closed = true; };
  });
}

// 事件/状态轮询等待
async function waitFor(fn, ms = 6000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let v; try { v = fn(); } catch (_) { v = false; }
    if (v) return true;
    await sleep(step);
  }
  return false;
}
const eventsOf = (c, k) => c.events.filter((e) => e.k === k);
const newEvents = (c, from, k) => c.events.slice(from).filter((e) => !k || e.k === k);
const planetsOf = (c) => (c.state && c.state.planets) || [];
const mineOf = (c) => planetsOf(c).filter((p) => p.owner === c.welcome.id);
const fleetsOf = (c) => ((c.state && c.state.fleets) || []).filter((f) => f.owner === c.welcome.id);
const findPlanet = (c, id) => planetsOf(c).find((p) => p.id === id);
const findFleetTo = (c, owner, targetId, kind) => ((c.state && c.state.fleets) || []).find((f) => f.owner === owner && f.target === targetId && (!kind || f.kind === kind));

(async () => {
  console.log('=== 星海边境 Task B · 联合出兵(B4) 集成测试 ===  PORT=' + PORT);

  // 0) 预检：等待服务就绪
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      const st = await fetch(BASE + '/api/status').then((r) => r.json());
      if (st && st.ok) { ready = true; console.log('[预检] 服务就绪 planets=' + st.planets + ' pacts=' + st.pacts); }
    } catch (_) { /* not up yet */ }
    if (!ready) await sleep(300);
  }
  if (!ready) { console.error('[预检] 服务在 ' + PORT + ' 端口未就绪，无法测试'); process.exit(2); }

  // 1) 连接两个真人
  const a = await connect('联测发起A');
  const b = await connect('联测盟友B');
  await sleep(500);
  check('两个真人已加入', !!a.welcome && !!b.welcome, 'A id=' + (a.welcome && a.welcome.id) + ' B id=' + (b.welcome && b.welcome.id));
  const A = a.welcome.id, B = b.welcome.id;

  // 2) 建立盟友关系：A -> ally(B) 请求，B -> pactRespond 接受
  console.log('[盟友关系]');
  a.rejects.length = 0;
  a.ws.send(JSON.stringify({ t: 'ally', id: B }));
  const gotReq = await waitFor(() => b.events.some((e) => e.k === 'pact-request' && e.from === A && e.to === B) || a.acks.some((x) => x.op === 'allyRequested'), 5000);
  b.rejects.length = 0;
  b.ws.send(JSON.stringify({ t: 'pactRespond', from: A, accept: true }));
  const allyOk = await waitFor(() => ((a.state && a.state.pacts) || []).some((p) => (p.a === A && p.b === B) || (p.a === B && p.b === A)), 5000);
  check('盟友关系建立（结盟流程）', allyOk, allyOk ? 'pact A<' + '->' + 'B' : ('请求发放=' + gotReq + ' A.rejects=' + JSON.stringify(a.rejects) + ' B.rejects=' + JSON.stringify(b.rejects)));
  if (!allyOk) {
    console.log('  NOTE 盟友关系未建立（可能 server 端 ally/pact 流程被改动），继续执行 B4 协议级测试；')
    console.log('       B4 协议不强制 jointLaunch 校验盟友身份，以下用例仍验证 joint 消息流与拒绝/超时逻辑。');
  }

  // 3) 准备 src 与目标（取离 src 最远的 3 颗中立星，保证 march 舰队在飞、便于观测）
  await waitFor(() => mineOf(a).length >= 1 && mineOf(a)[0].troops >= 6, 8000);
  const src = mineOf(a)[0];
  check('发起者拥有可用 src 星球', !!src, src ? ('src=' + src.id + ' troops=' + src.troops) : 'none');
  if (!src) { console.error('无法取得 src，终止'); process.exit(1); }
  const neutrals = planetsOf(a)
    .filter((p) => p.id !== src.id && !p.owner)
    .sort((x, y) => (Math.hypot(y.x - src.x, y.y - src.y)) - (Math.hypot(x.x - src.x, x.y - src.y)));
  const target1 = neutrals[0], target2 = neutrals[1], target3 = neutrals[2];
  check('准备 3 个测试目标星球', !!(target1 && target2 && target3), 'targets=' + [target1, target2, target3].map((p) => p && p.id).join(','));
  if (!target1 || !target2 || !target3) { console.error('中立目标不足，终止'); process.exit(1); }

  // 确保有充足驻军，避免 round(troops*pct) 为 0
  await waitFor(() => findPlanet(a, src.id).troops >= 8, 10000);
  const troopsNow = findPlanet(a, src.id).troops;

  // ---------- 用例 ① jointLaunch 生成 joint-state 并给 B 发 joint-request ----------
  console.log('[① jointLaunch → joint-state + joint-request]');
  const m1a = a.events.length, m1b = b.events.length;
  a.rejects.length = 0;
  a.ws.send(JSON.stringify({ t: 'jointLaunch', src: src.id, target: target1.id, pct: 0.5, allies: [{ owner: B, pct: 0.5 }] }));
  const state1Ok = await waitFor(() => newEvents(a, m1a, 'joint-state').length >= 1, 5000);
  const state1 = newEvents(a, m1a, 'joint-state')[0];
  check('① 发起者收到 joint-state', state1Ok, state1 ? ('id=' + state1.id + ' accepted=' + JSON.stringify(state1.accepted) + ' deadline=' + state1.deadline) : 'timeout');
  check('① joint-state 初始 accepted 含发起者', !!(state1 && Array.isArray(state1.accepted) && state1.accepted.indexOf(A) >= 0), state1 ? JSON.stringify(state1.accepted) : 'n/a');
  const req1Ok = await waitFor(() => newEvents(b, m1b, 'joint-request').length >= 1, 5000);
  const req1 = newEvents(b, m1b, 'joint-request')[0];
  check('① 盟友 B 收到 joint-request', req1Ok, req1 ? ('id=' + req1.id + ' from=' + req1.from + ' src=' + req1.src + ' target=' + req1.target + ' pct=' + req1.pct) : 'timeout');
  const jointId1 = (state1 && state1.id) || (req1 && req1.id) || 0;
  check('① joint-state 与 joint-request 的 id 一致', !!(state1 && req1 && state1.id === req1.id), 'state=' + (state1 && state1.id) + ' req=' + (req1 && req1.id));
  check('① joint-request 字段完整(from/src/target/pct/deadline)', !!(req1 && req1.from === A && req1.src === src.id && req1.target === target1.id && req1.pct === 0.5 && req1.deadline), req1 ? JSON.stringify({ from: req1.from, src: req1.src, target: req1.target, pct: req1.pct, deadline: req1.deadline }) : 'n/a');

  // ---------- 用例 ② B jointVote accept → joint-state 更新 ----------
  console.log('[② B jointVote accept → joint-state accepted 更新]');
  const m2a = a.events.length, m2b = b.events.length;
  b.rejects.length = 0;
  if (jointId1) b.ws.send(JSON.stringify({ t: 'jointVote', id: jointId1, accept: true }));
  else console.log('  (无 jointId，跳过投票发送)');
  const state2Ok = await waitFor(() => newEvents(a, m2a, 'joint-state').some((e) => e.id === jointId1 && Array.isArray(e.accepted) && e.accepted.indexOf(B) >= 0)
    || newEvents(b, m2b, 'joint-state').some((e) => e.id === jointId1 && Array.isArray(e.accepted) && e.accepted.indexOf(B) >= 0), 5000);
  const st2ev = newEvents(a, m2a, 'joint-state').concat(newEvents(b, m2b, 'joint-state')).filter((e) => e.id === jointId1).pop();
  check('② accept 后 joint-state 的 accepted 含 B', state2Ok, st2ev ? JSON.stringify(st2ev.accepted) : ('B.rejects=' + JSON.stringify(b.rejects)));
  // 若所有被请求盟友均已表决，协议要求立即执行 → 顺带观察 joint-launched（非强制断言）
  const launched2 = await waitFor(() => newEvents(a, m2a, 'joint-launched').some((e) => e.id === jointId1) || newEvents(b, m2b, 'joint-launched').some((e) => e.id === jointId1), 3000);
  console.log('  INFO ② 全部被请求盟友表决后是否立即执行(joint-launched)：' + launched2 + '（协议允许立即执行）');

  // ---------- 用例 ③ A jointGo → joint-launched + src→target march 舰队 ----------
  console.log('[③ A jointGo → joint-launched + march 舰队]');
  // 新建一个仅 A 发起、B 尚未表决的 joint，确保 jointGo 是触发执行的动作
  await waitFor(() => findPlanet(a, src.id).troops >= 4, 8000);
  const m3a0 = a.events.length, m3b0 = b.events.length;
  a.ws.send(JSON.stringify({ t: 'jointLaunch', src: src.id, target: target2.id, pct: 0.3, allies: [{ owner: B, pct: 0.3 }] }));
  const gotState3 = await waitFor(() => newEvents(a, m3a0, 'joint-state').length >= 1, 5000);
  const state3 = newEvents(a, m3a0, 'joint-state')[0];
  const jointId3 = state3 && state3.id;
  check('③ 新建第二个 joint 成功（B 尚未表决）', gotState3 && !!jointId3, 'jointId=' + jointId3);
  const m3a = a.events.length, m3b = b.events.length;
  a.rejects.length = 0;
  if (jointId3) a.ws.send(JSON.stringify({ t: 'jointGo', id: jointId3 }));
  const launched3 = await waitFor(() => newEvents(a, m3a, 'joint-launched').some((e) => e.id === jointId3), 6000)
    || newEvents(b, m3b, 'joint-launched').some((e) => e.id === jointId3);
  const lev = newEvents(a, m3a, 'joint-launched').concat(newEvents(b, m3b, 'joint-launched')).filter((e) => e.id === jointId3).pop();
  check('③ A jointGo 后收到 joint-launched', launched3, lev ? ('id=' + lev.id + ' src=' + lev.src + ' target=' + lev.target + ' from=' + JSON.stringify(lev.from)) : ('A.rejects=' + JSON.stringify(a.rejects)));
  // 等待下一次 state 广播，然后在 src→target 方向寻找己方 march 舰队
  const marchOk = await waitFor(() => !!findFleetTo(a, A, target2.id, 'march'), 5000, 150);
  const mf = findFleetTo(a, A, target2.id, 'march');
  check('③ src→target 出现己方 march 舰队', marchOk, mf ? ('fleet=' + mf.id + ' n=' + mf.n + ' kind=' + mf.kind + ' target=' + mf.target) : '未观察到 march 舰队');

  // ---------- 用例 ④ 无效操作被拒 ----------
  console.log('[④ 无效操作：非被请求者投票 / 非发起者 jointGo]');
  await waitFor(() => findPlanet(a, src.id).troops >= 3, 8000);
  const m4a = a.events.length;
  a.ws.send(JSON.stringify({ t: 'jointLaunch', src: src.id, target: target3.id, pct: 0.3, allies: [{ owner: B, pct: 0.3 }] }));
  const gotState4 = await waitFor(() => newEvents(a, m4a, 'joint-state').length >= 1, 5000);
  const state4 = newEvents(a, m4a, 'joint-state')[0];
  const jointId4 = state4 && state4.id;
  check('④ 建立待决 joint 用于无效操作测试', gotState4 && !!jointId4, 'jointId=' + jointId4);
  // ④a 发起者(非被请求盟友)投票 → 应拒绝
  a.rejects.length = 0;
  if (jointId4) a.ws.send(JSON.stringify({ t: 'jointVote', id: jointId4, accept: true }));
  const voteRejected = await waitFor(() => a.rejects.length >= 1, 3000);
  check('④a 非被请求者(A)投票被拒', voteRejected, JSON.stringify(a.rejects));
  // ④b 非发起者(B) jointGo → 应拒绝
  b.rejects.length = 0;
  if (jointId4) b.ws.send(JSON.stringify({ t: 'jointGo', id: jointId4 }));
  const goRejected = await waitFor(() => b.rejects.length >= 1, 3000);
  check('④b 非发起者(B)jointGo 被拒', goRejected, JSON.stringify(b.rejects));

  // ---------- 用例 ⑤ 同一 (initiator,src,target) 防重 ----------
  console.log('[⑤ 同一 (initiator,src,target) 防重]');
  a.rejects.length = 0;
  const dupStateMark = a.events.filter((e) => e.k === 'joint-state').length;
  a.ws.send(JSON.stringify({ t: 'jointLaunch', src: src.id, target: target3.id, pct: 0.3, allies: [{ owner: B, pct: 0.3 }] }));
  const dupRejected = await waitFor(() => a.rejects.length >= 1, 3000);
  await sleep(400);
  const dupStates = a.events.filter((e) => e.k === 'joint-state').length;
  check('⑤ 重复 jointLaunch 被拒', dupRejected, JSON.stringify(a.rejects));
  check('⑤ 重复请求未产生新的 joint-state', dupStates === dupStateMark, 'before=' + dupStateMark + ' after=' + dupStates);
  // 清理：让 A 用 jointGo 结束 pending joint4，避免残留影响后续
  if (jointId4) { try { a.ws.send(JSON.stringify({ t: 'jointGo', id: jointId4 })); } catch (_) {} }
  await sleep(300);

  // 清理连接
  try { a.ws.send(JSON.stringify({ t: 'leave' })); } catch (_) {}
  try { b.ws.send(JSON.stringify({ t: 'leave' })); } catch (_) {}
  await sleep(300);

  console.log('\n' + (fail ? ('失败: ' + fail) : 'ALL PASS') + '  (' + pass + ' 通过, ' + fail + ' 失败)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e && e.stack || e); process.exit(1); });
