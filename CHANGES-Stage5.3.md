# Stage 5.3 + 5.4 整合：视觉生命力 / 手稿交互 / 管理台隔离

## 冲突裁决（5.4 覆盖 5.3 的布局项）
- 首页：采用 5.4 的「3 主按钮（前往远征/房间大厅/游戏设置）+ 右上公告 + 右下退出登录 + 居中待机条」。
- 管理后台：采用 5.4 的「前端零入口，仅门户独立路由 /qaqmin」。5.3 的 #adminModal / #userModal / corner-dock 未落地。
- 引擎与机制类（战舰贴图、舰队同步、邮件失效、画质解耦）全部采用 5.3 详细实现。

## 资源
- public/assets/ 扩至 11 张：7 张星云/星球 + 4 张真 Alpha 战舰（ship_flagship/cruiser/interceptor/fighter.webp，VP8X alpha 已校验）。

## 引擎（game.js）
- ASSET_SRC 注册 4 艘战舰；initHeroShips/drawHeroShipSprite/drawHeroRing/heroOrbitPoint/drawHeroPlanet/drawHeroShips(backPass) 实现首页环轨舰队 + 3D 前后遮挡 + 切线姿态 + 引擎离子辉光。
- 相机推摇：updateHeroCamera + renderPanorama 以 easePan 在「行星居中」与「镜头左移」间插值 hx/hy/hr；竖屏强制居中。
- 舰队同步：updateFleetShips 锚定服务端插值坐标 (f.dx,f.dy) 计算权威航程 prog，主画面与小地图/抵达判定同源。
- 邮件：invalidateMailItem 归档「已失效」，pact-request / joint-request 入箱，处理/超时/结算后不自动删除。
- 设置：state.settings 扩为 10 字段；quality 只控 DPR 与滤波，planetRotate/nebulaFlow/particles/engineTrails/planetRings/showFps 独立门控。
- 全局点击星芒粒子（state.uiBursts，桌面与局内双路径绘制）。
- 派遣条支持直接输入精确艘数（dispatchExactCount，与百分比双向同步，orderNext 优先精确值）。
- 本地远征沙盒：上传 .json 或一键标准演习星域，纯本地运行不连 WS；局内菜单「导出本地存档」。
- 移除全部 admin 前端逻辑（管理台已迁门户）。

## 页面（index.html / style.css）
- #hudMenu 精简为 5 项（阵营与外交/镜头回主星/星域态势/作战手册/退出星域），菜单与邮件球改 SVG 图标。
- 首页三态结构、#expeditionModal、MC 式 #settingsModal（画质档位 + 6 渲染开关 + 音频）、#dispatchCountInput。
- 删除 #adminModal 与旧首页顶栏；修复 .faction-panel 被无条件 display:none 遮蔽（阵营面板点击终于可见）。
- 新增待机条脉冲、弹窗居中缩放动画 180ms、邮件分组样式、角落按钮、小地图/聊天半透明、大厅高透景。
- public/ 全目录 Emoji 计数 = 0。

## 门户（portal.js）
- 新增 adminPath（默认 /qaqmin，可由 ADMIN_PATH 或后台覆盖）+ normAdminPath 规范与保留前缀回退。
- GET <adminPath> 返回自包含单页管理台（内联 CSS/JS，零外部依赖）：系统与反代 / 本地单实例游戏服 / 账户与安全。
- /api/admin/config 支持 adminPath 写入并规范化；/api/portal/status 暴露 adminPath。

## 验证
- 全量 11 套件：test 34 · long 7 · bugs 13 · node 5 · neutral 5 · taskb 18 · taskc 39 · taskd 20(+1跳过) · stage3 99 · stage5 67 · visual 52 → **354 通过 / 1 跳过 / 0 失败**。
- 线上：门户 / 200、/qaqmin 200、bootstrap initialized=true。
- 按用户要求：本轮不自行启动游戏服，只启动门户，游戏节点由管理台一键创建。

## 运行方式（新）
1. 启动门户：node portal.js（8686）
2. 浏览器打开 http://<host>:8686 → 登录
3. 进入管理台 /qaqmin → 「本地受管游戏服」→ 下载配置并启动 → 游戏节点拉起后即可进大厅开房

## 未决 / 说明
- 无浏览器环境，首页推摇镜头 / 战舰舰体 / 弹窗动画需 GUI 复验。
- 本地远征沙盒为最小可用（装载+渲染+导出），未实现完整离线战斗 AI。
- test-stage3 / test-stage5 中 3 条引用已删 DOM 的断言已同步更新为 5.4 新结构。
