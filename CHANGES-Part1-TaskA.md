# 星海边境 · 本轮改动说明（Part 1 视觉修复 + Task A）

基线包：星海边境-ORBITAL-FRONTIER-20261101-0435.zip
改动范围：仅 Part 1 的 4 个视觉 Bug + Task A 规则补丁（Task B/C/D 未做）。

## Part 1 · 视觉修复（public/game.js）
- **Bug 1**：`collectOrbitShips3D` 的 `shipObj.scale` 补乘 `vs`（`(0.88+0.24*depth)*vs`）；`getVisScale` 统一为 `clamp(pow(0.45/z,0.65),0.90,2.80)`。15% 缩放下约 2.04× 补偿。
- **Bug 2**：`render()` 在 `updateFleetPositions(now)` 后新增 `updateFleetShips(dt, now)`；`ensureFleetShips/updateFleetShips/drawFleets` 换为“每船从源星 3D 椭圆环脱轨 + 独立追赶 + 流光彗尾 + 统一 *vs”的实现。
- **Bug 3**：删除 `drawPlanet` 旧版逐阵营多层圆弧块；`ringR` 统一为 `pl.r*1.48+10`，`duelR = ringR`（交战/读条共用同一半径，不再多套圆圈）。
- **Bug 4**：`getPlanetBodyCanvas` 换为偏心大气辉光 + 暗核 + 高密度岩石颗粒 + 内壁菲涅尔 + 左上月牙形霓虹边弧；删除死代码 `getPlanetTexture/planetTexCache`；`drawPlanet` 对己方星球补 2~3 颗**动态呼吸微光点**。

## Task A · 规则
- **A1（客户端）**：`public/game.js displayColor` 去掉联盟 `coalition.color` 分支，恒返回 `p.color`（盟友仅靠 ` [盟友]` 标签区分）。服务端 `displayColorOf` 本已合规，未改。
- **A2（服务端 server.js）**：
  - `NODE_CHARGE_TIME` 本已为 3.0，未改。
  - 节点工厂新增内部字段 `readingFleetId: null`（不广播）。
  - `intentGather` 增加**同阵营防重**：已有己方 gather 舰队前往同一节点则 reject。
  - `simulateFleets` 采集分支改为**排他读条**：先到者占用 `readingFleetId` 并累加读条；后到者被判失败并遣返；读条者满 3s 结算并清空占用；含失效读条者清理。
  - `intentRetarget` 改道时清除其点位读条占用。

## 测试（新增 2 套）
- `tools/test-visual-patch.js`：24 项静态守卫（代码结构断言，无需浏览器/服务器）。
- `tools/test-node-exclusive.js`：5 项资源点排他/防重行为断言。

## 回归结果（改动后，fresh server）
- test.js 34/34 · test-long.js 5/5 · test-bugs-fixed.js 13/13 · test-node-exclusive.js 5/5 · test-visual-patch.js 24/24
- 额外：以 canvas stub 在 zoom=0.15 下**实际执行**新渲染流水线（公转船/舰队/星球材质）无运行时错误。

## 备注
- 本环境无 jsdom，`tools/client-test.js` 未运行；改用静态守卫 + 渲染冒烟替代。
- 计划文档中“NODE_CHARGE_TIME=2.5→3.0”“服务端 displayColorOf 仍染联盟色”已过时，本包本就满足，未重复修改。
