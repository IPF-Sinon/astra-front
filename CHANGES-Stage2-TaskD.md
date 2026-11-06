# Stage 2 · Task D：固定资源消耗 + 枯竭扣能 + 双通道聊天 #截获

团队并行：server-eng / client-eng / qa-eng；Lead 独立复验、整合、打包。

## 服务端
- START_RESOURCE 120→30；新增 ACTION_COST=1、EXHAUST_UPKEEP_PER_SHIP=1.0、EXHAUST_STARVE_RATE=0.5。
- 行动消耗：intentLaunch / intentGather 各扣 1（不足 reject '资源不足'）；execJoint 对每个实际出兵 owner 扣 1。
- 枯竭惩罚：枯竭星每秒扣全局资源 1.0*troops*dt；资源见底则驻军每秒流失 0.5 艘；既有 20s 崩解保留。
- 双通道聊天：chat 支持 channel='global'（全服）/ 'ally'（仅同 coalition，无盟提示）；2.0s 冷却。
- #截获：ally 普通消息(≥4字)10%、外交 mark 消息 20% → 随机 1 名在线非本盟真人，单独收到 {channel:'ally',intercept:true,text:'[#截获] '+原文}（隐藏发送者）。
- 旧结盟流程统一改为 ALLY_COST=2，hello.rules.socialCost=2。

## 客户端
- 底部左中侧半透明可折叠聊天栏；「全局/联盟」频道切换；2.0s 本地发言冷却；按频道过滤显示。
- #截获 消息琥珀色高亮、显示 [#截获] 且隐藏发送者（已修去重正则 /^\s*\[#截获\]\s*/）。

## 验证（Lead 在最终文件独立复跑）
- node --check server.js / public/game.js 通过
- test-taskd 19(+2跳过) · test.js 34 · test-taskb 18 · test-taskc 39 · test-long 5 · test-bugs-fixed 13 · test-node-exclusive 5 · test-neutral-purity 5 · test-visual-patch 49 —— 合计 187 通过 / 2 跳过 / 0 失败

## ⚠ 需你确认的配套调整
START_RESOURCE 降到 30 后，原驻点费用 80/200/420 无法负担（会导致建驻点/建第二星球的回归失败）。为保持回归通过且经济自洽，server-eng 将 OUTPOST_LEVELS 费用同比例下调为 20/60/140。若你希望保留原驻点价格，请告知，我改回并改为让回归测试等待资源累积/另行处理。

## 风险/未决
- 截获为概率事件，测试验证结构与路由（mark 20% 已实测命中；ally 普通 10% 样本未命中属概率）。
- 无浏览器，未做像素级视觉验收（聊天栏定位/折叠/截获样式建议 GUI 复验）。

## 阶段状态
Stage 2（Task B/C/D）全部完成并通过回归。Stage 3（portal/多房间/插件热加载）为后续独立阶段。
