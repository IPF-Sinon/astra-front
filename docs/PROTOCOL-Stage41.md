# Stage 4.1 协作契约（B-S4-1..7 + 反代配置 + UX）

基线：Stage4-PortalLobby-20261102-2325（portal.js ~1015 / server.js ~2935 / game.js ~4411）。

## 写作用域
- server-eng → portal.js + server.js
- client-eng → public/index.html + public/style.css + public/game.js
- qa-eng → tools/

## 服务端契约
### portal.js
- POST /api/register：无用户时 403 bootstrap_required；普通注册 role 恒 user（移除 username==='admin' 提权）。
- DEFAULT_CONFIG 增 gamePublicWsUrl=env GAME_PUBLIC_WS_URL 或 ''，gamePublicApiUrl=env GAME_PUBLIC_API_URL 或 ''。
- POST /api/rooms/join 响应：wsUrl = db.config.gamePublicWsUrl 或 node.wsUrl 或 DEFAULT_GAME_WS；并返回 configWsUrl=db.config.gamePublicWsUrl 或 null。spectate===true 且 user.role==='admin' → 跳过 noJoin 与满员限制。
- GET /api/portal/status 返回 gamePublicWsUrl 与节点概况。
- POST /api/admin/config 支持写 gamePublicWsUrl / gamePublicApiUrl（持久化 + 控制下发）。
- POST /api/admin/ban：ban = body.ban!==undefined ? (body.ban!==false) : (body.banned!==false)。
- /internal/heartbeat：遍历 body.rooms 同步 db.rooms；对已结算或节点回收超过 60s 的房从 db.rooms 删除（B-S4-7）。
### server.js
- join：ticket 验签失败/过期但 msg.token 经 roomManager.findByToken 命中 → 直接放行恢复席位（B-S4-3）。
- 观战：仅 role==='admin' && ticket.spectate===true 允许 sendSpectatorHello；观战分支置于满员/noJoin 判定之前，不占座、不分配星球、不发进房广播（B-S4-4）。
- leave：msg.keepSeat===true && status==='running' → 保留席位（conn=null, online=false, presence 广播, reassignHost）；else if mode==='elim'&&running&&!msg.dropSeat → 保留；else removePlayer（B-S4-5）。
- 心跳 body.rooms 供门户同步（已存在）。

## 客户端契约
- resolveGameWsUrl(raw)：相对路径（/ 开头）→ 同源协议+location.host+路径；含 {host} → 替换；127.0.0.1/localhost 但页面非本地 → 回退同源 /ws；空 → 同源 /ws；否则原样。connectRoom 使用它。
- joinRoom(roomId,spectate)：请求体 {roomId, spectate:!!spectate}；connectRoom onopen 发 {t:'join',name,ticket,token:state.token 或 null,roomId,spectate:!!spectate}。
- enterHall() 开 5s 轮询 refreshHall(true) 静默；进入房间 clearInterval。
- adminModal：网络反代配置表单（#cfgGameWs + #saveNetCfgBtn → /api/admin/config {key:'gamePublicWsUrl',value}）；预设按钮【/api/ws】【/ws】【本机默认】；ban 按钮 data-banned 与后端对齐；delete/ban/kick 走 showConfirm；reset-password 生成临时密码+轮换恢复码并 showRecovery 展示。
- recoveryModal：加 #recoveryCopy 复制按钮（navigator.clipboard.writeText，Toast 已复制）。
- 底部 #serverChip：/api/portal/status + /api/rooms 显示 门户在线·节点在线·在线指挥官 N。
- 退出对局：showConfirm → {t:'leave',keepSeat:true} → 关 WS → ModSandbox.unloadAll() → 渐隐 HUD → 回大厅并 refreshHall；禁 window.confirm、禁 location.reload。
- index.html：recoveryModal 加复制按钮；admin 反代卡片；style.css 删废弃 .rl-card/.room-list；房间卡最后5分钟标红禁入期、淘汰房房主标识/席位点、按钮 loading。

## QA 断言（tools/test-stage3.js）
1) 未初始化 POST /api/register → 403 bootstrap_required；注册 'admin' → role==='user'。
2) admin/config 写 {key:'gamePublicWsUrl',value:'/api/ws'} → /api/rooms/join wsUrl==='/api/ws'。
3) admin/ban 与解封往返 banned 准确切换；reset-password 返回新密码与轮换恢复码。
4) 入房 65s 后过期 ticket + 有效 token 重连 → 恢复席位不报票据无效。
5) admin spectate 进满员/禁入房 → hello.spectating===true 且真人数量不增。
全量回归 0 失败。