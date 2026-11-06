# 本轮修复：怪胎中立星 + 资源点过小 + 飞船相对星球过小

## 一、服务端 server.js（3 组）
- **S1**：`protoPlanet` 新建中立星球 `purityProg: 1 → 0`（无主星球不再显示“阵营化 100%”）；资源点基础半径 `16 → 32`。
- **S2**：中立化路径全部清空残留——`resetSeats` / `startAsNewPlayer` / `removePlayer` 三处均补 `troops = 0`、`purityProg = 0`、`captureProg = 0`、`captureBy = 0`（消灭“无主却带兵”的怪胎）；`assignStartPlanet` 补 `target.purityProg = 1`。
- **S3**：`resolveCombat` 无敌军分支重写——无主星球恒 `purityProg = 0`；**已有主**星球在被净化后若无敌军则按 `dt*3/purifyCost` 恢复阵营化（修复“有主星球阵营化永久卡在 <100%”）；`aiThink` 接管无主星时补 `pick.purityProg = 1`。

## 二、客户端 public/game.js（5 组）
- **C1**：底部面板中立星球固定显示「阵营化 0%」。
- **C2**：整体放大约 1.8 倍——`drawOrbitShipBatch` 尾迹 `11.5→18.5`、半宽 `1.35→2.35`、光晕 `6.2→7.4`、白核 `1.20→2.05`；`getOrbitVisScale` → `clamp(pow(0.48/z,0.55),1.35,2.40)`；`getVisScale` → `clamp(pow(0.50/z,0.58),1.45,2.60)`。
- **C3**：交战环判定 `pl.owner && pl.troops > 0.01` → `pl.troops > 0.01`（**带驻军的中立星球现在也会画交战/占领进度环**）；净化环改为仅 `pl.owner !== 0` 时显示。
- **C4**：飞行舰队单船放大——尾迹 `(19+9·k)→(28+14·k)`、头宽 `1.65→2.6`、光晕 `4.4→7.8`、亮芯 `0.82→1.25`、核 `1.35→2.15`。
- **C5**：`drawNodes` 全面重做——菱形半径 `R = 24 * getVisScale()`、辉光 `(56+pulse*18)*ns`、金色晶簇配色、数值改为描边 `+N` 大字号；`pickAt` 资源点判定半径 `28/z → 44/z`。

> 同时确认上轮的 `updateParticles(dt);` 仍在 `render()` 中（星环固定光团真凶修复未被回退）。

## 三、验证
- `node --check server.js` / `public/game.js`：通过
- 回归：test.js 34/34 · test-long.js 5/5 · test-bugs-fixed.js 13/13 · test-node-exclusive.js 5/5 · test-capture.js 通过 · test-orbarcapture.js PASS · test-neutral-purity.js 5/5（新增） · test-visual-patch.js 37/37（已同步更新）
- 客户端渲染冒烟：`drawOrbitShipBatch / drawPlanet / drawNodes / drawFleets` 在 zoom=0.24 下无运行时错误，`vs=1.53`、`vsOrbit=1.46`
- `test-dispatch.js` 与 `client-test.js` 依赖 jsdom 及写死的旧绝对路径 `/root/workspace/太空游戏/public/`，本环境不可运行（**改动前即如此，非本次回归**）
