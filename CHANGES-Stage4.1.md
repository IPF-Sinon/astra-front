# Stage 4.1：审计修复（7 项 Bug）+ 反代路径配置 + UX 打磨

团队并行：server-eng(portal.js+server.js) / client-eng(public/) / qa-eng(tools)；Lead 独立复验、重启、打包。

## 修复的 7 项核心 Bug
- B-S4-1 抢注/同名提权：/api/register 在无用户时 403 bootstrap_required；普通注册 role 恒 'user'（移除 username==='admin' 提权）。
- B-S4-2 管理后台：ban 字段公式修正（body.ban!==undefined?…）；reset-password 回显新密码；前端 ban 按钮 data-banned 对齐、删除/封禁/踢人走 showConfirm、重置密码展示临时密码+轮换恢复码。
- B-S4-3 重连：server join 中 ticket 过期/失败但 msg.token 命中 findByToken → 恢复席位；玩家 token 采用门户 sessionToken。
- B-S4-4 上帝观战：仅 role==='admin' && ticket.spectate===true 允许；分支前置于满员/noJoin，不占座、不分星、不发进房广播；portal /api/rooms/join 对 admin spectate 跳过 noJoin/满员。
- B-S4-5 普通房退出不清星：leave 支持 keepSeat，running 时保留席位（online=false/presence/reassignHost），仅候场退出或 dropSeat 才 removePlayer。
- B-S4-6 反代 WS 写死：portal 新增 gamePublicWsUrl/gamePublicApiUrl 配置（env GAME_PUBLIC_WS_URL/API_URL），/api/rooms/join 下发 wsUrl+configWsUrl；客户端 resolveGameWsUrl 智能解析相对/{host}/本机回退同源。
- B-S4-7 僵尸淘汰房：/internal/heartbeat 用 body.rooms 同步 db.rooms，删除已结算/回收>60s 的房。

## UX 打磨（H3 增强）
- 大厅 5s 静默轮询；底部 #serverChip 显示 门户在线·节点在线·在线指挥官 N；普通房剩余时间/最后5分钟标红禁入期；淘汰房房主标识+席位点；进入/创建按钮 loading 防连点。
- 管理后台分组卡片（网络反代设置/系统参数/指挥官与节点），反代 WS 路径输入+预设【/api/ws】【/ws】【本机默认】。
- 恢复码弹窗一键复制（navigator.clipboard + Toast）。
- 退出对局自绘确认 → {t:'leave',keepSeat:true} → 关 WS → ModSandbox.unloadAll() → HUD 渐隐 → 回大厅刷新（无 window.confirm、无整页刷新）。

## 验证
- tools/test-stage3.js（Stage4.1）98/98：注册 403 bootstrap_required、admin 注册 role=user、admin/config→wsUrl=/api/ws、ban 往返、过期 ticket+token 重连、admin spectate 不占座、纯 API 403、门户 200 html、bootstrap A/B、票据端到端、elim 建房。
- tools/test.js 34/34（静态断言改为 8787 / 与 /index.html → 403）。
- 全量回归（Lead 每套件独立干净服复跑）：test.js 34 · test-long 7 · test-bugs-fixed 13 · test-node-exclusive 5 · test-neutral-purity 5 · test-taskb 18 · test-taskc 39 · test-taskd 20(+1跳过) · test-stage3 98 · test-visual-patch 49 → 合计 288 通过 / 1 跳过 / 0 失败。
- Lead 线上实测：8686 / → 200；8787 / → 403；POST /api/register（未初始化）→ 403 bootstrap_required；/api/bootstrap/status initialized=false；门户心跳注册节点。

## 运行
- 唯一入口：门户 http://127.0.0.1:8686（托管前端+大厅）；游戏服 8787 纯 API/WS。
- 首次启动门户打印 BOOTSTRAP_TOKEN 用于创建首个管理员。
- 反代部署：管理后台配置 gamePublicWsUrl（如 /api/ws）或 .env GAME_PUBLIC_WS_URL。

## 风险/未决
- 无浏览器环境，四视图/大厅卡片/管理后台/渐隐退场建议 8686 GUI 复验。
- test-taskd 枯竭扣能运行期难构造（1 跳过，已静态核对）。
- 门户默认 NODE_SECRET 为开发默认值，正式部署请用环境变量覆盖。
