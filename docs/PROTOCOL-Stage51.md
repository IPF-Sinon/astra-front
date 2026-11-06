# Stage 5.1 协作契约（J1–J5）
基线：Stage5-20261103-1835。

## 写作用域
- server-eng → server.js、portal.js
- client-eng → public/game.js、public/index.html、public/style.css
- qa-eng → tools/

## 服务端契约
### server.js（J1 + J4）
- 新增 normalizeNodePath(pathname)（见计划实现）：把任意反代前缀后的 /admin、/api/node-admin/*、/api/status、/health、/ws 归一；HTTP 处理器与 upgrade 处理器统一用它。
- upgrade：normalizeNodePath(pathname)==='/ws' 或 headers.upgrade==='websocket' → 允许握手（兼容 /yxapi/ws）。
- ADMIN_HTML：所有 fetch('/api/node-admin/...') 改为基于 location.pathname 去掉 /admin 后缀的相对路径 nodeApiUrl(sub)；并补 bootstrapRequired 时的初始化表单。
### portal.js（J4）
- POST /api/admin/create-user {username,password,role} → 建号（scrypt），返回 recoveryCode；role 仅 user/admin。
- GET /api/admin/node-manager/status 已存在（Lead 上一轮实现）——确保持久化 managedNodes 状态与日志、ssoTicket。
- /api/admin/config 支持 proxyPrefix（子路径前缀）并推导 gamePublicWsUrl/gamePublicApiUrl；/api/portal/status 返回 proxyPrefix。

## 客户端契约
- B-S5-1：全文件不得出现 seatedots（应为 seatdots）。
- B-S5-2：重写 bindPortalUI() 用事件委托绑定 #homeView、#lobbyHallView（#mcRoomList/#hallFilters/#mcJoinSelected/#mcCreateElim/#mcSpectate/#mcRefresh/#hallLogout/#hallBackHome）、#adminModal 三栏（#adminTabSys/Nodes/Acc 与 #adminPaneSys/Nodes/Acc、#cfgProxyPrefix/#saveNetCfgBtn/#testConnBtn、#nodeStartBtn/#nodeRestartBtn/#nodeStopBtn/#openNodeAdmin、#createUserBtn/#adminUserSearch）。
- B-S5-3：新增 #homeView 主菜单五入口（快速出征/房间大厅/画面与音频设置/#settingsModal/作战手册/#helpPanel/管理后台仅 admin），登录后默认进首页；大厅左上「← 返回首页」。
- J1 UI：#adminPaneSys 三选一可视化卡片（门户内置 /ws 推荐、子路径反代填 1 个前缀如 /yxapi 并实时推导 /yxapi/ws、/yxapi/api/status、/yxapi/admin、独立域名直连）+ 一键测试连通性与保存。
- J3 性能：视锥剔除（render 遍历 planets 时按屏幕世界边界外扩 260px 跳过 collectOrbitShips3D/drawPlanet，仅更新 _visCap/_visPur）；预烘焙 getTintedPlanetStrip(terrainKey,tintHex) 与 getSphereShadeCanvas(r,tintHex)（禁止每帧 color 混合/渐变）；双层星云离屏 nebulaBuffer（960x540，每 3 帧或 50ms 更新，主画布每帧 1 次 drawImage）。
- J2 settingsModal：音量/UI音效、画质档位（高/均衡/流畅）、星云亮度 20-100%、FPS/延迟显示开关；首页与局内菜单均可打开。

## QA 断言（tools/test-stage5.js 扩展）
1) public/game.js 无 seatedots；bindPortalUI 绑定 mcRoomList/hallFilters/mcJoinSelected/adminTabSys/adminPaneSys/adminPaneNodes/adminPaneAcc/homeView。
2) 游戏服 GET /yxapi/api/status 与 GET /yxapi/admin 均 200；ws://127.0.0.1:<port>/yxapi/ws 发 join 收到 hello。
3) POST /api/admin/create-user 建号成功返回恢复码；/api/admin/node-manager/status 含 ssoTicket 与节点日志。
4) 现有全部断言保持，全量回归 0 失败。

## 硬约束
- 既有 315 项测试全绿；DEV 无票直连保留；贴图缺失优雅回退。