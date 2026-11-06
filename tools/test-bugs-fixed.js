'use strict';
/* Phase-1 regression: BUG-1 pact consent, BUG-2 gather route fields, BUG-3 outpost merged into planets */
const PORT = process.env.PORT || 8787;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } };

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, hello: null, state: null, ev: [], acks: [], rejects: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { c.hello = m; c.state = m; resolve(c); }
      else if (m.t === 'state') c.state = m;
      else if (m.t === 'ev') c.ev.push(m);
      else if (m.t === 'ack') c.acks.push(m);
      else if (m.t === 'reject') c.rejects.push(m.reason);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}
const me = (c) => c.state.players.find((p) => p.id === c.hello.id);
const myPlanet = (c) => c.state.planets.find((p) => p.id === me(c).homePlanet);

(async () => {
  const A = await connect('测试甲');
  const B = await connect('测试乙');
  await sleep(900);

  console.log('[BUG-1] AI/玩家结盟必须弹窗同意');
  B.ev.length = 0; A.ev.length = 0;
  B.ws.send(JSON.stringify({ t: 'ally', id: A.hello.id }));
  await sleep(700);
  const req = A.ev.find((e) => e.k === 'pact-request');
  check('对方收到 pact-request', !!req, req ? 'from=' + req.fromName : 'none');
  const pactEarly = (A.state.pacts || []).length > 0;
  check('未经同意不得结盟', !pactEarly, 'pacts=' + (A.state.pacts || []).length);
  if (req) {
    A.ws.send(JSON.stringify({ t: 'pactRespond', from: B.hello.id, accept: true }));
    await sleep(600);
    check('同意后才结盟', (A.state.pacts || []).length > 0, 'pacts=' + (A.state.pacts || []).length);
  }
  const socials = (A.state.fleets || []).concat(B.state.fleets || []).filter((f) => f.kind === 'social');
  check('不再靠社交舰队自动结盟', socials.length === 0, 'social fleets=' + socials.length);

  console.log('[BUG-2] 采集舰队带起点/终点轨迹字段');
  const node = (A.state.nodes || [])[0];
  if (node) {
    A.ws.send(JSON.stringify({ t: 'gather', node: node.id }));
    await sleep(600);
    const gf = (A.state.fleets || []).find((f) => f.owner === A.hello.id && (f.kind === 'gather' || f.node === node.id));
    check('采集舰队已生成', !!gf, gf ? 'id=' + gf.id : 'none');
    if (gf) {
      const hasStart = Number.isFinite(gf.startX) && Number.isFinite(gf.startY);
      check('携带 startX/startY', hasStart, hasStart ? (gf.startX + ',' + gf.startY) : 'missing');
      check('携带目标 tx/ty 或 node', Number.isFinite(gf.tx) && Number.isFinite(gf.ty), 'tx=' + gf.tx + ' ty=' + gf.ty);
      check('srcPlanet 已记录', !!gf.srcPlanet, 'srcPlanet=' + gf.srcPlanet);
    }
  } else { check('采集舰队已生成', false, 'no nodes'); }

  console.log('[BUG-3] 驻点并入 planets、可选中、不自动产兵');
  const P = myPlanet(A);
  let placed = null;
  const spots = [[6200, 700], [2200, 7400], [9800, 2200], [4000, 4200], [11200, 7600]];
  for (const s of spots) {
    A.ws.send(JSON.stringify({ t: 'outpost', level: 1, x: s[0], y: s[1] }));
    await sleep(350);
    const op = (A.state.planets || []).find((p) => p.isOutpost && p.owner === A.hello.id);
    if (op) { placed = op; break; }
  }
  check('驻点建成（在 planets 中）', !!placed, placed ? 'id=' + placed.id + ' name=' + placed.name : 'failed');
  check('驻点派生出 outposts 视图', (A.state.outposts || []).some((o) => o.id === (placed && placed.id)));
  if (placed) {
    const t0 = placed.troops;
    await sleep(5000);
    const after = (A.state.planets || []).find((p) => p.id === placed.id);
    check('驻点不自动产兵（5s）', after && after.troops === t0, (t0 + ' -> ' + (after ? after.troops : 'gone')));
    check('驻点名称为停泊点', /停泊点/.test(after ? after.name : ''), after ? after.name : '');
    check('驻点是有主可选中实体', after && after.owner === A.hello.id && after.shape === 'hex');
  }

  try { A.ws.send(JSON.stringify({ t: 'leave' })); B.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(300);
  console.log('\n' + (fail ? 'BUGS FAILURES: ' + fail : 'BUGS ALL PASS') + '  (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
