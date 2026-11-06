'use strict';
/* Neutral-world purity regression: no owner-less world may keep a garrison or a non-zero purity.
 * Run with a server on PORT (default 8787), ideally FREEZE_AI=1: node tools/test-neutral-purity.js */
const PORT = process.env.PORT || 8787;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } };

function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, hello: null, state: null, ev: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { c.hello = m; c.state = m; resolve(c); }
      else if (m.t === 'state') c.state = m;
      else if (m.t === 'ev') c.ev.push(m);
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}

(async () => {
  const A = await connect('中立甲');
  await sleep(700);
  const planets = A.state.planets || [];

  console.log('[1] 无主星球不得带驻军');
  const neutralWithTroops = planets.filter((p) => !p.owner && p.troops > 0);
  check('no owner-less world keeps a garrison', neutralWithTroops.length === 0,
    'offenders=' + neutralWithTroops.length + (neutralWithTroops[0] ? ' e.g. #' + neutralWithTroops[0].id + ' ' + neutralWithTroops[0].troops + '/' + neutralWithTroops[0].cap : ''));

  console.log('[2] 无主星球阵营化必须为 0（不得显示 100%）');
  const neutralGhost = planets.filter((p) => !p.owner && (p.purityProg == null ? 1 : p.purityProg) > 0.001);
  check('no owner-less world keeps purity > 0', neutralGhost.length === 0,
    'offenders=' + neutralGhost.length + (neutralGhost[0] ? ' e.g. #' + neutralGhost[0].id + ' purity=' + neutralGhost[0].purityProg : ''));

  console.log('[3] 有主星球阵营化必须为 1');
  const ownedBad = planets.filter((p) => p.owner && (p.purityProg == null ? 1 : p.purityProg) < 0.999);
  check('every owned world reads purity 1 at rest', ownedBad.length === 0,
    'offenders=' + ownedBad.length + (ownedBad[0] ? ' e.g. #' + ownedBad[0].id + ' purity=' + ownedBad[0].purityProg : ''));

  console.log('[4] 资源点半径已放大到 32');
  const nodes = A.state.nodes || [];
  check('resource nodes exist', nodes.length > 0, 'n=' + nodes.length);
  check('node radius is 32', nodes.every((n) => n.r === 32), 'sample r=' + (nodes[0] ? nodes[0].r : 'none'));

  console.log('\n' + (fail ? 'NEUTRAL-PURITY FAILURES: ' + fail : 'NEUTRAL-PURITY ALL PASS') + '  (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
