# Stage 2 · Task C：拖拽派遣 + 邮件球 + 交易/转让 + 七态外交

团队并行：server-eng(server.js) / client-eng(public三件套) / qa-eng(tools)；Lead 独立复验、整合、打包。

## 客户端（C1–C4）
- C1 拖拽连线派遣：仅起手命中己方有兵星球进入 dragOrder 并抑制平移；斜向刻度脉冲激光线 + 目标脉冲环；距屏边 <48px 以 420/zoom px/s 滚屏；松手：星球→launch(pct)/jointLaunch，资源点→gather，空白→取消。不破坏原平移/缩放/单击/双击。
- C2 邮件悬浮球：右侧可拖动徽章球 + 未读角标；聚合 trade-request/vote-request/diplo-request/joint-request（倒序、90s 倒计时、同意/拒绝分派）。
- C3 交易/转让：六边形②己方→转让对话框（接收者/带驻军/回赠资源）；他方→交易对话框（报价资源）。
- C4 七态外交：六边形③他方→按联盟状态呈现 结盟/加入/邀请/离间/驱逐/断交/标记。

## 服务端
- trades/votes 状态 + 90s 过期；intentTrade/intentTransfer/intentTradeRespond；intentDiplo(七态)/intentVote/intentDiploRespond；simulateTrades/simulateVotes。
- 交易：预扣 2+offer、成交税 10%、拒绝/过期退 offer 不退手续费、等待期星球被夺 20% 违约金退 80%。转让：带/不带驻军 + 回赠资源。
- 外交：join/invite/incite/expel 走联盟 >=50% 投票（发起人自动 1 票）；break 2 人盟立即解散；mark 广播联盟频道；结盟复用 requestPact（预扣 2，不重复收 40）。

## QA 暴露并修复的 2 个真实缺陷
1) trade 所有权判定用 rec.from（买家）而非 rec.to（卖家）→ 交易立即 planet-lost；已改用 expectedOwner 修复。
2) diplo 投票 targetPlayer 传对象而非 id → invite/incite 不发 diplo-request、expel 不移出；已在 newVote 归一化修复。

## 验证（Lead 在最终文件独立复跑）
- node --check server.js / public/game.js 通过
- tools/test-taskc.js 39/39；test-taskb 18/18；test.js 34/34；test-long 5/5；test-bugs-fixed 13/13；test-node-exclusive 5/5；test-neutral-purity 5/5；test-visual-patch 49/49 —— 合计 168/168
- 客户端静态复核：dragOrder/激光/滚屏/邮件球/交易转让/七态外交/6 类事件均接入；destroy 仍自绘确认框

## 风险/未决
1) 无浏览器，未做像素级视觉验收（激光线/邮件球拖动/对话框建议 GUI 复验）。
2) 邮件项本地仅按 expireAt 倒计时置灰，真正失效以服务端事件为准。
3) break 解除 2 人盟沿用现有 breakPact 舰队回撤逻辑（未额外设置 returning），测试全绿。

## 下一步
Stage 2 Task D（固定行动资源消耗 + 枯竭扣能 + 双通道聊天 #截获），随后 Stage 3。目标保持 active。
