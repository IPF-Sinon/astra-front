'use strict';
/* Static guard for all applied patches (Part-1, Task-A, ring/particle/neutral fixes, Stage-1 七项机制).
 * Pure file assertions (no server, no browser). Run: node tools/test-visual-patch.js */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const game = fs.readFileSync(path.join(root, 'public/game.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok, x) => { if (ok) { pass++; console.log('  OK  ' + n + (x ? '  ' + x : '')); } else { fail++; console.log('  X   ' + n + (x ? '  ' + x : '')); } };
function fnBody(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) return src.slice(i, j + 1); }
  }
  return '';
}

console.log('[ORBIT SHIPS] 屏幕逆缩放 + 飞船放大');
const collectFn = fnBody(game, 'function collectOrbitShips3D(');
check('collectOrbitShips3D present', !!collectFn);
check('shipObj.scale × vsOrbit', /\* vsOrbit/.test(collectFn));
check('orbit sprite tailLen 18.5', /var tailLen = 18\.5 \* s\.scale;/.test(game));
check('orbit sprite glow 7.4', /var glowR = 7\.4 \* s\.scale;/.test(game));
check('getOrbitVisScale retuned', /clamp\(Math\.pow\(0\.48 \/ z, 0\.55\), 1\.35, 2\.40\)/.test(game));
check('getVisScale retuned', /clamp\(Math\.pow\(0\.50 \/ z, 0\.58\), 1\.45, 2\.60\)/.test(game));

console.log('[FLEET RENDER] 逐船编队 + 入轨/粒子修复 + 首船加速');
const renderFn = fnBody(game, 'function render()');
check('render: updateFleetPositions→updateFleetShips', /updateFleetPositions\(now\);\s*\n\s*updateFleetShips\(dt, now\);/.test(renderFn));
check('render: updateParticles(dt) restored', /updateFleetShips\(dt, now\);\s*\n\s*updateParticles\(dt\);/.test(renderFn));
const drawFn = fnBody(game, 'function drawFleets(t)');
check('drawFleets iterates state.fleetShips', /state\.fleetShips\.forEach/.test(drawFn));
check('drawFleets tailLen (28 + 14k)', /var tailLen = \(28 \+ 14 \* clamp/.test(drawFn));
check('old rigid swarm removed', !/effectiveLag/.test(game) && !/swarmLength/.test(game));
check('orbit delta (early arrival) present', /function getOrbitDeltaCount\(/.test(game) && !/function getPendingArrivalCount\(/.test(game));
check('docked fleet done-guard', /if \(arr\.done\) return arr;/.test(game));
const ufs = fnBody(game, 'function updateFleetShips(dt, now)');
check('touch-ring marks arrived', /s\.arrived = true;/.test(ufs) && /ships\.done = true;/.test(game));
// Stage5.3 §4.2：updateFleetShips 重写为「服务端插值坐标锚定编队 + 权威航程进度 + 2.4x 入轨」
check('fleet swarm anchored to server f.dx/f.dy', /f\.dx != null \? f\.dx : f\.x/.test(ufs) && /f\.dy != null \? f\.dy : f\.y/.test(ufs));
check('flight prog from along/flightSpan', /var along = \(fx - startX\) \* ux/.test(ufs) && /clamp\(along \/ flightSpan, 0, 1\)/.test(ufs));
check('arriveR matches server (r*1.28+4 / outpost r*1.15+4)', /tgtPl\.r \* 1\.28/.test(ufs) && /tgtPl\.r \* 1\.15/.test(ufs));
check('docking 2.4x shipSpeed entry', /\* 2\.4/.test(ufs));

console.log('[PLANET] 多方占比环 + 60fps 插值');
const dp = fnBody(game, 'function drawPlanet(pl, t)');
check('proportional multi-faction ring present', /segments\.length >= 2/.test(dp) && /pl\._ringShares/.test(dp));
check('neutral garrison becomes a segment', /var defKey = pl\.owner \|\| 0;/.test(dp));
check('60fps capture/purity interpolation', /pl\._visCap \+= \(targetCap - pl\._visCap\)/.test(dp) && /pl\._visPur \+= \(targetPur - pl\._visPur\)/.test(dp));
check('purify ring gated to owned world', /var purifying = \(pl\.owner !== 0 && pl\._visPur < 0\.995/.test(dp));
check('getPlanetTexture dead code removed', !/getPlanetTexture/.test(game) && !/planetTexCache/.test(game));
check('crescent rim gradient present', /createLinearGradient\(-r, -r, r \* 0\.85, r \* 0\.85\)/.test(fnBody(game, 'function getPlanetBodyCanvas(pl)')));

console.log('[UI] 资源点 + 面板');
check('drawNodes scaled by inverse zoom', /var R = 24 \* ns;/.test(fnBody(game, 'function drawNodes(t)')));
check('node label strokeText +N', /strokeText\('\+' \+ Math\.round\(n\.amount\)/.test(game));
check('node pick radius 44', /var bestNode = null, bnD = 44 \/ z;/.test(game));
check('neutral panel shows purity 0', /pl\.owner \? Math\.round\(\(pl\.purityProg == null \? 1 : pl\.purityProg\) \* 100\) : 0/.test(game));

console.log('[TASK-A] 同盟不染色 + 资源点排他');
check('client displayColor ignores coalition', !/coalitions/.test(fnBody(game, 'function displayColor(id)')));
check('node factory readingFleetId', /radius: 32, readingFleetId: null/.test(server));
check('intentGather same-faction dedupe', /已有己方飞船/.test(server));
check('simulateFleets reads readingFleetId', /node\.readingFleetId === f\.id/.test(server));
check('latecomer bounce branch', /a different fleet is already reading/.test(server));

console.log('[STAGE-1 SERVER] 唯一配色 / 4位进度 / 入轨门控 / 5±1战损 / 贡献度账本');
check('10-colour palette', /const COLORS = \['#38bdf8', '#fb7185', '#facc15', '#a855f7', '#4ade80', '#fb923c', '#2dd4bf', '#e879f9', '#818cf8', '#f43f5e'\]/.test(server));
check('pickUniqueColor defined & used', /pickUniqueColor\(\) \{/.test(server) && /color: this\.pickUniqueColor\(\)/.test(server));
check('viewPlanet captureProg 4 decimals', /Math\.round\(\(pl\.captureProg \|\| 0\) \* 10000\) \/ 10000/.test(server));
check('viewFleets exports fullyDocked', /fullyDocked: !!f\.fullyDocked/.test(server));
check('arrive sets dockAt + fullyDocked false', /f\.dockAt = Date\.now\(\) \+ dockMs;/.test(server) && /f\.fullyDocked = false;/.test(server));
check('resolveCombat dock gate', /if \(f\.dockAt && now < f\.dockAt\) continue;/.test(server) && /k: 'fleet-orbit-ready'/.test(server));
check('captureSpeed formula', /captureSpeed\(shipsCount\) \{/.test(server) && /0\.35 \+ 0\.0217 \* n/.test(server));
check('purifyCost 20/30/45', /pl\.size === 'M' \? 30 : 45/.test(server));
check('90s contribution ledger', /pl\.contribLog\.push\(/.test(server) && /pickCapturingOwner\(pl, blocFleets, now\) \{/.test(server));
check('5±1 bounded attrition via tradeBias', /damageBloc\(bloc, amount\) \{/.test(server) && /pl\.tradeBias/.test(server));

console.log('[STAGE-1 CLIENT] 事件总线 + 缓存继承');
check('event bus defined & emitted', /var bus = \{/.test(game) && /bus\.emit\('state:change'/.test(game));
check('applyData keeps _visCap/_visPur cache', /p\._visCap = \(oldP && oldP\._visCap != null\)/.test(game) && /p\._visPur = \(oldP && oldP\._visPur != null\)/.test(game));
check('250ms renderAll polling removed', !/renderAll\(\)[\s\S]{0,80}\}, 250\);/.test(game));

console.log('[NEUTRAL] 无怪胎 100% 中立星');
check('protoPlanet purity 0', /purityProg: 0, captureBy: 0, captureProg: 0, orbitBy: \{\}, orbitTotal: 0/.test(server));
check('removePlayer neutralises cleanly', /pl\.owner = 0; pl\.troops = 0; pl\.purityProg = 0; pl\.captureProg = 0; pl\.captureBy = 0;/.test(server));
check('resolveCombat pins neutral purity 0', /中立星保持 purity=0[\s\S]{0,120}pl\.purityProg = 0;/.test(server) || /if \(pl\.owner === 0\) \{\s*pl\.purityProg = 0;/.test(server));
check('owned world recovers allegiance', /pl\.purityProg \+ dt \* 0\.5 \/ this\.purifyCost\(pl\)/.test(server));
check('assignStartPlanet purity 1', /target\.purityProg = 1;/.test(server));
check('aiThink captured purity 1', /pick\.purityProg = 1;/.test(server));

console.log('\n' + (fail ? 'VISUAL-PATCH FAILURES: ' + fail : 'VISUAL-PATCH ALL PASS') + '  (' + pass + ' passed)');
process.exit(fail ? 1 : 0);
