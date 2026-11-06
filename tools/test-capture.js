'use strict';
/* capture read-bar regression: a fleet must spend CAPTURE_SECONDS in orbit, not grab the world instantly */

const PORT = process.env.PORT || 8787;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function connect(name) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, hello: null, state: null, events: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.t === 'hello') { c.hello = m; c.state = m; resolve(c); } else if (m.t === 'state') c.state = m; else if (m.t === 'ev') c.events.push(m); };
    ws.onerror = () => reject(new Error('ws'));
  });
}
(async () => {
  const a = await connect('读条测试');
  await sleep(3600);
  const mine = () => a.state.planets.filter((p) => p.owner === a.hello.id);
  const home = mine()[0];
  // find a neutral world and send everything at it
  const target = a.state.planets.filter((p) => !p.owner && p.id !== home.id)[0];
  console.log('home', home.id, 'troops', Math.floor(home.troops), '-> target', target.id, 'owner', target.owner, 'troops', target.troops);
  a.ws.send(JSON.stringify({ t: 'launch', src: home.id, target: target.id, n: Math.floor(home.troops) }));
  let capturedAt = null, sawBar = false, t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    await sleep(100);
    const pl = a.state.planets.find((p) => p.id === target.id);
    if (!pl) continue;
    if (pl.captureProg > 0.05 && pl.owner !== a.hello.id) { sawBar = true; if (!capturedAt && pl.captureProg > 0.2) console.log('   bar', Math.round(pl.captureProg * 100) + '% at', ((Date.now() - t0) / 1000).toFixed(1) + 's'); }
    if (pl.owner === a.hello.id) { capturedAt = Date.now() - t0; break; }
  }
  console.log('capture bar observed:', sawBar, '| first capture completed at', capturedAt ? (capturedAt / 1000).toFixed(1) + 's' : 'contested by another fleet');
  console.log('takes longer than an instant grab:', sawBar);
  const tp = a.state.planets.find((p) => p.id === target.id);
  console.log('target state:', JSON.stringify({ owner: tp.owner, troops: tp.troops, bar: tp.captureProg, by: tp.captureBy, invuln: tp.invuln }));
  console.log('my fleets:', JSON.stringify(a.state.fleets.filter((x) => x.owner === a.hello.id).map((x) => ({ n: x.n, target: x.target, x: x.x, y: x.y }))));
  const f = a.state.fleets.filter((x) => x.owner === a.hello.id);
  console.log('fleets in transit:', f.map((x) => x.n + ' ships').join(', ') || 'none');
  try { a.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(200);
  process.exit(sawBar ? 0 : 1);
})();
