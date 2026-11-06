# Stage 2 · Task C —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 被测版本：server.js mtime 2026-11-02T05:40:18Z；public/game.js 05:39:20Z；index.html / style.css 见客户端最终版
- 测试服务器：`PORT=8797 FREEZE_AI=1 node server.js`（私有端口，未触碰线上服务）
- 测试脚本：`tools/test-taskc.js`（本任务新增）

## 一、联合测试总览

| 套件 | 结果 |
| :-- | :-- |
| tools/test-taskc.js（本任务新增） | **ALL PASS 39/39（0 跳过 / 0 失败）** |
| tools/test.js | ALL PASS 34/34 |
| tools/test-long.js | ALL PASS 5/5 |
| tools/test-bugs-fixed.js | BUGS ALL PASS 13/13 |
| tools/test-node-exclusive.js | NODE-EXCLUSIVE ALL PASS 5/5 |
| tools/test-neutral-purity.js | NEUTRAL-PURITY ALL PASS 5/5 |
| tools/test-taskb.js | ALL PASS 18/18 |
| tools/test-visual-patch.js | VISUAL-PATCH ALL PASS 49/49 |

合计 168/168 通过（基线 129 + Task C 39）。

## 二、Task C 服务端集成测试明细（tools/test-taskc.js）

两个真人以上（A~E），先走 “建驻点构造第二颗星球 → transfer/trade → 结盟 → 投票” 的完整链路。关键断言：

- **trade 预扣**：买家发起 offer=10 → 资源 123→111（约 -12 = 2 手续费+10 报价）。**OK**
- **trade 拒绝退款**：卖家拒绝 → trade-result ok=false/reason=declined；买家净损约 2（手续费不退，退款 offer）。**OK**
- **trade 成交 + 成交税**：星球所有权转买家；卖家入账 floor(10*0.9)=9（税 1）。**OK**
- **transfer 带驻军**：星球归接收方且原驻军保留（13→13）。**OK**
- **transfer 不带驻军**：星球归接收方、原驻军清零，并为发起方生成 returning 返航舰队。**OK**
- **diplo mark**：向联盟频道广播 `chat{channel:'ally', text:'【标记】…'}`。**OK**
- **diplo break**：2 人联盟立即解散（pact 清空、双方 coalition=0）。**OK**
- **invite ≥50% 通过**：A 邀请无盟 E，A 自动 1 票/2 人=50% → 向 E 发 diplo-request；E diploRespond 接受 → E 加入联盟。**OK**
- **expel ≥50% 通过**：3 人联盟中 A 发起（1/3<50%）→ 生成 vote-request；非成员 D 投票被拒；B 投赞成（2/3）→ E 被移出。**OK**
- **join ≥50% 通过**：无盟 E 发起加入，A 投票触发通过 → E 加入。**OK**
- **incite ≥50% 通过**：A 盟 vs C-D 盟不同盟 → A 离间 C；本盟投票通过后 C 收 diplo-request；C 同意 → 脱离原盟加入 A 盟。**OK**
- **diploRespond 非法 id 被拒**。**OK**
- **90s 过期结算**：trade 请求到期后服务端清理并广播 trade-result（实测 reason=expired）；星球仍归原主。**OK**
- **非法调用被拒**：trade 自己星球 / trade 仅剩一颗星球的卖家 / transfer 非自己星球 / tradeRespond 非接收方，均 reject。**OK**

## 三、测试中发现并由 server-eng 修复的服务端缺陷（关键）

本轮迭代中 tools/test-taskc.js 首先暴露了两个真实缺陷；server-eng 修复后复跑全部通过：

1. **trade 所有权判断字段用错（已修复 05:37）**：`simulateTrades` 与 `intentTradeRespond` 原用 `pl.owner !== rec.from`（trade 的 rec.from 是买家，星球属于卖家 rec.to），导致任何交易即时被判 `planet-lost`：买家被扣 80% 违约金、卖家拿不到星球/资源、卖方回应报“交易请求不存在或已结束”。修复为 `expectedOwner = kind==='trade' ? rec.to : rec.from` 后，预扣/退款/成交/税全部 OK。
2. **diplo 投票 targetPlayer 传对象而非 id（已修复 05:40）**：`intentDiplo` 把玩家对象传入 `newVote(...,target,...)`，而 `applyVote/broadcastVoteRequest` 用 `players.get(rec.targetPlayer)` 取值得到 undefined，导致 invite/incite 不向目标发 diplo-request、expel 不真正移出成员（join 因不读该字段而侥幸可用）。server-eng 在 newVote 内归一化 targetPlayer/targetPlanet 后，invite/expel/incite 全部 OK。

> 两次都是测试正确暴露服务端实现缺陷，修复后已复跑确认，未改动 server.js。

## 四、public/game.js 客户端 Task C 静态复核

| 复核项 | 结论 | 关键位置 |
| :-- | :-- | :-- |
| C1 拖拽连线派遣 | 存在。state.dragOrder；仅当起手星球为己方有兵（驻军≥1 或己方在轨≥1，hasOwnShips）才进入拖拽；drawDragOrder 画源→指针激光线 + 斜向刻度脉冲（step 18 时间相位）+ 命中目标脉冲外环；applyDragEdgeScroll 距屏边<48px 以 420/zoom px/s 平滑滚屏；finishDragOrder 命中星球→orderLaunch（盟友滑条>0→jointLaunch，否则 launch(pct)），命中资源点→gather，空白→取消；未破坏原平移/缩放手势（仅 dragOrder.active 时接管） | game.js:3034-3114, 3057-3065, 2421-2462 |
| C2 邮件悬浮球 | 存在。可拖动徽章球（pointerdown/move/up 保存 mailPos）；未读角标 updateMailBadge；统一收件箱 addMailItem/renderMail 聚合 trade/transfer/vote/diplo/joint，按时间倒序、90s 倒计时、同意/拒绝按钮；mailRespond 分派 tradeRespond/vote/diploRespond/jointVote；bus 实时刷新 | game.js:3116-3224 |
| C3 交易/转让 UI | 存在。六边形②：己方→openTransferDialog（接收方下拉、附带驻军勾选、回赠资源），他方有主→openTradeDialog（报价资源）；submitDeal 发 sendIntent trade/transfer | game.js:3261-3316, 2790-2800 |
| C4 七态外交 UI | 存在。openDiploPanel 依双方联盟状态呈现 ally/join/invite/incite/expel/break/mark；sendDiplo 发 sendIntent {t:'diplo',action,targetPlayer,targetPlanet}；onVoteRequest→开邮件卡表决、onDiploRequest→开外交确认卡 | game.js:3318-3366, 3243-3259 |
| 服务端事件处理 | trade-request/trade-result/vote-request/vote-state/diplo-result/diplo-request 六个 k 均有 handleEvent 分支并接入邮件球 | game.js:538-543 |
| 数组/DOM 完整性 | game.js 引用的全部元素均存在于 index.html（Task C 新增 mailOrb/mailBadge/mailPanel/mailList/dealModal/diploModal 等 0 缺失）。destroy 仍为自绘 DOM 确认框，未用 window.confirm（仅“退出对局”保留原生 confirm） | — |

补充观察（非缺陷）：dom.chatBtn/soundBtn/helpBtn 为既有历史空引用（已改为菜单项），无引用、无影响。

## 五、结论

Task C 服务端（交易/转让/七态外交投票/过期结算/非法校验）与客户端（拖拽派遣+边缘滚屏、邮件球、交易转让 UI、七态外交 UI）均实现并通过独立集成测试与全量回归（168/168）。测试过程发现的 2 个服务端缺陷已修复并复验通过。若 server.js 在 05:40:18 之后再有改动，需以最新文件重启 8797 私有服复跑 tools/test-taskc.js 与 tools/test-taskb.js。
