'use strict';
/* verifies double-tap dispatch keeps working after inspecting a foreign world, and the long-press diplomacy dialog */
const { JSDOM } = require('/tmp/node_modules/jsdom');
const fs = require('fs');
const PORT = process.env.PORT || 8798;
const ROOT = '/root/workspace/太空游戏/public/';
const stub = "(function(){var mk=function(){return new Proxy({},{get:function(t,k){if(k==='createRadialGradient'||k==='createLinearGradient')return function(){return{addColorStop:function(){}}};if(k==='measureText')return function(){return{width:40}};if(k in t)return t[k];return function(){};},set:function(t,k,v){t[k]=v;return true;}});};HTMLCanvasElement.prototype.getContext=function(){return mk();};})();";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } };
(async () => {
  const html = fs.readFileSync(ROOT + 'index.html', 'utf8').replace('<script src="/game.js" defer></script>', '');
  const dom = new JSDOM(html, { url: 'http://127.0.0.1:' + PORT + '/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: 412, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 915, configurable: true });
  await sleep(30);
  w.eval('window.process = undefined;'); w.eval(stub);
  function WS(u) { if (!(this instanceof WS)) return new WS(u); return new (require('ws'))(u); }
  WS.prototype = require('ws').prototype;
  w.WebSocket = WS;
  w.fetch = (u, o) => fetch(new URL(u, 'http://127.0.0.1:' + PORT + '/'), o);
  w.eval(fs.readFileSync(ROOT + 'game.js', 'utf8'));
  await sleep(250);
  w.document.querySelector('#callsign').value = '双击测试';
  w.document.querySelector('#joinForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1800);
  const st = w.__ORBITAL__.state;
  st.cam.zoom = 0.2;
  const home = Array.from(st.planets.values()).find((p) => p.owner === st.selfId);
  const foreign = Array.from(st.planets.values()).find((p) => p.id !== home.id && !p.owner);
  const toScreen = (p) => ({ x: (p.x - st.cam.x) * st.cam.zoom + 412 / 2, y: (p.y - st.cam.y) * st.cam.zoom + 915 / 2 });
  const tap = (x, y) => {
    const d = new w.MouseEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(d, 'pointerId', { value: 1 }); Object.defineProperty(d, 'pointerType', { value: 'touch' });
    w.document.querySelector('#stage').dispatchEvent(d);
    const u = new w.MouseEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
    Object.defineProperty(u, 'pointerId', { value: 1 }); Object.defineProperty(u, 'pointerType', { value: 'touch' });
    w.document.querySelector('#stage').dispatchEvent(u);
  };
  // select our own world first
  st.cam.x = home.x; st.cam.y = home.y; st.cam.tx = home.x; st.cam.ty = home.y;
  let pt = toScreen(home); tap(pt.x, pt.y);
  await sleep(200);
  check('own world selected as order source', st.orderSrc === home.id, 'orderSrc=' + st.orderSrc);
  // inspect a foreign world with a single tap (must NOT clear the source)
  st.cam.x = foreign.x; st.cam.y = foreign.y; st.cam.tx = foreign.x; st.cam.ty = foreign.y;
  let pf = toScreen(foreign); tap(pf.x, pf.y);
  await sleep(250);
  check('inspecting keeps the order source', st.orderSrc === home.id, 'orderSrc=' + st.orderSrc);
  // now double tap that same foreign world -> launch
  const before = st.fleets.size;
  const of = w.__of;
  const p1 = of.screenOf(foreign);
  of.handleTap(p1.x, p1.y); await sleep(120);
  of.handleTap(p1.x, p1.y);
  await sleep(900);
  check('double tap dispatches after inspecting', st.fleets.size > before, 'fleets ' + before + '->' + st.fleets.size);
  // long press on a foreign world opens the diplomacy dialog
  const enemyPl = Array.from(st.planets.values()).find((p) => p.owner && p.owner !== st.selfId && p.id !== foreign.id);
  if (enemyPl) {
    st.cam.x = enemyPl.x; st.cam.y = enemyPl.y; st.cam.tx = enemyPl.x; st.cam.ty = enemyPl.y;
    st.selFleet = 0;   // otherwise the camera follows the launched fleet
    w.__of.focus(enemyPl.x, enemyPl.y);
    const pe = w.__of.screenOf(enemyPl);
    const pickCheck = w.__of.pickAt(pe.x, pe.y);
    check('long press coordinate lands on the enemy world', pickCheck && pickCheck.id === enemyPl.id, JSON.stringify(pickCheck) + ' want ' + enemyPl.id);
    st.pointer.down = true; st.pointer.x = pe.x; st.pointer.y = pe.y;
    w.__of.longPress(pe.x, pe.y);
    await sleep(700);
    const panel = w.document.querySelector('#orderPanel');
    const dip = w.document.querySelector('[data-dip]');
    check('long press opens diplomacy confirm', !panel.hidden && !!dip, 'kicker=' + w.document.querySelector('#opKicker').textContent);
    st.pointer.down = false;
  } else { check('long press opens diplomacy confirm', false, 'no enemy world'); }
  try { st.ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {}
  await sleep(300);
  console.log('\n' + (fail ? 'DIPLOMACY/DISPATCH FAILURES: ' + fail : 'DISPATCH ALL PASS') + '  (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERR', e); process.exit(1); });
