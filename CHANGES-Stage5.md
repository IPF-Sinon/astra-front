# Stage 5：视觉生命力重塑 + MC 式大厅 + 双端隔离与节点编排

团队并行：client-eng(I1–I4/I7UI) / server-eng(I5–I7) / qa-eng(test-stage5)，Lead 补齐 portal.js I6 后端并复验打包。

## 资源
public/assets/ 已收录 7 张零接缝 WebP（nebula_deep_1/2、planet_terran/gas/storm/lava、planet_clouds），全部 RIFF/WEBP 校验通过。

## I1 全场景动态星域背景
- start 模式下 render() 不再提前 return，改调 renderPanorama：相机李萨如巡航 + state.demoScene 7 颗 5 地貌展示星球（各 8~24 艘环绕）+ 每 2.2s 巡航舰队。
- .start-screen 改轻透暗角；.confirm-overlay/.portal-card/.hall-top/.mc-room-list 玻璃拟态（rgba(5,16,28,.64)+blur(10px) saturate(135%)），全程可见背后旋转星云与演武星系。

## I2 立体自转星球 + 双层星云
- drawBackdrop：nebula_deep_1（视差+旋转 +t*0.004）+ nebula_deep_2（screen，-t*0.006，呼吸 alpha）+ 视锥闪烁恒星 + 35 颗星尘；贴图缺失回退程序化纹理。
- drawPlanet：6 地貌（terran/gas/lava/storm/ice + clouds），球面裁剪自转 + 1.45× 差速云层 + 阵营染色(color .52) + 高光/晨昏线/菲涅尔 + 双层行星环。
- drawDragOrder：删除垂直横杠循环，改双层流光能量航线（3.2 柔光实线 + 1.6 流动虚线 lineDashOffset=-t*60）。

## I3 Minecraft 式房间大厅
- .hall-top（头像+呼号+徽章 / 模式筛选 / 系统状态+管理后台）+ .mc-room-list（max-width 920px、min(58vh,520px)）+ .mc-room-row（74px，左 56×56 星环图标、中房名+模式胶囊+MOTD、右 席位 3/8+AI+5 格 mc-ping-bars+进入▶）+ .mc-hall-footer（加入选中星域/+创建淘汰房/上帝视角观战/刷新/退出登录）。单击选中、双击进入。

## I4 微动效与音效
- sfx 增 hover(60ms 节流)/tab/modalOpen/modalClose/joinRoom；全局事件委托挂悬停音与弹性缩放。

## I5 游戏服独立化 + 独立管理面板
- --config/GAME_NODE_CONFIG/默认 game-node.config.json 驱动（startResource/resourceRegen/reinforceRate/shipSpeed/captureRate/maxPlayers/时长/draining）。
- initialized:true+admin 时跳过首启，可直接用该账号登录；否则生成 NODE_BOOTSTRAP_TOKEN。
- GET / 与 /index.html 仍 403 game_node_api_only；新增 GET /admin（自包含科幻风 HTML）与 /api/node-admin/{bootstrap-status,bootstrap-init,login,overview,rules,rooms/action,mods/toggle}，支持 ssoTicket 免密。

## I6 门户托管游戏服（Lead 补齐实现）
- GET /internal/bundle/server.js 基准镜像（200 text/javascript）。
- /api/admin/node-manager/{install,start,stop,restart,status}：下载或本地回退 → managed-nodes/<nodeId>/ 写 game-node.config.json（initialized:true，含门户管理员 uid/username/passHash/salt、NODE_SECRET、portalUrl、port、默认规则）→ child_process.spawn(node,[server.js,'--config',cfg])，捕获最近 200 行日志，返回 ssoTicket 供 /admin?sso= 免密。

## I7 门户管理员三栏设置
- 后端：/api/admin/config 支持 gamePublicWsUrl/gamePublicApiUrl/allowRegistration/announcement/draining；allowRegistration=false 时 /api/register → 403 registration_disabled；/api/portal/status 返回公告与注册开关。
- 前端：#adminModal 三栏 Tab（门户系统与反代 / 游戏服节点部署编排 / 指挥官账户与安全）。

## 验证（Lead 每套件独立干净服务器 + Stage5 专测）
- test.js 34 · test-long 7 · test-bugs-fixed 13 · test-node-exclusive 5 · test-neutral-purity 5 · test-taskb 18 · test-taskc 39 · test-taskd 20(+1跳过) · test-stage3 98 · **test-stage5 27** · test-visual-patch 49 → 合计 315 通过 / 1 跳过 / 0 失败。
- 线上实测：8686 / 200、/assets/nebula_deep_1.webp 200 image/webp；8787 / 403、/admin 200；门户公告/注册开关字段就绪。

## 运行
- 门户（唯一入口）：http://127.0.0.1:8686；游戏服纯 API/WS：8787（独立面板 /admin）。
- 门户管理后台「游戏服节点部署」可一键下载配置并启动受管节点，再点「打开游戏服独立管理面板 ↗」带 ssoTicket 免密进入。

## 风险/未决
- 无浏览器环境，全景演武/双层星云/自转星球/MC 大厅/三栏后台建议在 8686 GUI 强制刷双目视验收。
- test-taskd 枯竭扣能运行期难构造（1 跳过，已静态核对）。
- 正式部署请用环境变量覆盖 NODE_SECRET。
