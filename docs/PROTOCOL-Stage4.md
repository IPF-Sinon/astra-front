# Stage 4 团队协作协议（H1 / H2 / H3）

基线：Stage3-20261102-2225.zip（server.js 2848 / portal.js 832 / public/game.js 4065）。
目标：**门户 8686 为唯一 Web 入口**；游戏服 8787 纯 API+WS；修复票据签名；首启管理员；房间大厅。

## 写作用域（互斥）
- server-eng → **portal.js + server.js**
- client-eng → **public/index.html + public/style.css + public/game.js**
- qa-eng → **tools/**

## portal.js API 契约（8686）
- `GET /api/portal/status`（保留）→ {ok,version,nodes}
- `GET /api/bootstrap/status` → {ok, initialized: users>0}
- `POST /api/bootstrap/init {token,username,password}` → 409 already_initialized / 403 invalid_bootstrap_token / 200 {ok,uid,username,role:'admin',sessionToken,recoveryCode}
- `POST /api/register {username,password}` → {ok,uid,recoveryCode,role}
- `POST /api/login {username,password}` → {ok,sessionToken,uid,role,activeRoom}
- `POST /api/reset-password {username,recoveryCode,newPassword}` → {ok,recoveryCode}（轮换）；>5/60s/ip → 429
- `GET /api/rooms`（Bearer）→ {ok, rooms:[{roomId,name,mode,status,maxPlayers,humans,bots,remainingMs,canJoin,hostId,nodeId,wsUrl,mods}], endless:{locked:true}}
- `POST /api/rooms/create`（Bearer）{name,maxPlayers,mode} → {ok, room:{roomId,...}}
- `POST /api/rooms/join`（Bearer）{roomId} → **{ok, ticket, wsUrl, roomId, mode, roomName, status, nodeId}**（wsUrl 形如 ws://127.0.0.1:8787/ws）
- `GET /api/admin/users`（admin）→ {ok, users:[...], bannedIps, config, nodes}
- `POST /api/admin/{kick|ban|delete-user|reset-password|config}`（admin）
- `POST /internal/heartbeat`（x-node-sig=HMAC hex）→ {ok, versionOk, controls:[{type:'kick',uid}|{type:'ban-ip',ip}|{type:'config',key,value}]}
- 静态托管：GET/HEAD 非 /api/* /internal/* /health → 从 public/ 返回（/ → index.html，Content-Type 正确）。
- `server.on('upgrade')` 对 /ws：TCP 管道转发到健康游戏节点（默认 127.0.0.1:8787），失败则关闭。
- .env：loadDotEnv() 读根目录 .env 注入 process.env（不覆盖已有）。initAdminBootstrap()：无用户时，有 ADMIN_USER/ADMIN_PASS → 建 admin；否则生成 32hex bootstrapToken 打印控制台。

## server.js 契约（8787）
- HTTP：仅 `GET /api/status`、`GET /health`；其它一律 403 JSON {ok:false,error:'game_node_api_only',message}。
- verifyTicket：兼容 hex 与 base64url 签名；payload 含 {uid,name,role,roomId,mode,roomName,maxPlayers,isHost,exp}。
- join：有 ticket 且 roomId 本地不存在 → 按 ticket.mode/name/maxPlayers 动态 createRoom（elim → waiting）；`p.uid=ticket.uid`；若 ticket.isHost && elim && !room.hostId → room.hostId=p.id。删除 onMessage 的 roomList 分支。
- 心跳：每 2500ms POST PORTAL_URL(默认 http://127.0.0.1:8686)/internal/heartbeat，body {nodeId,version:'2.0.0',draining,url,wsUrl,rooms:roomManager.list(),mods:MOD_SUMMARIES}，头 x-node-sig=HMAC hex；响应 controls 执行 kick/ban-ip/config。
- 保持 DEV_STANDALONE：无 ticket 的 {t:'join',name,token} 仍进 defaultNormalRoom（既有测试 100% 通过）。

## 客户端（H3）
- 删除局内 #roomListModal 与菜单项、renderRoomList/openRoomList/act==='rooms'。
- #startScreen 四视图：①bootstrapView（初始化）②authView（登录/注册/恢复码重置三 Tab）③lobbyHallView（普通房卡片进入/上帝观战、创建淘汰房、无尽灰置、刷新、退出登录、ADMIN 管理后台）④adminModal。
- 所有 API 走同源（8686 托管 public）；登录态存 localStorage('of.session')；加入房间用 /api/rooms/join 返回的 ticket+wsUrl 连游戏服。
- 退出对局：showConfirm（禁用 window.confirm）→ 发 {t:'leave'} → 关闭 WS → ModSandbox.unloadAll() → 隐藏 #hud → 显示大厅视图③并刷新。
- 保留既有游戏内渲染/输入/六边形/聊天等全部功能不变。

## 验收
- qa-eng 更新 tools/test-stage3.js：8787 GET / → 403 game_node_api_only；8686 GET / → 200 text/html；bootstrap A/B 双路径；portal 票据→server WS 100% 验签 hello；portal 建 elim 房→server hello.room.mode==='elim' && status==='waiting'。
- 其余既有套件 0 失败。
