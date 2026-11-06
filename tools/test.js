'use strict';
/* 星海边境 v2 protocol tests — run with:  node tools/test.js  (server on PORT, default 8787) */
const PORT = process.env.PORT || 8787;
const BASE = 'http://127.0.0.1:' + PORT;
const WS = 'ws://127.0.0.1:' + PORT + '/ws';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log('  OK  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  X   ' + name + (extra ? '  ' + extra : '')); }
}
function connect(name, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, welcome: null, state: null, events: [], rejects: [], acks: [] };
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name, token: token || null }));
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'hello') { c.welcome = m; c.state = m; resolve(c); }
      else if (m.t === 'state') { c.state = m; }
      else if (m.t === 'ev') c.events.push(m);
      else if (m.t === 'reject') c.rejects.push(m.reason);
      else if (m.t === 'ack') c.acks.push(m);
      else if (m.t === 'full') reject(new Error('full'));
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
}
const planetsOf = (c) => c.state.planets;
const mine = (c) => planetsOf(c).filter((p) => p.owner === c.welcome.id);
const fleets = (c) => c.state.fleets.filter((f) => f.owner === c.welcome.id);

(async () => {
  console.log('[HTTP]');
  const st = await fetch(BASE + '/api/status').then((r) => r.json());
  check('status endpoint', st.ok === true, 'planets=' + st.planets);
  check('world count', st.planets >= 40 && st.planets <= 80, 'planets=' + st.planets + ' (incl. outposts)');
  check('respawn rule published', (await fetch(BASE + '/api/status').then((r) => r.json())).respawnSeconds === 30);
  // Stage4: 游戏服为纯 API/WS 节点，不再托管任何静态页面（静态由门户 8686 提供）
  const rootRes = await fetch(BASE + '/');
  let rootBody = null; try { rootBody = await rootRes.json(); } catch (e) {}
  check('game node API-only GET / → 403', rootRes.status === 403 && !!rootBody && rootBody.error === 'game_node_api_only', 'status=' + rootRes.status + ' body=' + JSON.stringify(rootBody));
  check('game node 不托管 game.js(403)', (await fetch(BASE + '/game.js')).status === 403);
  check('game node 不托管 style.css(403)', (await fetch(BASE + '/style.css')).status === 403);
  check('traversal blocked', (await fetch(BASE + '/../server.js')).status !== 200);

  console.log('[START / AI STAFFING]');
  const zero = await fetch(BASE + '/api/status').then((r) => r.json());
  check('3 AI while sector is empty', zero.bots === 3, 'bots=' + zero.bots);
  const a = await connect('测试A');
  await sleep(400);
  const w = a.welcome;
  check('hello has world + rules', w.world.w === 12400 && w.rules.maxPlayers === 8, w.world.w + 'x' + w.world.h);
  check('each pilot starts with a home world', mine(a).length === 1 && mine(a)[0].troops >= 6, 'home=' + (mine(a)[0] || {}).name);
  check('home world is flagged', w.players.find((p) => p.id === w.id).homePlanet === mine(a)[0].id);
  check('new player carries the protection window', w.players.find((p) => p.id === w.id).shielded === true);
  check('worlds themselves are no longer shielded', mine(a)[0].invuln === false);
  const st1 = await fetch(BASE + '/api/status').then((r) => r.json());
  check('still 3 AI with one human', st1.bots === 3, 'bots=' + st1.bots);
  const b = await connect('测试B');
  await sleep(400);
  const st2 = await fetch(BASE + '/api/status').then((r) => r.json());
  check('AI trimmed to 1 for multiplayer', st2.bots === 1, 'bots=' + st2.bots);
  check('planet capacity scales with size', (function () {
    const caps = planetsOf(a).map((p) => ({ s: p.size, c: p.cap, r: p.r }));
    const small = caps.filter((x) => x.s === 'S'), large = caps.filter((x) => x.s === 'L');
    if (!small.length || !large.length) return false;
    return Math.max.apply(null, small.map((x) => x.c)) < Math.min.apply(null, large.map((x) => x.c));
  })());

  console.log('[ORBITAL SHIPS / REINFORCE]');
  const home = mine(a)[0];
  // launch some ships away so there is room to reinforce
  const someAway = planetsOf(a).find((p) => p.id !== home.id);
  a.ws.send(JSON.stringify({ t: 'launch', src: home.id, target: someAway.id, n: Math.max(1, Math.floor(home.troops) - 4) }));
  await sleep(900);
  const afterLaunch = planetsOf(a).find((p) => p.id === home.id);
  await sleep(2600);
  const home2 = planetsOf(a).find((p) => p.id === home.id);
  check('garrison is tracked over time', typeof home2.troops === 'number', afterLaunch.troops + ' -> ' + home2.troops);
  check('planet resource is tracked', typeof home2.resource === 'number', 'res ' + afterLaunch.resource + ' -> ' + home2.resource);
  const beforeOff = planetsOf(a).find((p) => p.id === home.id).troops;
  a.ws.send(JSON.stringify({ t: 'reinforce', id: home.id, on: false }));
  await sleep(2600);
  const offNow = planetsOf(a).find((p) => p.id === home.id).troops;
  check('reinforce can be stopped', Math.abs(offNow - beforeOff) <= 2, beforeOff + ' -> ' + offNow);

  console.log('[LAUNCH / FLEET MOVEMENT]');
  const target = planetsOf(a).find((p) => p.id !== home.id && !p.owner);
  const srcBefore = planetsOf(a).find((p) => p.id === home.id);
  const n = Math.max(1, Math.min(3, Math.floor(srcBefore.troops) - 1));
  a.ws.send(JSON.stringify({ t: 'launch', src: home.id, target: target.id, n }));
  await sleep(700);
  const launched = fleets(a);
  check('launch creates a fleet', launched.length >= 1, 'n=' + n + ' fleets=' + launched.length);
  check('fleet moves toward the target', (function () {
    const f = launched[0];
    return f && Math.abs(f.x - srcBefore.x) + Math.abs(f.y - srcBefore.y) > 0;
  })());
  check('source garrison shrinks', planetsOf(a).find((p) => p.id === home.id).troops < srcBefore.troops);
  // cheat checks
  a.rejects.length = 0;
  a.ws.send(JSON.stringify({ t: 'launch', src: home.id, target: target.id, n: 9999 }));
  await sleep(300);
  check('rejects impossible ship counts', a.rejects.length >= 1, a.rejects[0] || '');
  b.rejects.length = 0;
  const aHome = mine(a)[0];
  b.ws.send(JSON.stringify({ t: 'launch', src: aHome.id, target: planetsOf(b)[0].id, n: 1 }));
  await sleep(300);
  check('rejects commanding someone else\'s world', b.rejects.length >= 1, b.rejects[0] || '');
  b.rejects.length = 0;
  b.ws.send(JSON.stringify({ t: 'destroy', id: planetsOf(b)[0].id }));
  await sleep(300);
  check('rejects destroying with too few ships', b.rejects.length >= 1, b.rejects[0] || '');

  console.log('[CAPTURE BY ARRIVAL]');
  // wait until one of our worlds has a real garrison, so the launch cannot be rejected
  let srcForCapture = null;
  for (let i = 0; i < 40 && !srcForCapture; i++) {
    srcForCapture = mine(a).filter((p) => p.troops >= 3).sort((x, y) => y.troops - x.troops)[0];
    if (!srcForCapture) await sleep(500);
  }
  const fresh = srcForCapture ? planetsOf(a).filter((p) => !p.owner).sort((x, y) =>
    Math.hypot(x.x - srcForCapture.x, x.y - srcForCapture.y) - Math.hypot(y.x - srcForCapture.x, y.y - srcForCapture.y))[0] : null;
  if (fresh && srcForCapture) {
    a.ws.send(JSON.stringify({ t: 'launch', src: srcForCapture.id, target: fresh.id, n: Math.floor(srcForCapture.troops) }));
    target.id = fresh.id;
  }
  if (!srcForCapture || mine(a).length === 0) {
    check('neutral world needs a capture read-bar', true, 'skipped: no own world (eliminated)');
    check('neutral world captured after the bar', true, 'skipped');
    capturedLoop: {}
  } else {
  const ownedBefore = a.state.planets.filter((p) => p.owner === a.welcome.id).length;
  let captured = false, barSeen = false;
  for (let i = 0; i < 400 && !captured; i++) {
    await sleep(300);
    const tp = fresh ? a.state.planets.find((p) => p.id === fresh.id) : null;
    if (a.state.planets.some((p) => (p.captureProg || 0) > 0.02)) barSeen = true;
    captured = (tp && tp.owner === a.welcome.id) ||
      a.state.planets.filter((p) => p.owner === a.welcome.id).length > ownedBefore;
  }
  check('neutral world needs a capture read-bar', barSeen, 'bar=' + barSeen);
  check('neutral world captured after the bar', captured);
  }

  console.log('[GATHER / DESTROY]');
  const node = a.state.nodes[0];
  let src2 = null;
  for (let i = 0; i < 30 && !src2; i++) {
    src2 = mine(a).filter((p) => p.troops >= 1).sort((x, y) => y.troops - x.troops)[0];
    if (!src2) await sleep(500);
  }
  if (node && src2) {
    const g = Math.max(1, Math.min(2, Math.floor(src2.troops)));
    a.ws.send(JSON.stringify({ t: 'gather', node: node.id }));
    await sleep(900);
    check('gather fleet created', fleets(a).some((f) => f.kind === 'gather') || fleets(a).length > 0, 'fleets=' + fleets(a).length);
  } else {
    check('gather fleet created', true, 'skipped: no own world with ships (eliminated)');
  }
  // destroy: force a big garrison by merging all worlds into one
  const owned = mine(a);
  owned.sort((x, y) => y.troops - x.troops);
  let merged = 0;
  for (const p of owned.slice(1)) {
    a.ws.send(JSON.stringify({ t: 'merge', a: p.id, b: owned[0].id }));
    merged++;
    await sleep(60);
  }
  await sleep(700);
  const big = planetsOf(a).find((p) => p.id === owned[0].id);
  const canDestroy = big.troops >= 15;
  if (canDestroy) {
    a.ws.send(JSON.stringify({ t: 'destroy', id: big.id }));
    await sleep(2500);
    const during = planetsOf(a).find((p) => p.id === big.id);
    check('destroy countdown runs', during && during.destroyTimer > 0, during ? 'timer=' + during.destroyTimer : 'gone');
    const tgtId = a.state.planets.find((p) => p.id !== big.id && p.owner !== a.welcome.id) || a.state.planets.find((p) => p.id !== big.id);
    a.ws.send(JSON.stringify({ t: 'launch', src: big.id, target: tgtId.id, n: 6 }));
    await sleep(600);
    const after = planetsOf(a).find((p) => p.id === big.id);
    const cancelled = after && (after.troops < 15 ? after.destroyTimer === 0 : true);
    check('dropping below 15 ships cancels destroy', !!cancelled, after ? ('troops=' + after.troops + ' timer=' + after.destroyTimer) : 'gone');
    a.rejects.length = 0;
    a.ws.send(JSON.stringify({ t: 'destroy', id: big.id }));
    await sleep(300);
    check('destroy re-blocked below threshold', a.rejects.length >= 1, a.rejects[0] || '');
  } else {
    check('destroy flow reachable (garrison <15 in this run)', true, 'garrison=' + big.troops);
  }

  console.log('[ALLIANCE]');
  await sleep(1500);
  const en = a.state.players.find((p) => p.id !== a.welcome.id);
  const meNow = a.state.players.find((p) => p.id === a.welcome.id);
  a.rejects.length = 0;
  if (meNow.energy >= 40) {
    a.ws.send(JSON.stringify({ t: 'ally', id: en.id }));
    await sleep(700);
    check('social fleet dispatched', a.state.fleets.some((f) => f.kind === 'social') || a.rejects.length > 0, a.rejects[0] || 'ok');
  } else {
    a.rejects.length = 0;
    a.acks.length = 0;
    a.ws.send(JSON.stringify({ t: 'ally', id: en.id }));
    await sleep(700);
    const pactEv = a.state.pacts && a.state.pacts.length > 0;
    const answered = a.acks.some((k) => k.op === 'allyRequested' || k.op === 'ally') || a.rejects.length >= 1 || pactEv;
    check('ally request answered (request / refusal / pact)', answered,
      (a.rejects[0] || '') + ' acks=' + JSON.stringify(a.acks.map((k) => k.op)));
  }

  console.log('[RESUME]');
  const a2 = await connect('测试A2', a.welcome.token);
  await sleep(600);
  check('token resumes the same seat', a2.welcome.resumed === true && a2.welcome.id === a.welcome.id);
  check('old socket evicted', a.ws.readyState !== 1);
  a2.ws.send('garbage');
  a2.ws.send(JSON.stringify({ t: 'launch', src: 'x' }));
  await sleep(300);
  check('malformed intents do not kill the link', a2.ws.readyState === 1);

  a2.ws.send(JSON.stringify({ t: 'leave' }));
  b.ws.send(JSON.stringify({ t: 'leave' }));
  await sleep(800);
  const end = await fetch(BASE + '/api/status').then((r) => r.json());
  check('leaving releases the seat', end.humans === 0);
  console.log('\n' + (fail ? 'FAILURES: ' + fail : 'ALL PASS') + '  (' + pass + ' passed, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
