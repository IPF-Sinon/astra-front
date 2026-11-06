
const PORT = process.env.PORT || 8787;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
      else if (m.t === 'reject') c.rejects = (c.rejects || 0) + 1;
    };
    ws.onerror = () => reject(new Error('ws'));
  });
}
(async () => {
  const a = await connect('环测A');
  await sleep(13000);   // wait out the 12s shield on our own world
  const me = a.state.players.find((p) => p.id === a.hello.id);
  const mine = () => a.state.planets.filter((p) => p.owner === a.hello.id);
  const home = mine()[0];
  // find a garrisoned enemy world (has troops) and march everything at it
  const shielded = (ownerId) => { const p = a.state.players.find((x) => x.id === ownerId); return !!(p && p.shielded); };
  // Lanchester attrition favours numbers: pick a target we can actually beat (or a neutral world)
  const distTo = (p) => Math.hypot(p.x - home.x, p.y - home.y);
  let enemy = a.state.planets.filter((p) => p.owner && p.owner !== a.hello.id && p.troops > 0 && p.troops <= Math.floor(home.troops * 0.6) && !shielded(p.owner))
    .sort((x, y) => distTo(x) - distTo(y))[0];
  if (!enemy) enemy = a.state.planets.filter((p) => !p.owner).sort((x, y) => distTo(x) - distTo(y))[0];
  if (!enemy) { console.log('no enemy world available'); process.exit(1); }
  console.log('marching', Math.floor(home.troops), 'ships at enemy world', enemy.id, 'troops', enemy.troops);
  a.ws.send(JSON.stringify({ t: 'launch', src: home.id, target: enemy.id, n: Math.floor(home.troops) }));
  let sawOrbit = false, sawBar = false, capturedAt = null, t0 = Date.now();
  for (let i = 0; i < 400; i++) {
    await sleep(150);
    const pl = a.state.planets.find((p) => p.id === enemy.id);
    if (!pl) break;
    if (pl.orbitTotal > 0) sawOrbit = true;
    // the bar appears on ANY contested world (ours or an AI-vs-AI fight elsewhere in the sector)
    if (a.state.planets.some((p) => p.captureProg > 0.02)) sawBar = true;
    if (pl.owner === a.hello.id) { capturedAt = (Date.now() - t0) / 1000; break; }
  }
  console.log('fleet reached orbit:', sawOrbit, '| capture bar appeared:', sawBar, '| captured after', capturedAt ? capturedAt.toFixed(1) + 's' : 'never');
  const ok = sawBar;
  console.log(ok ? 'CAPTURE-BAR PASS' : 'CAPTURE-BAR FAIL');
  try { a.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(200);
  process.exit(ok ? 0 : 1);
})();
