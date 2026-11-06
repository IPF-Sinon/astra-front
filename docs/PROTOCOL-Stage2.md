# Stage 2 · 团队协作协议（PROTOCOL-Stage2.md）

基线：当前工作目录工程（server.js / public/game.js 等，已通过 Stage 1）。
所有新增网络消息必须严格遵循本协议，服务端与客户端各自实现，**不得更改既有消息语义**。

## 通用约定
- 客户端发意图：`sendIntent({ t:'<type>', ... })`；服务端在 `handleIntent` 的 switch 中新增 case。
- 服务端广播事件：`this.broadcast({ t:'ev', k:'<kind>', ... })`；客户端 `handleEvent(msg)` 中按 `msg.k` 处理。
- 服务器新增运行时状态存放在 Game 实例（如 `this.joints`）。
- 所有金额/比例字段为数字；星球 id、玩家 id 为 number。
- 审计日志：新增操作写 `this.logEvent(...)`。

---

# Task B 协议（本轮）

## B1. 底部百分比派遣滑条（纯客户端）
- 有选中己方星球时显示；向上拖动选择 0%~100%（默认 100%）。
- 出征时 `n = Math.max(1, Math.round(availableShips * pct))`，`availableShips = Math.floor(pl.troops)`。
- 与旧 `state.sliderValue` 并存：滑条为百分比后，旧的数量滑杆可隐藏或保留，但 `orderLaunch` 一律按百分比计算。

## B2. 星球右侧三枚六边形按钮（纯客户端绘制）
- 选中任意星球时，在星球右侧沿圆环绘制 3 枚六边形按钮，角度 `-32°/0°/+32°`，半径 `pl.r*1.65+34`（屏幕空间尺寸用 `/state.cam.zoom` 补偿，保证手机可点）。
- 按钮 ①「信息」→ 展开右侧紧凑信息浮窗（驻军/矿藏/阵营化/补充速率/驻留舰队列表）。
- 按钮 ②：己方=「转让」；他方有主=「交易」。
- 按钮 ③：己方=「摧毁」（弹**自绘 DOM 确认框**，不得用 window.confirm）；他方有主=「外交」。
- 点击空白失焦时收起按钮与浮窗。
- 点击「信息/交易/转让/外交/摧毁」按钮通过 `sendIntent` 或打开对应前端浮窗；本轮交易/转让/外交的服务端意图见 Task C（可先接 UI + 给出 alert/toast 占位，但结构要预留）。

## B3. 同盟驻军滑条扩展（纯客户端）
- 选中己方星球时，若 `pl.orbitBy` 中存在 k 个**盟友**（isAlly 为真且 owner!==selfId）在轨舰队，则在底部主滑条上方追加 k 条盟友颜色滑条，默认 0%，容器最大高度=3 条，超出 `overflow-y:auto`。
- 滑块值存入 `state.allyPct = { <ownerId>: pct }`。

## B4. 18 秒联合出兵（客户端 + 服务端）
### 发起（C→S）
```
{ t:'jointLaunch', src:<planetId>, target:<planetId>, pct:<0..1>, allies:[ {owner:<playerId>, pct:<0..1>}, ... ] }
```
- 若 `allies` 为空 → 等价普通 `launch`（n=round(src.troops*pct)）。
- 若 `allies` 非空 → 服务端创建集结事件：
```
this.joints.set(id, { id, initiator, src, target, pct, allocations, accepted:Set([initiator]),
  declined:Set(), deadline: Date.now()+18000, done:false });
```
并向每个被请求盟友广播：
```
{ t:'ev', k:'joint-request', id, from:<initiatorId>, fromName, src, srcName, target, targetName, pct, deadline }
```
同时向发起者回 `{ t:'ev', k:'joint-state', id, accepted:[initiator], deadline }`。
### 盟友表决（C→S）
```
{ t:'jointVote', id:<jointId>, accept:<bool> }
```
- 校验：只有被请求盟友可表决；更新 accepted/declined；广播 `joint-state`（accepted 数组）。
- 全部被请求盟友已表决 → 立即执行。
### 发起者立即出动（C→S）
```
{ t:'jointGo', id:<jointId> }
```
- 仅发起者可调用；立即执行。
### 执行（服务端）
`execJoint(j)`：
1. 主发起方：从 `src` 按 `round(src.troops * pct)` 生成 `kind:'march'` 舰队飞向 target（判定/冷却与普通 launch 相同；无兵则跳过）。
2. 每个 accepted 盟友：取 `src` 上 `f.orbiting===src && f.owner===owner && f.n>=1` 的在轨舰队，按 `pct` 比例 `n=round(f.n*pct)` 抽出，改为 `kind:'march'`, `orbiting=0`, 目标 target（不足 1 艘跳过）。
3. 广播 `{ t:'ev', k:'joint-launched', id, src, target, from:[owners...] }`，并从 `this.joints` 删除。
4. 20s 超时（在 tick/simulate 中检查 deadline）→ 视为未表决者拒绝，仍执行已同意的（含发起者）。
### 失败/拒绝
- 目标星球在等待期失效/被摧毁 → 事件作废并广播 `joint-cancelled`。
- `src` 不再是发起者星球 → 作废。

## 新增前端事件处理（handleEvent）
- `joint-request`：弹出可关闭的联合出兵请求卡片（同意/拒绝 → 发 `jointVote`），可收进右侧邮件球（本轮先弹 toast+面板即可）。
- `joint-state`：更新发起方的集结进度显示。
- `joint-launched` / `joint-cancelled`：toast 提示。

## 边界
- 所有比例 `pct` 钳制 `[0,1]`；`pct<=0` 视为无效跳过。
- 防重：同一 `(initiator, src, target)` 已有未结束 joint 时拒绝新建。
- 资源/冷却沿用现有 launch 校验逻辑。

---

# Task C / Task D 协议（后续轮，占位，勿在本轮实现）
- Task C：`intentTrade` / `intentTransfer` / `intentTradeRespond`；七态外交 `intentDiplo`({action}) + `intentVote`；`chat` 带 `channel:'global'|'ally'` + `#截获`；邮件球收纳 trade/transfer/diplo/joint。
- Task D：固定资源消耗（launch/gather=1，结盟类=2，离间=5）、枯竭扣能、双通道聊天与 `#截获`（联盟普通消息 ≥4 字 10%、标记 20%）。
具体字段在对应轮次的规范中细化。

---

# Task C 协议（本轮：拖拽派遣 / 邮件球 / 交易转让 / 七态外交）

## 服务端状态与常量（server.js）
- Game：this.trades = new Map()；this.nextTrade = 1；this.votes = new Map()；this.nextVote = 1（构造函数与 resetSeats 初始化/清理）。
- 常量：TRADE_FEE=2；TRADE_TAX=0.10；TRADE_PENALTY=0.20；REQUEST_TTL=90000；ALLY_COST=2；INCITE_COST=5；MARK_COST=0。
- 所有请求 90s 超时：在 simulate/tick 中清理过期 trades/votes 并广播 trade-result/vote-state 结束。

## C→S 意图
### trade（买他方星球）
{ t:'trade', planet:<id>, offerResource:<n> }
- 校验：planet 存在、owner>0 且 != 我；owner 不是仅剩 1 颗（否则拒绝）；planet.destroyTimer>0 拒绝；offerResource>=0 且我有足够 (2+offerResource)。
- 预扣发起方：2 + offerResource。创建 trades: {id,kind:'trade',from,to:planet.owner,planet,offerResource,expireAt:now+90000}。
- 向 to 广播 ev k='trade-request' {id,kind:'trade',from,fromName,planet,planetName,offerResource,expireAt}。ack。

### transfer（转让己方星球）
{ t:'transfer', planet:<id>, to:<playerId>, withTroops:<bool>, wantResource:<n> }
- 校验：planet.owner===我；我不是仅剩 1 颗（否则拒绝）；destroyTimer>0 拒绝；to 存在且 != 我。扣 2 资源。
- 创建 trades {id,kind:'transfer',from:me,to,planet,withTroops:!!withTroops,wantResource:max(0,n|0),expireAt}。向 to 广播 trade-request(kind:'transfer')。

### tradeRespond
{ t:'tradeRespond', id:<id>, accept:<bool> }
- 仅 trades.get(id).to 可回应。
- accept=false：退款发起方 offerResource（手续费不退），广播 trade-result{ok:false,reason:'declined'}。
- accept=true，kind trade：星球 owner 改为 to、color=to 的颜色、purityProg=1、captureProg=0；卖方(原 owner)在该星在轨舰队改 returning 飞回其最近己方星球（无则删除）；卖方收到 floor(offerResource*(1-0.10)) 资源；广播 trade-result{ok:true}。
- accept=true，kind transfer：planet.owner=to、color；若 withTroops=false 则原驻军(troops)转为返航舰队给发起方（飞其最近己方星），troops=0；否则驻军随星球；若 wantResource>0 且接收方资源足够则扣接收方并加发起方。广播 trade-result{ok:true}。
- 等待期内若星球被第三方夺走（owner 变化）→ 作废：扣 initiator 20% 违约金，退还 80% offerResource，广播 trade-result{ok:false,reason:'planet-lost'}。

### diplo（七态外交）
{ t:'diplo', action:'ally'|'join'|'invite'|'incite'|'expel'|'break'|'mark', targetPlayer:<id>, targetPlanet:<id> }
- 消耗：ally/join/invite/expel=2；incite=5；mark=0；break=0。资源不足 reject。
- ally：复用现有 requestPact（结盟请求）。
- join（我无盟，对方有盟）：创建 votes{kind:'join',coalition:target.coalition,from:me,targetPlayer:target}，向该 coalition 成员广播 vote-request；pass→ 我加入该 coalition。
- invite（我有盟，对方无盟）：创建 votes{kind:'invite',coalition:我的,from:me,targetPlayer:target}，向我的 coalition 成员广播 vote-request；pass→ 向 target 发 diplo-request{kind:'invite'} 等其同意（同意 = 用 {t:'diploRespond',id,accept}）。
- incite（双方不同盟）：votes{kind:'incite',coalition:我的,...}；pass→ 向 target 发 diplo-request{kind:'incite'}；target 同意→target 脱离原盟加入我的盟。
- expel（我的盟>=3人）：votes{kind:'expel',coalition:我的,targetPlayer}；>=50% pass→ target 移出联盟。
- break（2人盟直接解除）：立即解散该 coalition（成员 coalition=0），互驻飞船改 returning 回各自最近己方星；广播。
- mark：向我的 coalition 频道广播 ev k='chat' {channel:'ally', sys:true, text:'【标记】'+planetName+' @ (x,y)', planet:<id>}；不扣费。
- 投票：votes {id,kind,coalition,from,targetPlayer,targetPlanet,yes:Set([from]),members:Set(当前联盟成员),expireAt}。发起人自动 1 票。

### vote
{ t:'vote', id:<id>, accept:<bool> }
- 仅 members 可投。更新 yes。当 yes.size/members.size >= 0.5 立即执行对应动作；全部投完或超时也结算（未投视为弃权，仍按 >=50% 判定）。广播 vote-state 与 diplo-result。

### diploRespond
{ t:'diploRespond', id:<id>, accept:<bool> }
- 仅被邀请的 target 可回应 invite/incite 的最终步。

## S→C 事件（handleEvent 新增）
- k='trade-request'：邮件球收件（kind trade/transfer）。
- k='trade-result'：toast + 邮件球状态更新。
- k='vote-request'：邮件球收件，含同意/拒绝按钮 → 发 vote。
- k='vote-state'：更新投票进行中项。
- k='diplo-result'：toast。
- k='diplo-request'：被邀请最终确认卡（invite/incite）→ 发 diploRespond。
- 邮件球聚合 trade-request/vote-request/diplo-request/joint-request，90s 倒计时，可拖动，未读角标。

## 客户端 Task C
- C1 拖拽连线派遣：pointerdown 命中己方有兵星球 → state.dragOrder={srcId,x,y}；移动时画源→指针的斜向刻度脉冲激光线；命中目标星球/资源点高亮外环；指针距屏边 <48px 时按 420/z px/s 平滑滚屏；pointerup：命中星球→若盟友滑条>0 发 jointLaunch 否则 launch(pct)，命中资源点→gather，空白→取消。不得破坏原有拖拽平移/缩放手势（仅当起手为己方有兵星球时走 dragOrder）。
- C2 邮件悬浮球：右侧可拖动徽章球，未读角标；面板列出 trade/vote/diplo/joint 请求（倒序、90s 倒计时）；提供同意/拒绝按钮发对应响应；bus 实时刷新。
- C3 交易/转让 UI：六边形按钮②：己方→转让对话框（选接收者、是否带驻军、回赠资源），他方→交易对话框（报价资源）；提交发 trade/transfer。
- C4 七态外交 UI：六边形按钮③他方→外交面板按联盟状态呈现 结盟/加入/邀请/离间/驱逐/断交/标记，发送 diplo；收到 vote-request/diplo-request 弹卡表决。

---

# Task D 协议（本轮：固定资源消耗 / 枯竭扣能 / 双通道聊天 + #截获）

## 常量（server.js）
- START_RESOURCE 由 120 改为 30。
- ACTION_COST = 1（每次派遣舰队：攻击/调动/采集）。
- EXHAUST_UPKEEP_PER_SHIP = 1.0（枯竭星每秒扣全局资源 1.0 * troops * dt）。
- EXHAUST_STARVE_RATE = 0.5（全局资源见底时枯竭星驻军每秒流失 0.5 艘）。
- 复用既有 ALLY_COST=2 / INCITE_COST=5 / TRADE_FEE=2（外交与交易发起消耗）。

## 资源消耗
- intentLaunch 与 intentGather：进入时若 p.resource < ACTION_COST 则 reject('资源不足'); 否则 p.resource -= ACTION_COST。所有出征（含转让/调动的 launch）统一经 intentLaunch，天然覆盖。jointLaunch 执行 execJoint 时，对每个实际出兵的 owner 扣 1（不足则该 owner 跳过）。
- 结盟/加入/邀请/驱逐 消耗 2、离间 5、交易/转让发起 2（Task C 已实现，沿用）。

## 枯竭惩罚（tick 内，替换现有 0.06/0.05）
- 对 owner>0 且 pl.exhausted 的星球：
  - upkeep = pl.troops * EXHAUST_UPKEEP_PER_SHIP * dt；
  - owner.resource >= upkeep → owner.resource -= upkeep；
  - 否则 owner.resource = 0 且 pl.troops = max(0, pl.troops - EXHAUST_STARVE_RATE * dt)。
- 无驻军且无主（owner=0）的枯竭星沿用既有 20s collapseTimer → collapsePlanet。

## 双通道聊天 + #截获
C→S: { t:'chat', text:<str>, channel:'global'|'ally' }
- 冷却 2000ms/连接（ws.lastChatAt）。text 去控制字符、截断 90 字。
- channel='global'：广播 {t:'ev',k:'chat',channel:'global',id,name,text} 给所有玩家。
- channel='ally'：若 p.coalition 为 0 → 不广播（或私人提示）；否则只广播给同 coalition 成员 {...,channel:'ally',id,name,text}。
- 截获：ally 普通消息（文字长度 >= 4 个字符）有 10% 概率；外交「标记」消息（intentDiplo action='mark'）有 20% 概率。触发时：从场上存活真人（!bot、conn 在线）中随机选 1 名**不在本 coalition**者，单独发送 {t:'ev',k:'chat',channel:'ally',intercept:true,text:'[#截获] '+原文}（不含发送者 id/name）。
- 提供 helper：broadcastChatToCoalition(chat, coalitionId)、maybeIntercept(text, senderP, isMark)。

## 客户端 Task D
- 底部左中侧半透明可折叠聊天栏；频道切换「全局 / 联盟」按钮；发送时带 channel。
- 发言冷却 2.0s（本地禁用发送按钮/提示）。
- 收到 intercept 消息用醒目琥珀色 [#截获] 样式、隐藏发送者；普通消息按 channel 显示（选中联盟频道只显示联盟消息，全局显示全局）。
- 资源不足时 toast 提示（服务端 reject 已有 reason）。

## S→C 事件
- k='chat' 增加字段：channel、intercept(bool)。既有 sys 消息继续保留。
