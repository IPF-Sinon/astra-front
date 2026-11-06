# Stage 1 · 本轮新增 7 项核心机制与视觉精修

基线：`...Part1-Fixed-NeutralSizeFix-20261102-0900.zip`
本轮按《最新总规划与严格执行规范》第一部分（10 个精确替换块）零误差落地。

## 服务端 server.js
- **S-New-1 唯一配色**：`COLORS` 换成 10 种高区分度霓虹色；新增 `pickUniqueColor()` 实时扫描已占用色，`addAIPlayer`/`addHuman` 改用之，杜绝 AI 裁剪/进出后撞色。
- **S-New-2 进度精度 + 入轨导出**：`viewPlanet.captureProg` 精度提升到 4 位小数（`*10000/10000`）；`viewFleets` 导出 `fullyDocked`。
- **S-New-3 战斗重构**：
  - 全员入轨门控：`arrive()` 设 `f.dockAt = now + min(800, 260+√n·65)`、`fullyDocked=false`；到点广播 `fleet-orbit-ready` 才开战/合并。
  - 同盟战斗集群（Allied Bloc）：盟友合并为一个整体，绝不互打；`blocs.length>=2` 即开战（含无主星多方争夺）。
  - **5±1 有界成对战损**：`tradeBias` 严格钳制 `[-1,+1]`，每 5 轮归零；任一方每损 5 艘，敌方必损 4~6 艘。
  - 占领节奏：`purifyCost` S/驻点=20、M=30、L=45；`captureSpeed(n)=min(1.65, 0.35+0.0217n)`（30 船占 M 星恰好 30s，净化为 40% 即 12s）。
  - **90s 阵营化贡献度账本** `pl.contribLog`：按同盟各成员在轨兵力占比记功并清理 >90s 记录；占领满时取 90s 内贡献最高盟友为球主，其余盟友舰队原样留在轨道协防。

## 客户端 public/game.js
- **C-New-1 事件总线 `bus`**：新增 `bus.on/emit`；`applyData` 保留 `_visCap/_visPur/_ringShares` 平滑缓存并派发 `state:change/planet:change/diplomacy:change`；`handleEvent` 对 `planet-captured/planet-purified/fleet-orbit-ready/pact-*` 精准刷新；删除 `boot()` 里 250ms 无脑轮询。
- **C-New-2 多方占比环 + 60fps 插值**：`drawPlanet` 统计驻军+在轨各方兵力，`segments.length>=2` 时按真实兵力占比分段绘制彩色圆弧（0.045rad 呼吸间隙 + 占比平滑），各段外侧标注实时兵力；`_visCap/_visPur` 指数阻尼逼近，读条丝滑。
- **C-New-3 首船加速入轨**：`updateFleetShips` 中首船触环记 `ships.firstArrivedAt`，后续飞船获 `entryBoost=1.65+clamp(elapsed*2.5,0,1.35)`（最高 3.0×）冲刺汇入。

## 验证
- `node --check server.js` / `public/game.js`：通过
- 回归：test.js 34/34 · test-long.js 5/5 · test-bugs-fixed.js 13/13 · test-node-exclusive.js 5/5 · test-neutral-purity.js 5/5 · test-capture.js 通过 · test-orbarcapture.js PASS（37.4s，符合新 30 船读条设定）
- 客户端渲染冒烟：占比环 `_ringShares`、`_visCap` 插值、首船加速路径均无运行时错误
- 静态守卫 test-visual-patch.js：**49/49 通过**（已同步 Stage-1 实现）

## 说明
- 新战损/读条节奏使 `test-capture.js` 的单次占领变慢（按设计），其“进度条确实存在且非瞬时”判定仍为 PASS。
- 剩余：Stage 2（Task B/C/D 交互与玩法）与 Stage 3（portal/多房间/插件热加载）为后续阶段，需按对应详细规范继续。
