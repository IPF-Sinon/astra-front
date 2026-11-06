'use strict';
/* Task-A regression: resource-node 3s read exclusivity + same-faction dedupe.
 * Run with a server on PORT (default 8787), ideally FREEZE_AI=1: node tools/test-node-exclusive.js */
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
const me = (c) => (c.state.players || []).find((p) => p.id === c.hello.id);
const myPlanets = (c) => (c.state.planets || []).filter((p) => p.owner === c.hello.id);

(async () => {
  const A = await connect('采集甲');
  const B = await connect('采集乙');
  await sleep(900);

  const homes = myPlanets(A);
  if (!homes.length) { check('player A has a home world', false, 'no planets'); }
  const home = homes[0];
  // nearest node to A home
  const nodes = (A.state.nodes || []).slice();
  let node = nodes[0];
  let best = Infinity;
  for (const n of nodes) {
    const d = Math.hypot(n.x - home.x, n.y - home.y);
    if (d < best) { best = d; node = n; }
  }
  check('found a resource node', !!node, node ? 'id=' + node.id + ' dist=' + Math.round(best) : 'none');
  if (!node) { finish(); return; }

  // 1) A dispatches one gather
  A.rejects.length = 0; A.acks.length = 0;
  A.ws.send(JSON.stringify({ t: 'gather', node: node.id }));
  await sleep(400);
  const aGather = (A.state.fleets || []).filter((f) => f.owner === A.hello.id && f.kind === 'gather' && f.node === node.id);
  check('first gather fleet created', aGather.length === 1, 'n=' + aGather.length);
  const fleetId = aGather.length ? aGather[0].id : null;

  // 2) A dispatches again to same node -> same-faction dedupe reject
  A.ws.send(JSON.stringify({ t: 'gather', node: node.id }));
  await sleep(400);
  check('same-faction duplicate gather rejected', A.rejects.some((r) => /已有己方飞船/.test(r)), 'rejects=' + JSON.stringify(A.rejects));

  // 3) B (different faction) may still gather the same node (dedupe is per-owner)
  B.rejects.length = 0;
  B.ws.send(JSON.stringify({ t: 'gather', node: node.id }));
  await sleep(400);
  check('dedupe is per-owner (B not blocked by A)', !B.rejects.some((r) => /已有己方飞船/.test(r)), 'B rejects=' + JSON.stringify(B.rejects));

  // 4) First reader resolves: A's fleet either claims node (node gone / amount drops) or is bounced back
  let resolved = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    const cur = (A.state.nodes || []).find((n) => n.id === node.id);
    const fl = (A.state.fleets || []).find((f) => f.id === fleetId);
    const claimed = !cur; // node consumed / removed on claim
    const bounced = !fl || fl.kind === 'march' || fl.returning;
    if (claimed || bounced) { resolved = true; break; }
    await sleep(400);
  }
  check('node read resolves (reader claims, or latecomer bounced) within 15s', resolved, 'resolved=' + resolved);

  finish();
})().catch((e) => { console.error('ERR', e); process.exit(1); });

function finish() {
  console.log('\n' + (fail ? 'NODE-EXCLUSIVE FAILURES: ' + fail : 'NODE-EXCLUSIVE ALL PASS') + '  (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
}
