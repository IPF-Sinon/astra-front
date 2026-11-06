# Stage 5.2：体验精修 + 左侧巨星首页 + 单实例托管

团队并行：server-eng(server.js/portal.js) / client-eng(public/) / qa-eng(tools)；三路中途异常退出，缺口由 Lead 补齐并复验。

## K1 弹窗层级与局内菜单
- #settingsModal/#helpPanel/#confirmModal 从 #hud/#startScreen 内部提升为 #app 直接子级（z-index:65），首页点作战手册、局内点画面与音频均立即显示（不再被父容器 hidden 遮蔽）。
- data-menu='factions' 现会显式切换 factionPanel.hidden 并展开阵营页；#factionSheetClose 关闭。
- #hudMenu 删除「声音 / 放大 / 缩小」三项，保留 7 项紧凑菜单。

## K2 默认首页 + 去重退出登录
- doBootstrap/doLoginWith 成功后统一 enterHome()；仅首页「多人星域·房间大厅」才 enterHall()。
- 删除 #lobbyHallView 内 #hallLogout 与 #mcLogout 两个重复「退出登录」；仅首页 #homeSwitch 保留。

## K3 过滤废弃房间 + 隐藏内置模组文案
- server.js RoomManager.list() 跳过 settled；tick() 对 settled 超 15s 回收；nebula-overdrive 标记 builtin:true。
- portal.js listRooms() 过滤 settled/destroyed；僵尸节点清理（lastSeen>30s 删除、同 URL 仅留最新 nodeId）——解决「两个节点」。
- 客户端 mcRowHtml/updateHallHeader/openStatusDialog 过滤内置模组；普通房 MOTD 仅「✦ 星域激战中 · 剩余 mm:ss」。

## K4 首页左侧巨星全景
- renderPanorama 改为屏幕坐标单颗左侧半露巨型自转星球（球心 -w*0.04/h*0.52，半径 max(w*0.28,h*0.48)），terran 自转 + clouds 1.45× 差速 + 大气散射/高光/晨昏线 + 18° 双层星环 + 16 艘飞船（12 星环护航 + 4 巡航）；移除 7 颗小星球演武，开销大幅下降。

## K5 门户单实例本地游戏服
- portal.js：managedNodes → 单例 localNode('local-node'，端口 GAME_PORT||8787)；start/install 幂等（已运行返回 alreadyRunning；端口已有心跳节点则纳管不重复启动）。
- 后台 Tab2 上栏「本地受管游戏服（单实例）」+ 下栏「分离部署节点接入」说明与已注册节点列表。

## Lead 补齐的缺口
- portal.js node-manager 路由仍调用已改名的 startManagedNode/stopManagedNode → 改为 ensureLocalNode/stopLocalNode/restartLocalNode；install 固定 LOCAL_NODE_ID 单例。
- /api/admin/node-manager/status 同时返回 localNode 与 externalNodes。
- test-stage5 K6-② 断言改为校验 enterHome 进入 home 视图（showPortalView('home')）。
- test-taskc 建驻点加入资源等待与重试（START_RESOURCE=30 下早期可能未攒够 20），消除时序抖动误报。

## 验证（Lead 每套件独立干净服务器 + 服务器复跑）
- test.js 34 · test-long 7 · test-bugs-fixed 13 · test-node-exclusive 5 · test-neutral-purity 5 · test-taskb 18 · test-taskc 39（复跑 3 次稳定） · test-taskd 20(+1跳过) · test-stage3 98 · **test-stage5 54** · test-visual-patch 49 → 合计 342 通过 / 1 跳过 / 0 失败。
- 线上实测：8686 / 200；8787 / 403；门户节点数=1（local-node，僵尸已清）；游戏房列表 3 个可加入普通房 + 无尽灰置，无 settled，mods 带 builtin:true。

## 运行
- 门户（唯一入口）：http://127.0.0.1:8686；游戏服 8787（/admin 独立面板，/yxapi 反代前缀自适应）。

## 风险/未决
- 无浏览器环境，首页巨星/弹窗层级/局内菜单/MC 列表/单实例卡片建议 8686 GUI 强制刷双目视验收。
- test-taskd 枯竭扣能运行期难构造（1 跳过，已静态核对）。
