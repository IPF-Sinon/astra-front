# 粒子更新修复（星环固定光团真凶）

**根因**：`public/game.js` 的 `render()` 中，`updateParticles(dt)` 在早前改动里被误删，导致全游戏粒子系统停止更新——粒子寿命不减、坐标不移动，交战/占领时在星环上生成的冰蓝色/阵营色火花被永久焊死在原地，形成固定光团背影。

**修复**：
1. `render()` 中补回 `updateParticles(dt);`（位于 `updateFleetShips(dt, now);` 之后、`drawBackdrop(t);` 之前）。粒子恢复外飞并在约 0.2s 内消散。
2. （可选微调）`drawOrbitShipBatch` 环绕飞船外圈光晕 `4.2→6.2 * s.scale`、白核 `1.45→1.20 * s.scale`，使正常环绕飞船阵营色更通透。

验证：`node --check` 通过；粒子冒烟测试通过（life 递减、位置外移、死亡被移除、冲击环被移除）。
