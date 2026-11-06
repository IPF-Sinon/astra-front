# Stage 2 · Task B：六边形按钮 + 百分比滑条 + 盟友滑条 + 18s 联合出兵

本轮由智能体团队并行完成（server-eng / client-eng / qa-eng），Lead 独立复验整合。

## 团队分工
- server-eng（server.js）：18s 联合出兵协议、pct 派遣。
- client-eng（public/game.js,index.html,style.css）：三枚六边形按钮、底部百分比滑条、盟友滑条、联合出兵 UI、自绘确认框。
- qa-eng（tools/）：新建 tools/test-taskb.js（联合出兵集成测试）+ 全量回归 + 客户端静态复核，输出 tools/TaskB-qa-report.md。

## 功能
- B1 百分比派遣滑条：底部常驻 #dispatchBar，0/25/50/75/100 刻度、菱形滑块、默认 100%，state.dispatchPct；出征 n=max(1,round(floor(troops)*pct))；旧数量滑杆隐藏、旧双击出征保留。
- B2 三枚六边形按钮：选中星球右侧 -32/0/+32 度、半径 max(56,(r*1.65+34)*zoom) 的 DOM 六边形按钮；①信息浮窗 ②己方=转让/他方=交易 ③己方=摧毁（自绘 #confirmModal，禁用 window.confirm）/他方=外交；点空白收起。（交易/转让/七态外交为 Task C 占位）
- B3 盟友滑条：选中己方星，按 orbitBy 中盟友追加对应色滑条，默认 0%，容器限高 3 条滚动，state.allyPct。
- B4 18s 联合出兵：盟友滑条>0 → jointLaunch{src,target,pct,allies}；服务端建 joint（18s deadline、accepted 表决、jointGo 立即出动、超时执行已同意者、防重、joint-cancelled）；客户端处理 joint-request/state/launched/cancelled。

## 新增/改动消息协议（见 docs/PROTOCOL-Stage2.md）
C→S: jointLaunch / jointVote / jointGo；intentLaunch 支持 pct。
S→C(ev): joint-request / joint-state / joint-launched / joint-cancelled。

## 验证
- node --check server.js / public/game.js：通过
- 全量回归：test.js 34/34 · test-long 5/5 · test-bugs-fixed 13/13 · test-node-exclusive 5/5 · test-neutral-purity 5/5 · test-visual-patch 49/49（基线 111/111）
- 联合出兵 tools/test-taskb.js：18/18（真实结盟盟友；jointLaunch/jointVote/jointGo、非被邀者投票拒绝、非发起者 jointGo 拒绝、防重、超时、from 数组）
- 客户端静态复核：%滑条/六边形/盟友滑条/joint 事件/自绘确认框齐备；destroy 不再用 window.confirm

## 风险/未决
1) allies 未强制 areAllied，安全边界为“盟友投票同意才动其舰队”；如需强制结盟可收紧。
2) 交易/转让/七态外交仍是 Task C 占位。
3) 六边形按钮为 DOM 定位（功能等价于 canvas 绘制）。
4) 无浏览器，未做像素级视觉验收，建议 GUI 会话确认六边形定位与移动端底部滑条层级。

## 下一步
Stage 2 Task C（拖拽连线派遣 + 邮件球 + 交易/转让 + 七态外交）与 Task D（固定资源消耗 + 枯竭扣能 + 双通道聊天 #截获）。目标保持 active，继续推进。
