# Stage 3 团队协作协议（Task E / F / G）

基线：Stage2 收尾补丁 P1–P5 之后的工程（server.js 约 2420 行）。
**硬约束：原有全部测试（test.js / test-long / test-bugs-fixed / test-node-exclusive / test-neutral-purity / test-taskb / test-taskc / test-taskd / test-visual-patch）必须 100% 继续通过。** 为此保留无票直连回退：未配置 `REQUIRE_TICKET=1` 时，`{t:'join',name,token}` 仍进默认普通房。

## 写作用域（严格互斥，禁止越界）
- **server-eng → `server.js`**（Task E 全量；Task F 的服务端集成；Task G 的服务端插件加载器）
- **portal-eng → `portal.js`、`data/`**（Task F 门户端，新增文件）
- **client-eng → `public/game.js`、`public/index.html`、`public/style.css`**（Task E 客户端房间/大厅 UI；Task G 的 ModSandbox）
- **qa-eng → `tools/`**（新增 `tools/test-stage3.js` + 全量回归 + 静态复核）

---

# Task E 协议（RoomManager 与三模式）

## 房间模型
```js
class RoomManager {
  rooms = new Map();            // roomId -> Game
  createRoom(opts) -> Game      // opts: {roomId?, mode, name, maxPlayers, hostId}
  get(roomId) -> Game|undefined
  defaultNormalRoom() -> Game   // 复用/新建一个可加入的普通房（DEV_STANDALONE 用）
  list() -> [{roomId, mode, name, status, humans, bots, maxPlayers, remainingMs, canJoin, hostId, mods}]
  tick()                        // 每 2s：普通房自动维持 >=2 间可加入；淘汰房候场超时回收
}
```
`Game` 新增字段：`roomId, mode('normal'|'elim'|'endless'), name, maxPlayers(2..8), hostId, status('waiting'|'running'|'settled'), createdAt, startedAt, durationMs, lobbyExpireAt, noJoin, settled`
- normal：`durationMs = 40*60*1000`，`status='running'`，`startedAt=Date.now()`
- elim：`durationMs = 25*60*1000`，候场 `status='waiting'` 且 `lobbyExpireAt=now+10*60*1000`，`startedAt=0`（`roomStart` 后置 running/startedAt）

## 综合权重 W_score
`calcScore(p) = 10*Vtotal + 2*Nships + Math.round(p.resource)`
- Vtotal：玩家所有星球体积当量之和，S=1.0、O(驻点)=0.8、M=1.8、L=3.0
- Nships：所有星球驻军 + 所有在轨/在途舰队飞船数
- `viewPlayers()` 每项增加 `score: this.calcScore(p)`

## 普通模式
- 最后 5 分钟（remainingMs<=300000）：`noJoin=true`；重连的老玩家仍可进。
- 最后 3 分钟（remainingMs<=180000）：`state` 广播附带 `countdownSec`（整数秒）与 `leaderboard`（按 score 降序 [{id,name,score,planets,ships,resource,online}]）。
- 结算：`remainingMs<=0` 或「曾有真人但当前真人在线数为 0 且仅剩 AI」→ `settleRoom(reason)`，广播 `{t:'ev', k:'room-settled', mode, reason, rankings:[...]}`，置 `status='settled'`。
- 真人在线数 0 → 冻结 `step()`（Tick 挂起）；>0 时维持在场阵营数 >=3；`humans>4` 时被淘汰 AI 不再重生。
- 离线保留：`onDisconnect` 普通房不清空星球、不 AI 接管；`p.online=false`（前端已按 `opP.online===false` 显示 `[掉线]`）。
- AI 集火加权 ×2.0：`aiThink` 评估目标时若目标 owner 为「非 bot 且无 conn」→ 其评分 `score *= 0.5`。

## 淘汰模式
- 候场：物理暂停；`{t:'roomAddAI'}`、`{t:'roomRemoveAI'}`、`{t:'roomStart'}`（需在场 >=2；仅房主可调用）。
- 房主离线/离开 → 顺延给最早加入的在线真人；全员离开或 10 分钟未开局 → 销毁房间。
- running：`noJoin=true`；禁止中途退出（`leave` 仍断开但保留席位，不重开）；**拦截 ally/join/invite/incite**，reject('淘汰模式为个人死斗，禁止结盟')；`checkEliminations` 中置 `permanentlyOut=true` 不重生。
- 结算：存活阵营仅剩 1 / 所有真人已淘汰 / 满 25 分钟 → `settleRoom()`。

## 无尽模式
- `RoomManager` 预留 `mode='endless'` 分支；`list()` 中返回一条灰置入口 `{mode:'endless', locked:true}`。

## 多房间下的协议（保持旧消息兼容）
C→S 新增：`roomAddAI` / `roomRemoveAI` / `roomStart` / `roomList` / `roomCreate`（可选）/ `spectate`
- `{t:'join', name, token?, ticket?, roomId?}`：有 ticket → 验签取 roomId/uid/role；无 ticket 且未开 REQUIRE_TICKET → 默认普通房（旧行为）。
S→C：
- `hello` 增加 `roomId, mode, name, status, maxPlayers, hostId, mods: [...]`
- `state` 增加 `roomId, mode, status, noJoin, remainingMs, countdownSec?, leaderboard?, spectating`
- `ev k='room-settled'`、`ev k='room-list'`（响应 roomList）

---

# Task F 协议（portal.js）

- 端口 `8686`（环境变量 `PORTAL_PORT`）；支持 `require('./portal.js')` 返回 `{ start(port), server, app }` 且**不自动监听**（测试可直接 require 后手动 start）。
- 持久化 `data/portal-db.json`（内存 + 原子写）。
- REST（JSON）：
  - `POST /api/register {username,password}` → `{ok, uid, recoveryCode:'XXXX-XXXX-XXXX', role}`（字符集 `23456789ABCDEFGHJKLMNPQRSTUVWXYZ`，scryptSync 存密码，sha256 存恢复码；首个账号或 username==='admin' → admin）
  - `POST /api/login {username,password}` → `{ok, sessionToken, uid, role, activeRoom}`；同账号二次登录覆盖 token（互踢）
  - `POST /api/reset-password {username,recoveryCode,newPassword}` → 校验通过就换密码并**轮换新恢复码**返回；同 IP 60s 内 >5 次 → `429`
  - `POST /internal/heartbeat`（头 `x-node-sig: HMAC(body, NODE_SECRET)`）→ `{ok, versionOk}`；`node.version !== PORTAL_VERSION` → 不收该节点
  - `GET /api/rooms`（Bearer）→ 版本匹配且未排空节点的房间 + 无尽灰置入口
  - `POST /api/rooms/create`（Bearer）→ 建淘汰房
  - `POST /api/rooms/join`（Bearer）→ 签发票据 `base64url(JSON payload)+'.'+hmac`，payload `{uid,name,role,roomId,mode,exp}`，`exp=now+60s`
  - 管理员（role==='admin'）：`/api/admin/kick|ban|delete-user|reset-password|config`
- 节点上报 `{nodeId,url,wsUrl,version,draining,rooms,lastSeen}`；`draining` 节点不进 `/api/rooms`。
- 常量：`PORTAL_VERSION='2.0.0'`、`NODE_SECRET=(env NODE_SECRET||'orbital-frontier-dev-secret')`。

# Task G 协议

- 服务端启动扫描 `plugins/*/manifest.json`，`config.enabled===true` 才加载；`/api/status` 与 `hello` 导出 `mods:[{id,name,version,tags}]`（hello 额外带 `config, sharedCode, clientCode`）。
- 目录：`plugins/nebula-overdrive/{manifest.json,config.json,shared.js,client.js}`。
- 客户端 `ModSandbox`：`api.onRenderPlanet(fn)`、`api.onRenderHud(fn)`、`api.onEvent(fn)`、`api.addStyle(cssText)`；`load(mods)` / `unloadAll()`；`drawPlanet` 末尾调 `ModSandbox.runPlanetHooks(ctx,pl,t)`；收到 hello 时先 unloadAll 再逐个 new Function 激活；`leaveRoom()` 时 unloadAll（注入的 style 标签与钩子零残留）。
