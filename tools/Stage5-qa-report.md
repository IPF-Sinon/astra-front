# Stage 5 / 5.1 (I1–I7, J1–J5) —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 最终构建：server.js 2026-11-03T12:38:20.190Z；portal.js 2026-11-03T12:41:33.472Z；public/game.js 2026-11-03T12:50:33.812Z
- 私有端口：游戏服 8796；门户临时实例(随机端口 + /tmp 隔离 DB)；受管节点临时端口/临时目录（managed-nodes 测试后清理）
- 测试脚本：tools/test-stage5.js（新增，覆盖 Stage5 + Stage5.1）；tools/test-stage3.js 等既有套件

## 一、总览（最终构建，0 失败）
| 套件 | 结果 |
| :-- | :-- |
| **tools/test-stage5.js** | **ALL PASS 39/39（0 跳过 0 失败）** |
| test.js | ALL PASS 34/34 |
| test-long.js | ALL PASS 7/7 |
| test-bugs-fixed.js | ALL PASS 13/13 |
| test-node-exclusive.js | ALL PASS 5/5 |
| test-neutral-purity.js | ALL PASS 5/5 |
| test-taskb.js | ALL PASS 18/18 |
| test-taskc.js | ALL PASS 39/39 |
| test-taskd.js | ALL PASS 20/20（1 跳过：枯竭运行期难构造，静态核对） |
| test-stage3.js | ALL PASS 98/98 |
| test-visual-patch.js | ALL PASS 49/49 |

合计 327 通过 / 1 跳过 / 0 失败。

## 二、Stage5 QA 断言（tools/test-stage5.js）
1) 游戏服 GET / 与 /index.html → 403 game_node_api_only（非HTML）；GET /admin → 200 HTML；/api/node-admin/bootstrap-status 可用。OK
2) game-node.config.json initialized:true + admin（scrypt 与 server hashNodePassword 一致）→ /api/node-admin/login 成功，bootstrap-status initialized=true。OK
3) /api/node-admin/rules 热更新 startResource=37 等，overview 反映且写回 game-node.config.json。OK
4) /api/node-admin/rooms/action create / kick（真连 WS 取玩家后踢出）/ destroy；mods/toggle 关闭与开启。OK
5) 门户 /internal/bundle/server.js → 200 JS；/api/admin/node-manager/install + start 拉起子进程后 /api/node-admin/overview 可达（临时端口）。OK
6) allowRegistration=false → /api/register 403 registration_disabled。OK
7) /assets/nebula_deep_1.webp → 200 image/webp。OK

## 三、Stage5.1 QA 断言（tools/test-stage5.js 扩展）
1) public/game.js 无 seatedots 拼写；bindPortalUI 已绑定 mcRoomList/hallFilters/mcJoinSelected/adminTabSys/adminPaneSys/adminPaneNodes/adminPaneAcc/homeView。OK
2) 游戏服 GET /yxapi/api/status 与 GET /yxapi/admin 均 200；ws://127.0.0.1:8796/yxapi/ws 发 join 收到 hello。OK
3) POST /api/admin/create-user 建号成功返回 12 位恢复码；/api/admin/node-manager/status 含 ssoTicket 与节点日志；用 ssoTicket 调节点 /api/node-admin/login 返回 200 与 token。OK
4) 既有 Stage5 全部断言保持。OK

## 四、静态复核（全 OK）
- I1 renderPanorama；I2 双层星云 nebula_deep_1/_2 + 5 类地貌贴图；I2 拖拽线无双层横杠且含 setLineDash；I3 MC 大厅 mc-room-list/mc-room-row/mc-ping-bars/mc-hall-footer；I4 hover/tab/modalOpen/modalClose/joinRoom 音效；I7 管理员三栏 Tab；assets 7 张齐全。
- S51 无 seatedots；bindPortalUI 关键元素齐全；homeView/settingsModal/反代卡片(cfgProxyPrefix/cfgGameWs)；J3 缓存 nebulaBuffer/getTintedPlanetStrip/getSphereShadeCanvas。

## 五、测试期修正（测试侧，非改他人源码）
- test-taskd：旧判定把 `#截获` 抄送误计为“非同盟可见”，已排除 `e.intercept` 后复跑 20/20。
- test-stage5：按实际 API 校准（PORTAL_PORT 环境用于 node-manager portalUrl、install/start/status 实际端点、node-admin login 返回 token、create-user 恢复码等）。

## 六、说明
- 受管节点安装会在工作区生成 managed-nodes/<nodeId>/，测试后已 rm 清理；子进程已 stop/kill。
- 唯一跳过为 test-taskd 枯竭扣能运行期难构造（常量与代码路径静态核对）。
- 未修改 server.js/portal.js/public/docs；临时游戏服、门户实例、受管子进程均已关闭。