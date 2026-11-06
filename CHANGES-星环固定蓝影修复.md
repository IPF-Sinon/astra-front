# 星环固定蓝影修复（3 处，public/game.js）

针对截图现象（源星球 `23/49` 与交战星球 `9/36` 星环上偏大的固定蓝色光点背影；未发兵的 `24/24` 正常），修复两个叠加逻辑漏洞：

1. **前排飞船提前撞线被钉死**：新增 `getOrbitDeltaCount`（提前抵达前排 +1、已入轨但仍在半路队尾 -1），`collectOrbitShips3D` 改用它并把提前抵达阵营并入 `shares`，前排一碰星环即无缝转为星环光点。
2. **入轨舰队被删后原地重生幽灵船**：`ensureFleetShips` 首帧 `orbiting` 即标记 `done` 且不生成飞船，`else` 分支 `if (arr.done) return arr;`。
3. **触碰星环即入轨 + 不提前删队**：`updateFleetShips` 中飞船飞抵切入点即 `s.arrived=true`（不再依赖 `ships.docking`）；全员入轨后 `ships.done=true`，仅当服务端移除舰队时才从 Map 删除。

验证：`node --check` 通过；运行时冒烟 7/7 通过（提前抵达入轨、入轨不提前删、舰队在时不重生、首帧入轨零幽灵、移除后清理）。
