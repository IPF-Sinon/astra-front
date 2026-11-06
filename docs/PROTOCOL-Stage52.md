# Stage 5.2 协作契约（K1–K6）
基线：Stage51-20261103-2225。

## 写作用域
- server-eng → server.js、portal.js
- client-eng → public/game.js、public/index.html、public/style.css
- qa-eng → tools/

## K1 弹窗层级 + 局内菜单（client）
- index.html：#settingsModal、#helpPanel、#confirmModal 移出 #hud/#startScreen，作为 #app 直接子元素；CSS z-index:65；#helpPanel 支持点外部空白/Esc 关闭。
- game.js：data-menu='factions' 时切换 dom.factionPanel.hidden 并展开；#factionSheetClose 关闭；#hudMenu 删除 sound/zoomIn/zoomOut 三项。
## K2 默认首页 + 去重退出登录（client）
- doBootstrap/doLoginWith 成功后 enterHome()（非 enterHall()）；portalBoot 有 session→enterHome()。
- index.html #lobbyHallView 删除 #hallLogout 与 #mcLogout；仅首页 #homeSwitch 保留「退出登录」。
## K3 过滤废弃房间 + 隐藏内置模组（server+client）
- server.js RoomManager.list() 跳过 status==='settled'||settled；tick() 对 settled 超过 15s（settledAt）delete 回收。
- 插件加载时 nebula-overdrive 标记 builtin:true；hello/status/mods 仍带但客户端过滤。
- portal.js listRooms() 过滤 settled/destroyed/settled===true；满员/禁入显示 已满员/决战禁入 而非 未开放（普通玩家只显示可加入活跃房+无尽预告）。
- client mcRowHtml/updateHallHeader/openStatusDialog 过滤 m.id==='nebula-overdrive'||m.builtin===true；普通房 MOTD 仅 '✦ 星域激战中 · 剩余 mm:ss'。
## K4 首页左侧半露巨星（client）
- 重构 renderPanorama：屏幕坐标单颗巨星（hx=-w*0.04, hy=h*0.52, hr=max(w*0.28,h*0.48)）；planet_terran 自转 scroll=(t*6)%512 + planet_clouds 差速 cloudScroll=(t*9.5)%512 + 青蓝大气散射/左上高光/右下晨昏线 + 18° 双层星环；16 艘飞船（12 星环护航 + 4 巡航）；移除 7 颗小星球演武。
## K5 门户单实例本地游戏服（server+client UI）
- portal.js：managedNodes → 单例 localNode（id 'local-node'，端口 GAME_PORT||8787）；start/install 幂等：已在运行返回 alreadyRunning；探测端口 + db.nodes 10s 内心跳则纳管不重复启动；否则准备 managed-nodes/local-node 并启动唯一子进程。
- 后台 Tab2 UI：上栏「本地受管游戏服（单实例）」端口/更新源/一键初始化启动/重启/停止/打开独立面板(带 ssoTicket)；下栏「分离部署节点接入」说明 + 已心跳注册节点列表。
## K6 QA
- 断言弹窗为 #app 直接子级且首页点 #homeHelp、局内点 data-menu=settings 均显示；#hudMenu 无 sound/zoomIn/zoomOut；factions 点击显示 factionPanel。
- 断言 doLoginWith/doBootstrap → enterHome；#lobbyHallView 无 hallLogout/mcLogout。
- 断言 /api/rooms 无 settled 房；房间 HTML 不含 '模组: 星云超载' 或 nebula-overdrive。
- 断言连调两次 node-manager/start 第二次 alreadyRunning 且不新增子进程。
- 全量回归 0 失败。