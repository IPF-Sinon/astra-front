# Stage 5 协作契约（I1–I7）

基线：Stage41-Fixes-20261103-0910 + 已解包 public/assets/*.webp（7 张）。

## 写作用域（互斥）
- client-eng → public/game.js、public/index.html、public/style.css
- server-eng → server.js、portal.js、game-node.config.json、managed-nodes/
- qa-eng → tools/
（public/assets/*.webp 已由 Lead 解包，勿再改）

## 客户端（I1–I4 + I7 UI）
- I1 全景：state.mode==='start' 时 render() 不再提前 return，改调 renderPanorama(t,dt)；相机李萨如巡航（cam.x=world.w*0.5+cos(t*0.035)*1400，cam.y=world.h*0.5+sin(t*0.024)*900）；state.demoScene 生成 7 颗覆盖 5 种地貌的展示星球（各 8~24 艘环绕船，复用 collectOrbitShips3D）+ 每 2.2s 在两星间派 6~15 艘巡航舰队。
- I1 玻璃拟态：.start-screen 改轻透暗角 radial-gradient(...0.14 → 0.55)；.confirm-overlay/.portal-card/.hall-top/.mc-room-list 用 rgba(5,16,28,.64)+backdrop-filter blur(10px) saturate(135%)。
- I2 背景：drawBackdrop 双层星云 —— nebula_deep_1（视差+旋转 +t*0.004，alpha start 0.82/游戏 0.52）、nebula_deep_2（screen，-t*0.006，scale 1.35*max(w,h)，呼吸 alpha）+ 视锥闪烁恒星 + 35 颗屏幕空间星尘。贴图缺失时回退程序化纹理。
- I2 星球：6 地貌分配（exhausted→lava；否则 id%5：0 terran+clouds、1 gas、2 lava+稀疏云、3 ice(lava hue-rotate185 离屏)、4 storm+双层环）；分层：外辉光→后半环→球面裁剪+地表自转(scrollX=t*15*±+id*97 mod r*4，两段首尾相连贴图)→1.45× 差速云层(screen, alpha .55, cloudScrollX=t*22*±+id*53)→阵营染色(color, alpha .52)→高光/晨昏线/2.5px 菲涅尔→前半环。
- I2 拖拽线：删除 drawDragOrder 中绘制垂直横杠的 for 循环（px*hw/py*hw 段），改为双层流光能量航线（底层 lineWidth 3.2 半透明柔光实线 + 顶层 lineWidth 1.6 setLineDash([12,10]) lineDashOffset=-t*60），无任何垂直横杠。
- I3 MC 大厅：#lobbyHallView 重构为 .hall-top（头像+呼号+徽章 / 模式筛选 全部·普通·淘汰·无尽 / 系统状态+管理后台）+ .mc-room-list（max-width 920px，height min(58vh,520px)，rgba(3,10,18,.62)）+ .mc-room-row（74px，左 56×56 .mc-room-icon 矢量星环/赤红脉冲/紫金黑洞，中 .mc-room-main 房名+模式胶囊+节点+MOTD 副标题含剩余时间/最后5分钟标红⚠决战禁入期/房主候场，右 .mc-room-right 席位 3/8 +AI 数 + 5 格 .mc-ping-bars + 进入▶）；单击选中高亮、双击进入；底部 .mc-hall-footer：加入选中星域 / +创建淘汰房 / 上帝视角观战(admin) / 刷新列表 / 退出登录。
- I4 音效：sfx 增 hover(60ms 节流)/tab/modalOpen/modalClose/joinRoom；全局事件委托给按钮/Tab/房间行挂 hover 音与点击音 + 弹性缩放 transform: translateY(-1px) scale(1.01)。
- I7 UI：#adminModal 升级三栏 Tab —— ①门户系统与反代（gamePublicWsUrl 预设、gamePublicApiUrl、allowRegistration 开关、announcement 公告、draining）②游戏服节点部署编排（节点 ID/端口/下载源 → 下载配置并启动；节点列表+状态+日志预览+启动/重启/停止+打开游戏服独立管理面板↗）③指挥官账户与安全（搜索、手动建号可指定 user/admin、踢下线、封号/解封、重置密码、删除、IP 黑名单增删+解封）。

## 服务端（I5–I7 后端）
### server.js（I5）
- --config <path> 或 GAME_NODE_CONFIG，默认 ./game-node.config.json；含 initialized:true 与 admin{username,passHash,salt} 时跳过首启，直接可用该账号登录 /admin；否则生成 NODE_BOOTSTRAP_TOKEN 并在 /admin 引导首启。
- GET / 与 /index.html 保持 403 game_node_api_only；新增 GET /admin（自包含科幻风 HTML 节点管理后台）与 /api/node-admin/*：
  bootstrap-status、bootstrap-init、login（账密或门户 ssoTicket 免密）、overview（PID/uptime/内存/Tick/心跳状态/房间明细/在线玩家/最近100条日志）、rules（热更新 startResource/resourceRegen/reinforceRate/shipSpeed/captureRate/maxPlayers/普通与淘汰时长/draining 并写回 game-node.config.json）、rooms/action（create/settle/reset/destroy/kick）、mods/toggle（plugins 启用与倍速）。
### portal.js（I6 + I7 后端）
- GET /internal/bundle/server.js 基准镜像；POST /api/admin/node-manager/install（downloadUrl 或回退本地源，下载 server.js + 同步 plugins/ 到 ./managed-nodes/<nodeId>/，自动写 game-node.config.json：门户管理员 uid/username/passHash/salt/role、NODE_SECRET、portalUrl、port、默认规则、initialized:true）。
- node-manager start/stop/restart/status：child_process.spawn(process.execPath,[serverJsPath,'--config',configPath])，捕获最近 200 行日志；status 返回安装/运行状态(PID/端口/uptime)/日志/免密 ssoTicket。
- POST /api/rooms/join 或 node-manager 提供 ssoTicket 用于 /admin?sso=... 免密。
- I7 后端：/api/admin/config 支持 gamePublicWsUrl/gamePublicApiUrl/allowRegistration/announcement/draining；allowRegistration=false 时 /api/register 返回 403 registration_disabled（管理员仍可建号）；/api/admin/users 返回 announcement/allowRegistration 等；公告在大厅展示。

## QA 断言（tools/test-stage5.js 或扩展 test-stage3.js）
1) 游戏服 / 与 /index.html 仍 403；GET /admin 200 且为 HTML；/api/node-admin/bootstrap-status 可用。
2) game-node.config.json initialized:true + admin → /api/node-admin/login 用该账号成功，且 bootstrap-status initialized:true。
3) /api/node-admin/rules 热更新后写回配置文件且 overview 反映新值。
4) /api/node-admin/rooms/action 可 create/destroy/kick；mods/toggle 可切 enabled。
5) 门户 /internal/bundle/server.js 200 且为 JS；/api/admin/node-manager/install + start 能拉起子进程并使 /api/node-admin/overview 可达（用临时端口与临时目录）。
6) allowRegistration=false → /api/register 403 registration_disabled。
7) 门户静态托管 /assets/nebula_deep_1.webp 200 image/webp。
8) 全量回归 0 失败（既有 288+）。

## 硬约束
- 既有全量测试必须继续通过（含 DEV 无票直连公平路径）。
- 客户端贴图缺失时必须优雅回退，不得抛错。