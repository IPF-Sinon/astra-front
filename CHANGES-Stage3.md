# Stage 3：多房间/三模式 + portal.js 门户与三链路鉴权 + 插件/Mod 热加载

团队并行：server-eng(server.js + plugins/) / client-eng(public/) / portal-eng(portal.js) / qa-eng(tools/)，Lead 独立复验整合。

## Task E 多房间与三大模式
- RoomManager：rooms Map、createRoom/get/defaultNormalRoom/findByToken/list/tick（每 2s 维持 ≥2 间可加入普通房）。
- Game 房间元数据：roomId/mode/name/maxPlayers/hostId/status/createdAt/startedAt/durationMs/lobbyExpireAt/noJoin/settled/mods/spectators。
- 综合权重 W_score = 10*Vtotal + 2*Nships + round(resource)（S/O/M/L=1.0/0.8/1.8/3.0），viewPlayers 导出 score。
- 普通模式：40min、最后5min禁入、最后3min countdownSec+leaderboard、timeup/only-ai 结算 room-settled、真人0冻结 tick、离线保留[掉线]、AI 对离线目标 score*=0.5。
- 淘汰模式：10min候场、房主顺延、roomAddAI/RemoveAI/Start、禁结盟、永久淘汰不重生、25min 或唯一存活结算。
- 无尽模式：list() 灰置入口 locked:true。
- 客户端：顶部红色倒计时条、右上实时积分榜（含[掉线]）、候场面板（房主可操作）、战报弹窗、roomList 无尽灰置、noJoin 友好提示。

## Task F portal.js 门户端（零依赖，默认 8686）
- 注册（scrypt 密码 + XXXX-XXXX-XXXX 12 位恢复码仅返回一次）、登录单设备互踢、恢复码重置+轮换、同 IP 60s>5 次 429。
- 三链路：心跳 HMAC 签名 + PORTAL_VERSION 版本锁（不一致 versionOk:false/拒收）、房间列表/建房/一次性票据（base64url+HMAC，exp 60s）、draining 只出不进。
- 管理员：kick/ban(uid/ip)/delete-user/reset-password/config；非管理员 403。
- 数据持久化 data/portal-db.json（内存+原子写）；支持 require 后 start(随机端口) 供测试。

## Task G 插件+Mod 热加载
- plugins/nebula-overdrive/{manifest,config,shared,client}.json/js；server 启动扫描 enabled 插件。
- /api/status 与 hello 下发 mods；hello 附 config/sharedCode/clientCode（服务端只读取下发不执行）；speedMultiplier 默认 1.0，启用插件 1.15。
- Spectate 上帝视角：state.spectating、全量航线与玩家资源、联盟密聊/#截获 抄送。
- 客户端 ModSandbox：onRenderPlanet/onRenderHud/onEvent/addStyle、load/unloadAll 零残留、进房热加载、退房/断开卸载、window.__modSandbox 测试入口。

## 验证（Lead 每套件独立干净服务器复跑）
- test.js 34 · test-long 7 · test-bugs-fixed 13 · test-node-exclusive 5 · test-neutral-purity 5 · test-taskb 18 · test-taskc 39 · test-taskd 20(+1跳过) · test-stage3 52 · test-visual-patch 49
- 合计 242 通过 / 1 跳过 / 0 失败；node --check server.js/game.js/portal.js 通过。
- Lead 另行独立验证：portal.js（注册/登录互踢/重置+轮换/429/签名心跳版本锁/票据往返/非管理员403）、ModSandbox（load→钩子触发→unloadAll 零残留、坏 mod 隔离）。

## 运行
- 游戏服：node server.js（8787）；门户：node portal.js（8686）。

## 说明/风险
- P1–P5 视觉收尾补丁已在 Stage2 阶段应用（27px SVG 六边形、去除左下角星球面板、聊天默认折叠、长按走七态外交、盟友协防拖拽派遣）。
- 最后5/3分钟门禁需临近结算才触发，已做源码+字段静态核对。
- 普通房保留离线席位；CI 建议每套件重启或套件结束 leave（已按此复跑全绿）。
- 无浏览器环境，像素级视觉未机检，建议 GUI 复验。
