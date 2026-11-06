# Stage 4：门户大厅重构 + 游戏服纯 API 化（H1/H2/H3）

团队并行：server-eng(portal.js+server.js) / client-eng(public 三件套) / qa-eng(tools)，Lead 独立复验+重启+打包。

## H1 portal.js 门户端（8686，唯一 Web 入口）
- loadDotEnv() 读 .env；initAdminBootstrap()：有 ADMIN_USER/ADMIN_PASS 建 admin，否则生成 32hex bootstrapToken 并醒目打印。
- GET /api/bootstrap/status；POST /api/bootstrap/init（409 已初始化 / 403 令牌错误常量时间比对 / 200 建 admin+session+恢复码 并作废 token）；GET /api/admin/users。
- /api/rooms/join 票据 payload 增 roomName/maxPlayers/isHost，响应带 wsUrl/roomName/status/nodeId。
- 静态托管 public/（GET/HEAD 非 api/internal/health，/ → index.html）；/ws 用 TCP 管道透明代理到健康节点。

## H2 server.js 纯 API 化
- HTTP 仅 GET /api/status、GET /health；其余一律 403 JSON error=game_node_api_only（不再托管任何静态页面）。
- verifyTicket 同时兼容 hex（门户）与 base64url（旧单测）签名。
- join：票据 roomId 本地不存在→按 mode/name/maxPlayers 动态建房（elim→waiting）；p.uid=ticket.uid；isHost&&elim&&!hostId→room.hostId；删除 roomList 分支。
- 每 2500ms 向 PORTAL_URL /internal/heartbeat 发 HMAC-hex 心跳（含 rooms/mods），执行返回的 kick/ban-ip/config 控制。
- 保留 DEV_STANDALONE：无票 join 仍进 defaultNormalRoom，既有测试全绿。

## H3 客户端四视图门户大厅
- 删除局内 #roomListModal 与菜单项、renderRoomList/openRoomList/act==='rooms'。
- #startScreen 四视图：①#bootstrapView 首启管理员（token+呼号+密码→/api/bootstrap/init→恢复码弹窗）②#authView 登录/注册/恢复码重置三 Tab ③#lobbyHallView（普通房进入+管理员上帝观战、创建淘汰房、无尽灰置、刷新、退出登录、ADMIN 后台）④#adminModal（用户/节点/kick/ban/reset/delete/封禁IP/Draining）。
- 局内『退出对局』与战报『返回大厅』：自绘 showConfirm → {t:'leave'} → 关 WS → ModSandbox.unloadAll() → 隐藏 HUD → 回大厅并刷新（不整页刷新、保留登录态）。

## 验证（QA + Lead）
- tools/test-stage3.js（Stage4 版）82/82：纯 API 403、门户 / 200 html、首启管理员 A/B、票据端到端 100% 验签、淘汰房端到端、RoomManager/计分/portal/管理员/Mod/spectate。
- tools/test.js 已按纯 API 更新，34/34。
- 全量回归（每套件独立干净服，0 失败）：test.js 34、test-long 7、test-bugs-fixed 13、test-node-exclusive 5、test-neutral-purity 5、test-taskb 18、test-taskc 39、test-taskd 20(+1跳过)、test-stage3 82、test-visual-patch 49 → 合计 272 通过 / 1 跳过 / 0 失败。
- Lead 线上实测：8787 / 与 /index.html → 403 JSON；/api/status 200；8686 / → 200 text/html；/api/bootstrap/status initialized=false；门户节点心跳已注册；/api/rooms 未授权 401。

## 运行（最终形态）
- 唯一入口：门户 http://127.0.0.1:8686 （托管前端 + 登录 + 房间大厅）。
- 游戏服 http://127.0.0.1:8787 仅 API/WS（浏览器直开返回 403 game_node_api_only）。
- 首次启动门户会打印 BOOTSTRAP_TOKEN，用于网页创建首个管理员账号。

## 风险/未决
- 无浏览器环境，四视图/大厅卡片/管理后台/六边形定位等建议在 8686 GUI 强制刷双目视验收。
- 最后 5/3 分钟门禁、枯竭扣能运行期难即时触发（已静态核对）。
- 门户默认 NODE_SECRET 为开发默认值，正式部署请用环境变量覆盖。
