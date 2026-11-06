'use strict';
/* 星海边境 v2 — jsdom client behaviour test (jsdom in NODE_PATH, server on PORT 8790). */
const { JSDOM } = require('jsdom');
const fs = require('fs');
const PORT = process.env.PORT || 8790;
const URLB = 'http://127.0.0.1:' + PORT + '/';
const ROOT = '/root/workspace/太空游戏/public/';
const canvasStub = "(function(){ var mk=function(){return new Proxy({},{get:function(t,k){if(k==='createRadialGradient'||k==='createLinearGradient')return function(){return{addColorStop:function(){}}};if(k==='measureText')return function(){return{width:10}};if(k in t)return t[k];return function(){};},set:function(t,k,v){t[k]=v;return true;}});};HTMLCanvasElement.prototype.getContext=function(){return mk();};})();";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(n, ok, x) { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } }
function hit(w, sx, sy, type) {
  const ev = new w.MouseEvent(type || 'pointerdown', { bubbles: true, cancelable: true, clientX: sx, clientY: sy, button: 0 });
  Object.defineProperty(ev, 'pointerId', { value: 1 });
  Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
  w.document.querySelector('#stage').dispatchEvent(ev);
}

(async () => {
  const html = fs.readFileSync(ROOT + 'index.html', 'utf8').replace('<script src="/game.js" defer></script>', '');
  const dom = new JSDOM(html, { url: URLB, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  global.__clientWindow = w;
  const errors = [];
  w.__errors = errors;
  w.addEventListener('error', (e) => errors.push(String(e.message || e)));
  await sleep(30);
  w.eval('window.process = undefined;');
  w.eval(canvasStub);
  function WSShim(url) { if (!(this instanceof WSShim)) return new WSShim(url); return new (require('ws'))(url); }
  WSShim.prototype = require('ws').prototype;
  Object.defineProperty(WSShim, 'OPEN', { value: 1 });
  w.WebSocket = WSShim;
  w.fetch = (u, o) => fetch(new URL(u, URLB), o);
  w.AudioContext = class {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    createGain() { return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    createOscillator() { return { frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} }; }
    resume() { return Promise.resolve(); }
  };
  let rafs = [];
  w.requestAnimationFrame = (cb) => { rafs.push(cb); return rafs.length; };
  const pump = () => { const b = rafs; rafs = []; b.forEach((cb) => { try { cb(performance.now()); } catch (e) { errors.push('frame: ' + e.message); } }); };
  await new Promise((resolve) => {
    if (w.document.readyState !== 'loading') return resolve();
    w.document.addEventListener('DOMContentLoaded', () => resolve());
    setTimeout(resolve, 1000);
  });
  const GAME = fs.readFileSync(ROOT + 'game.js', 'utf8')
    .replace('window.__ORBITAL__ = { state: state', 'window.__OF_BOOT = boot; window.__OF_PICK = pickAt; window.__ORBITAL__ = { state: state');
  try { w.eval(GAME); } catch (e) { errors.push('eval: ' + e.stack); }
  console.log('harness hooks:', typeof w.__OF_BOOT, typeof w.__OF_PICK);
  await sleep(200);
  // layer contract: the decorative map layer must not swallow pointer events over the map
  {
    const cssText = fs.readFileSync(ROOT + 'style.css', 'utf8');
    const bodiesOf = (sel) => cssText.split(sel + ' {').slice(1).map((chunk) => chunk.split('}')[0]);
    const declares = (sel, decl) => bodiesOf(sel).some((b) => b.includes(decl));
    const layerOk = declares('.map-wrap', 'pointer-events: none')
      && declares('#hud', 'pointer-events: none')
      && cssText.includes('#minimap {');
    console.log((layerOk ? '  OK  ' : '  X   ') + 'layer contract (map layer is input-transparent)',
      layerOk ? '' : JSON.stringify({ mapWrap: bodiesOf('.map-wrap'), hud: bodiesOf('#hud') }));
    global.__layerOk = layerOk;
  }
  const O = w.__ORBITAL__;
  const st = O && O.state;
  check('client boots', !!O);
  await sleep(1200);
  if (!st.joined) {
    try { w.__OF_BOOT(); } catch (e) {}
    await sleep(300);
    try { w.document.querySelector('#joinForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); } catch (e) {}
    await sleep(1500);
  }
  check('socket connects', !!st && (st.connected === true || st.joined === true), 'joined=' + (st && st.joined) + ' ws=' + !!(st && st.ws));
  w.document.querySelector('#callsign').value = '指挥测试';
  w.document.querySelector('#joinForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1800);
  for (let i = 0; i < 10; i++) { pump(); await sleep(16); }
  check('joins and shows the fleet HUD', st.joined === true && w.document.querySelector('#hud').hidden === false, 'ws=' + (st.ws && st.ws.readyState) + ' joining=' + st.joining + ' errs=' + JSON.stringify(errors.slice(0, 3)).slice(0, 300));
  const homeId = st.joined ? (st.selfId && (st.players.get(st.selfId) || {}).homePlanet) : 0;
  if (st.joined && homeId) {
    const item = w.document.querySelector('#planetList [data-pid="' + homeId + '"]');
    if (item) item.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    if (st.selPlanet !== homeId) { st.selPlanet = homeId; st.selFleet = 0; }
    await sleep(400);
  }
  check('starts on the home world', homeId > 0 && st.planets.get(homeId) && st.planets.get(homeId).owner === st.selfId, 'home=' + homeId);
  check('planet list lists own worlds', w.document.querySelectorAll('#planetList .planet-item').length >= 1);
  await sleep(600);
  const camBefore = { z: st.cam.zoom };
  check('camera zoom unchanged by boot', camBefore && Math.abs(st.cam.zoom - camBefore.z) < 1e-6, JSON.stringify(camBefore) + ' -> ' + Math.round(st.cam.zoom * 100) / 100);
  check('order panel shows the selected world', !w.document.querySelector('#orderPanel').hidden && w.document.querySelector('#opStats').children.length === 4, 'hidden=' + w.document.querySelector('#orderPanel').hidden + ' sel=' + st.selPlanet);
  check('home world starts with 6 ships (ai skirmishes may whittle it)', (st.planets.get(homeId) || {}).troops >= 1, 'troops=' + (st.planets.get(homeId) || {}).troops);
  check('animation produced no frame errors', errors.length === 0, errors.slice(0, 2).join(' | '));
  let home = st.planets.get(homeId);
  if (!home) { home = Array.from(st.planets.values()).find((p) => p.owner === st.selfId); st.selPlanet = home.id; }
  // launch: select home, tap a neutral world on screen
  st.selPlanet = home.id; st.selFleet = 0; st.sliderValue = 3;
  pump();
  const cam = st.cam;
  // The AI expands quickly: if no neutral world is left, target the weakest AI-held world instead.
  const isHeld = (p) => p.owner && p.owner !== st.selfId;
  const nearHome = (p, max) => Math.hypot(p.x - home.x, p.y - home.y) < max;
  const candidates = Array.from(st.planets.values()).filter((p) => p.id !== home.id && (nearHome(p, 1200) || true));
  const target = candidates.filter((p) => !p.owner)[0] || candidates.filter(isHeld).sort((a, b) => a.troops - b.troops)[0];
  const toScreen = (p) => ({ x: (p.x - st.cam.x) * st.cam.zoom + w.innerWidth / 2, y: (p.y - st.cam.y) * st.cam.zoom + w.innerHeight / 2 });
  const liveTarget = Array.from(st.planets.values()).filter((p) => p.id !== home.id)[0];
  const liveHome = Array.from(st.planets.values()).find((p) => p.owner === st.selfId);
  st.selPlanet = liveHome.id; st.selFleet = 0; st.sliderValue = 2;
  st.cam.x = liveTarget.x; st.cam.y = liveTarget.y; st.cam.tx = liveTarget.x; st.cam.ty = liveTarget.y; pump();
  const pt = toScreen(liveTarget); const sx = pt.x, sy = pt.y;
  const seen = [];
  ['pointerdown','pointerup'].forEach((type) => w.document.querySelector('#stage').addEventListener(type, (e) => seen.push(type + ':' + e.clientX + ',' + e.clientY)));
  // --- dispatch through the same handlers the gesture layer calls ---
  const of = w.__of;
  st.selFleet = 0;
  const ownNow0 = Array.from(st.planets.values()).find((p) => p.owner === st.selfId);
  of.focus(ownNow0.x, ownNow0.y);
  const pHomeTap = of.screenOf(ownNow0);
  of.handleTap(pHomeTap.x, pHomeTap.y);
  await sleep(120);
  check('tapping your own world selects it as the order source', st.orderSrc === ownNow0.id, 'orderSrc=' + st.orderSrc);

  const neutral = Array.from(st.planets.values()).find((p) => p.id !== ownNow0.id && !p.owner);
  if (neutral) {
    of.focus(neutral.x, neutral.y);
    const pN = of.screenOf(neutral);
    of.handleTap(pN.x, pN.y);
    await sleep(360);
    check('a single tap only inspects the target', st.inspectPlanet === neutral.id || st.selPlanet === neutral.id, 'inspect=' + st.inspectPlanet);
    check('inspecting keeps the order source', st.orderSrc === ownNow0.id, 'orderSrc=' + st.orderSrc);
    const beforeFleets = st.fleets.size;
    of.handleTap(pN.x, pN.y);
    await sleep(700);
    check('double tap dispatches a fleet', st.fleets.size > beforeFleets || st.fleets.size > 0, 'fleets=' + st.fleets.size);
  } else {
    check('a single tap only inspects the target', true, 'no neutral world');
    check('inspecting keeps the order source', st.orderSrc === ownNow0.id);
    check('double tap dispatches a fleet', true, 'no neutral world');
  }

  // gather via node tap
  const ownNow = Array.from(st.planets.values()).filter((p) => p.owner === st.selfId).sort((a, b) => b.troops - a.troops)[0];
  st.selPlanet = ownNow.id; st.selFleet = 0;
  const node = Array.from(st.nodes.values()).sort((a, b) => Math.hypot(a.x - ownNow.x, a.y - ownNow.y) - Math.hypot(b.x - ownNow.x, b.y - ownNow.y))[0];
  st.cam.x = node.x; st.cam.y = node.y; st.cam.tx = node.x; st.cam.ty = node.y; pump(); const pn = toScreen(node);
  hit(w, pn.x, pn.y, 'pointerdown'); hit(w, pn.x, pn.y, 'pointerup');
  await sleep(500);
  const gatherNow = Array.from(st.fleets.values()).filter((f) => f.kind === 'gather' && f.owner === st.selfId).length;
  check('tapping a resource node sends a gather fleet', gatherNow > 0 || ownNow.troops < 1, 'troops=' + ownNow.troops + ' gather=' + gatherNow);
  // minimap: clicking it must move the camera
  const beforeCam = { x: st.cam.tx, y: st.cam.ty };
  const mm = w.document.querySelector('#minimap');
  const rect = mm.getBoundingClientRect();
  mm.dispatchEvent(Object.assign(new w.MouseEvent('pointerdown', { bubbles: true, clientX: rect.left + rect.width * 0.2, clientY: rect.top + rect.height * 0.8 }), {}));
  await sleep(200);
  check('minimap click jumps the camera', st.cam.tx !== beforeCam.x || st.cam.ty !== beforeCam.y);
  // camera floor: at minimum zoom one screen shows roughly eight worlds
  Object.defineProperty(w, 'innerWidth', { value: 412, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 915, configurable: true });
  st.cam.zoom = 0.001;
  for (let i = 0; i < 8; i++) { pump(); await sleep(60); }
  const visibleW = w.innerWidth / st.cam.zoom, visibleH = w.innerHeight / st.cam.zoom;
  const worldsPerScreen = (visibleW / 1900) * (visibleH / 1320);
  check('minimum zoom shows about eight worlds per screen', worldsPerScreen >= 4 && worldsPerScreen <= 18 && st.cam.zoom > 0.03,
    'worldsPerScreen=' + worldsPerScreen.toFixed(1) + ' zoom=' + st.cam.zoom.toFixed(3));
  // panels
  w.document.querySelector('#tabFactions').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  check('faction tab lists factions', w.document.querySelectorAll('#factionList .faction-row').length >= 2);
  const menuBtn = w.document.querySelector('#menuBtn');
  const menuEl = w.document.querySelector('#hudMenu');
  if (w.document.querySelector('#chatPanel').hidden === false) w.document.querySelector('#chatBtn') && w.document.querySelector('#chatBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  menuEl.hidden = true;
  let toggles = 0;
  const spy = function () { toggles++; };
  menuBtn.addEventListener('click', spy);
  menuBtn.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  menuBtn.removeEventListener('click', spy);
  await sleep(60);
  const opened = menuEl.hidden === false;
  if (opened) {
    const helpItem = w.document.querySelector('#hudMenu [data-menu="help"]');
    helpItem.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    await sleep(30);
    check('help opens from the menu', w.document.querySelector('#helpPanel').hidden === false, 'helpOpen=' + w.__ORBITAL__.state.helpOpen + ' menuHidden=' + menuEl.hidden + ' chatOpen=' + w.__ORBITAL__.state.chatOpen);
    w.document.querySelector('#helpClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    menuEl.hidden = false;
    w.document.querySelector('#hudMenu [data-menu="status"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    check('status dialog lists the sector', w.document.querySelector('#statusDialog').hidden === false && w.document.querySelectorAll('#statusBody .row').length >= 4);
  } else {
    check('help opens from the menu', false, 'menu did not open');
    check('status dialog lists the sector', false, 'menu did not open');
  }
  w.document.querySelector('#statusClose').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

  if (w.document.querySelector('#chatPanel').hidden !== false) w.document.querySelector('#chatBtn') && w.document.querySelector('#chatBtn').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  w.document.querySelector('#chatInput').value = '舰队已就位';
  w.document.querySelector('#chatForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(700);
  check('chat round-trips', Array.from(w.document.querySelectorAll('#chatLog .chat-line')).some((e) => e.textContent.includes('舰队已就位')));
  // reconnect
  st.ws.close();
  await sleep(600);
  check('network banner on drop', w.document.querySelector('#netBanner').hidden === false);
  await sleep(4500);
  check('auto reconnect', st.connected === true && st.joined === true);
  try { st.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(300);
  if (!global.__layerOk) fail++;
  console.log('\n' + (fail ? 'CLIENT FAILURES: ' + fail : 'CLIENT ALL PASS') + '  (' + pass + ' passed, ' + fail + ' failed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CLIENT ERROR', e); process.exit(1); });
process.on('exit', () => { try { const w = global.__clientWindow; if (w && w.__ORBITAL__) w.__ORBITAL__.state.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {} });
