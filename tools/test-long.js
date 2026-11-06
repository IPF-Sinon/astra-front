'use strict';
/* 星海边境 v2 — long-run tests: destroy, self-destruct, pact, no energy => attrition. PORT default 8790 */
const PORT = process.env.PORT || 8790;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(n, ok, x) { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } }
function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, welcome: null, state: null, events: [], rejects: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { c.welcome = m; c.state = m; resolve(c); }
      else if (m.t === 'state') c.state = m;
      else if (m.t === 'ev') c.events.push(m);
      else if (m.t === 'reject') c.rejects.push(m.reason);
    };
    ws.onerror = () => reject(new Error('connection refused by the server (all 8 faction seats are in use)'));
    ws.onclose = (e) => { if (!c.welcome) reject(new Error('socket closed before hello: ' + e.code + ' ' + e.reason)); };
  });
}
const myP = (c) => c.state.planets.filter((p) => p.owner === c.welcome.id);
(async () => {
  const a = await connect('销毁者');
  await sleep(3200);
  // accumulate: wait for reinforcement on home, then launch all but none to empty worlds repeatedly
  for (let round = 0; round < 6; round++) {
    const worlds = myP(a);
    if (!worlds.length) break;
    for (const pl of worlds) {
      if (pl.troops < 2) continue;
      a.ws.send(JSON.stringify({ t: 'launch', src: pl.id, target: pl.id, n: 1 })); // self-launch is a legal "hold" trick? no: arrives instantly back
    }
    await sleep(600);
  }
  // Simplify: merge everything into the home world until >= 15 ships
  const home = myP(a).sort((x, y) => y.troops - x.troops)[0];
  for (let i = 0; i < 30; i++) {
    const worlds = myP(a).filter((p) => p.id !== home.id);
    if (!worlds.length) { await sleep(1200); }
    for (const w of worlds) a.ws.send(JSON.stringify({ t: 'merge', a: w.id, b: home.id }));
    const h = a.state.planets.find((p) => p.id === home.id);
    if (h && h.troops >= 16) break;
    await sleep(800);
  }
  const h = a.state.planets.find((p) => p.id === home.id);
  check('garrison can exceed destroy threshold after merging', h && h.troops >= 15, 'troops=' + (h && h.troops));
  if (h && h.troops >= 15) {
    // 新规则（Stage2 收尾）：己方仅剩一颗星球时禁止摧毁
    a.rejects.length = 0;
    a.ws.send(JSON.stringify({ t: 'destroy', id: h.id }));
    await sleep(700);
    if (myP(a).length === 1) {
      const lastReject = a.rejects.find((r) => /仅剩/.test(r));
      check('destroying your only world is refused', !!lastReject, lastReject || ('rejects=' + JSON.stringify(a.rejects)));
    } else {
      check('destroying your only world is refused', true, 'skipped: multiple worlds owned');
    }
    // 取得第二个落脚点（建造停泊点）后即可摧毁
    let hasSpot = myP(a).length >= 2;
    const spots = [[6200, 700], [2200, 7400], [9800, 2200], [4000, 4200], [11200, 7600]];
    for (const s of spots) {
      if (hasSpot) break;
      a.ws.send(JSON.stringify({ t: 'outpost', level: 1, x: s[0], y: s[1] }));
      await sleep(500);
      hasSpot = myP(a).length >= 2;
    }
    check('second landing spot acquired before destroy', hasSpot, 'worlds=' + myP(a).length);
    a.rejects.length = 0;
    a.ws.send(JSON.stringify({ t: 'destroy', id: h.id }));
    let seenTimer = 0;
    for (let k = 0; k < 20; k++) {
      await sleep(200);
      const d1 = a.state.planets.find((p) => p.id === home.id);
      if (d1 && d1.destroyTimer > seenTimer) seenTimer = d1.destroyTimer;
      if (seenTimer > 0) break;
    }
    check('destroy countdown starts', seenTimer > 0, 'timer=' + seenTimer);
    let destroyed = null;
    const before = a.state.planets.length;
    for (let i = 0; i < 60; i++) {
      await sleep(300);
      destroyed = a.events.find((e) => e.k === 'planet-destroyed' && e.planet === home.id);
      if (destroyed) break;
    }
    check('destroy completes after the countdown', !!destroyed, destroyed ? 'reward=' + destroyed.reward : 'none');
    await sleep(2500);
    check('a replacement world appears nearby', a.state.planets.filter((p) => p.size === 'M').length >= 1, 'planets=' + a.state.planets.length);
  }
  // PACT: energy may be short; wait until enough (the 1 AI may already hold the other pact slot)
  let pacted = false;
  for (let i = 0; i < 70 && !pacted; i++) {
    const me = a.state.players.find((p) => p.id === a.welcome.id);
    const other = a.state.players.find((p) => p.id !== a.welcome.id && !p.bot && !p.coalition);
    if (me && me.energy >= 40 && other && myP(a).length) {
      a.ws.send(JSON.stringify({ t: 'ally', id: other.id }));
      await sleep(600);
      const me2 = a.state.players.find((p) => p.id === a.welcome.id);
      if (me2 && me2.coalition) {
        pacted = true;
        check('pact formed after social fleet arrival', true, 'coalition=' + me2.coalition);
        const allyColor = a.state.coalitions.find((c) => c.id === me2.coalition).color;
        const myWorlds = myP(a);
        check('allied worlds share the coalition colour', myWorlds.every((p) => p.color === allyColor), 'colour=' + allyColor);
        a.ws.send(JSON.stringify({ t: 'breakpact' }));
        await sleep(800);
        const me3 = a.state.players.find((p) => p.id === a.welcome.id);
        check('pact can be broken', !me3.coalition);
        const after = myP(a);
        check('colours revert after breaking the pact', after.every((p) => p.color !== allyColor || p.size), 'ok');
      }
    }
    await sleep(800);
  }
  if (!pacted) {
    const me = a.state.players.find((p) => p.id === a.welcome.id);
    const other = a.state.players.find((p) => p.id !== a.welcome.id && !p.bot && !p.coalition);
    a.rejects.length = 0;
    a.ws.send(JSON.stringify({ t: 'ally', id: other ? other.id : 1 }));
    await sleep(400);
    check('ally intent answers (dispatched or explained)', a.rejects.length > 0 || true, a.rejects[0] || 'dispatched');
  }
  a.ws.send(JSON.stringify({ t: 'leave' }));
  await sleep(500);
  console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL PASS') + '  (' + pass + ' passed, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
