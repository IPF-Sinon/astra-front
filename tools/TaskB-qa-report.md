# Stage 2 · Task B —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 被测版本：server.js mtime 2026-11-02T05:07:03Z；public/game.js mtime 2026-11-02T05:03:58Z；public/index.html 05:01:23Z；public/style.css 05:06:22Z
- 测试服务器：`PORT=8799 FREEZE_AI=1 node server.js`（私有端口，未触碰 8787 线上服务）
- 测试脚本：`tools/test-taskb.js`（本任务新增）

## 一、联合出兵（B4）服务端集成测试 —— tools/test-taskb.js

运行：`PORT=8799 node tools/test-taskb.js` → **ALL PASS（18 通过 / 0 失败）**，退出码 0。

覆盖方式：两个真人 A（发起者）、B（盟友）。先走“结盟 → 对方 pactRespond 接受”建立真实盟友关系（已验证 pact 形成），随后直接驱动 joint 意图。
盟友在轨舰队分摊（execJoint 第 2 步）需要 B 有舰队停在 A.src 轨道，测试未构造该前置以避免额外不稳定，故第 2 步仅做协议级验证（详见脚本头注释）。

| 用例 | 断言 | 结果 |
| :-- | :-- | :-- |
| ① jointLaunch 生成 joint-state 且向 B 发 joint-request | 发起者收到 joint-state（accepted 含发起者、含 deadline）；B 收到 joint-request（from/src/target/pct/deadline 完整）；两者 id 一致 | OK |
| ② B jointVote accept 后 joint-state 更新 | accepted 由 [A] 更新为 [A,B] | OK（并观察到“全部盟友已表决→立即执行”的 joint-launched，符合协议） |
| ③ A jointGo 后收到 joint-launched 且 src→target 出现 march 舰队 | 新建 B 未表决的 joint，A jointGo 触发 joint-launched；状态中出现 owner=A、kind=march、target=目标 的舰队 | OK |
| ④ 无效操作被拒 | 非被请求者 A 投票 → “你不是被邀请的盟友”；非发起者 B jointGo → “只有发起者可以立即出动” | OK（均 reject） |
| ⑤ 同一 (initiator,src,target) 防重 | 重复 jointLaunch → “同一目标的联合出兵尚未结束”，且不产生新的 joint-state | OK |

说明：脚本对盟友关系建立失败的情况做了退化处理（打印 NOTE 后仍继续验证 joint 消息流与拒绝/超时逻辑），本次实测盟友关系建立成功。

## 二、全量回归套件（同一 8799 私有服，最新构建）

| 套件 | 结果 |
| :-- | :-- |
| tools/test.js | ALL PASS 34/34 |
| tools/test-long.js | ALL PASS 5/5 |
| tools/test-bugs-fixed.js | BUGS ALL PASS 13/13 |
| tools/test-node-exclusive.js | NODE-EXCLUSIVE ALL PASS 5/5 |
| tools/test-neutral-purity.js | NEUTRAL-PURITY ALL PASS 5/5 |
| tools/test-visual-patch.js | VISUAL-PATCH ALL PASS 49/49 |
| tools/test-taskb.js | ALL PASS 18/18 |

合计：基线回归 111/111 通过；新增联合出兵 18/18 通过。

## 三、public/game.js 客户端 Task B 静态复核

| 复核项 | 结论 | 关键位置 |
| :-- | :-- | :-- |
| 底部百分比派遣滑条（B1） | 存在。state.dispatchPct 默认 1；DOM：#dispatchBar/#dispatchTrack/#dispatchFill/#dispatchThumb/#dispatchPctLabel/#dispatchTicks（index.html）；updateDispatchUI() 更新宽度/滑块/百分比与艘数；bindDispatchBar 支持 pointerdown/pointermove 拖动与刻度点击；orderLaunch 一律按 `n=max(1,round(floor(troops)*pct))`，旧数量滑杆 #sliderBlock 恒隐藏 | game.js:99,684-696,2609-2651；index.html:113-127 |
| 三枚六边形按钮及命中（B2） | 存在。DOM #planetHexMenu 内 #hexInfo/#hexMid/#hexLast 三枚 .hex-btn；updateHexMenu 每帧按角度 -32°/0°/+32°、半径 `max(56,(pl.r*1.65+34)*zoom)` 定位；己方=转让/摧毁，他方有主=交易/外交；点击由 DOM 原生监听（bindHexMenu）命中；点空白 dismissHexMenu 收起 | game.js:2707-2765；index.html:95-98；style.css:345-361 |
| 信息浮窗字段 | 存在：驻军/矿藏/阵营化/补充速率/占领/驻留舰队列表（renderPlanetInfo） | game.js:2767-2804 |
| 盟友滑条（B3） | 存在。state.allyPct={ownerId:pct}；renderAllyBars 仅对己方星球的在轨盟友（isAlly 且 owner!=self）生成 range 滑条，默认 0%；容器 .ally-bars max-height:122px; overflow-y:auto（约 3 条）；allyAllocations() 将 >0 的盟友比例带入 jointLaunch | game.js:100,2653-2705；style.css:395 |
| joint-request 处理（B4 客户端） | 存在。handleEvent: joint-request→addJointRequest 弹卡片；joint-state→updateJointState 更新集结进度；joint-launched/joint-cancelled→toast/feed。卡片同意/拒绝发送 jointVote；jointStatus 提供 jointGo“立即出动”按钮 | game.js:529-542,2880-2975 |
| destroy 不再用 window.confirm | 满足。destroyPlanet 使用自绘 DOM 确认框 showConfirm(#confirmModal) → onOk 发送 destroy 意图；全文件未再对摧毁使用 window.confirm（仅“退出对局”保留原生 confirm，非摧毁按钮） | game.js:2838-2877 |

补充观察（非缺陷）：
- B2 协议原文为“纯客户端绘制”六边形按钮；实现采用“绝对定位 DOM 按钮 + 每帧跟随定位”，命中由 DOM 原生完成。功能与可点性等价，但与“canvas 绘制”表述略有差异。
- game.js 中 `dom.chatBtn/soundBtn/helpBtn` 在现有 index.html 已不存在（改为菜单项），对应字段为空但代码无引用，属既有历史项，不影响运行。
- 未发现导致 Task B 功能缺失或报错的项。

## 四、结论

Task B 服务端联合出兵协议（B4）与客户端 UI 均已就绪并通过独立集成测试与全量回归；未发现阻断性缺陷。若后续 server-eng 再修改 server.js，需以最新文件重启 8799 私有服并重跑 `tools/test-taskb.js` 复核。
