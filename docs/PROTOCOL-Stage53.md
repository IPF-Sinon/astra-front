# Stage 5.3+5.4 协作契约 (PROTOCOL-Stage53.md)

基线：Stage52 + 新增 public/assets 11 张贴图（含 4 张真 Alpha 战舰）。
优先级：5.4 覆盖 5.3 的首页布局/管理入口冲突项；引擎机制一律采用 5.3。

## 写作用域（严格互斥）
- server-eng → portal.js
- client-eng → public/game.js
- ui-eng → public/index.html, public/style.css
- qa-eng → tools/
- Lead → public/assets/, docs/, 打包

## 统一元素 id（ui-eng 建，client-eng 绑）
homeNoticeBtn, homeSwitch, standbyPrompt, homeMainMenu, homeExpedition, homeLobby, homeSettings,
expeditionModal, expeditionFileInput, expeditionStartDefault, expeditionClose, expeditionMsg,
setQuality, setNebula, setRotPlanet, setNebulaFlow, setParticles, setEngineTrails, setPlanetRings, setShowFps,
setVolume, setUiSfx, settingsClose, dispatchCountInput, dispatchPctLabel

## state.settings 字段
volume:60, uiSfx:true, quality:'balanced', nebula:100,
planetRotate:true, nebulaFlow:true, particles:true, engineTrails:true, planetRings:true, showFps:false

## state 新增
heroStage: 'auth'|'standby'|'menu'   // 首页阶段
heroPan: 0..1                        // 0=行星居中, 1=镜头左移
uiBursts: []                         // 点击星芒粒子
dispatchExactCount: null             // 精确派遣艘数（null=按百分比）
lastActiveAt: number                 // localStorage 'of.lastActiveAt'

## heroStage 判定（5.4 §2.1）
- 未登录 → 'auth'
- 已登录且 Date.now()-lastActiveAt > 300000 → 'standby'（显示 standbyPrompt）
- 已登录且 <= 5min → 'menu'
- 点击 standbyPrompt / 空白 → 'menu' 并写 lastActiveAt
- 竖屏（viewH()>viewW()）时 heroPan 强制 0

## 相机推摇（5.4 §2.2）
updateHeroCamera(dt)：targetPan = (heroStage==='menu' && !isPortrait) ? 1 : 0;
  state.heroPan += (targetPan-heroPan) * min(1, dt*4.2)；|diff|<0.0005 时直接置 target。
renderPanorama：easePan = p*p*(3-2p)；
  hx = 0.50w*(1-e)+(-0.04w)*e ; hy = 0.50h*(1-e)+0.52h*e ;
  hr = round(rCenter*(1-e)+rLeft*e)，rCenter=min(w,h)*0.31，rLeft=max(0.28w,0.48h)。
drawBackdropWithCameraPan(t,easePan)：星云 x-=easePan*w*0.16, scale=1+easePan*0.05；星层 x-=easePan*w*0.38。

## portal.js adminPath（5.4 §5.1）
- db.config.adminPath 默认 process.env.ADMIN_PATH || '/qaqmin'
- normAdminPath(raw)：补 '/'、去尾 '/'、空或与 ['/api','/internal','/ws','/assets','/health'] 冲突 → '/qaqmin'
- GET <adminPath> 与 <adminPath>/ → 200 text/html 自包含管理台（内联 CSS/JS，无外部依赖），含三块：
  ① 系统与反代（三选一 + adminPath 输入 + 注册开关 + 公告 + draining）
  ② 本地受管游戏服（单实例 start/restart/stop + logTail + 打开节点面板 ?sso=）
  ③ 账户与安全（建号 / 重置密码 / 封解 uid 与 ip）
  页内登录 POST /api/login → sessionStorage token → Authorization: Bearer 调 /api/admin/*
- POST /api/admin/config 支持 key='adminPath'（写入前 norm）
- GET /api/portal/status 增 adminPath
- 不改 server.js

## 舰队同步（5.3 §4.2，关键）
updateFleetShips：以服务端插值坐标 (f.dx,f.dy) 为编队中心；
  arriveR = tgt.isOutpost? r*1.15+4 : r*1.28+4（与 server 一致）；startR = srcR*1.35；
  flightSpan = max(20, centerDist-startR-arriveR)；
  along = (fx-startX)*ux + (fy-startY)*uy；prog = docking?1:clamp(along/flightSpan,0,1)；
  prog<0.98：编队槽位 formX = fx + ux*((0.5-rank)*swarmLen*corridorEnv) + nx*(latSeed*swarmWidth*corridorEnv)，
            前 15% 用 launchBlend 从 (s.ox,s.oy) 汇入；
  否则：以 2.4×shipSpeed 切入 orbGoal，到达即 s.arrived=true。
drawMinimap：用 f.dx/f.dy。

## 邮件（5.3 §4.3）
- addMailItem(kind,id,title,desc,expireAt,payload)
- invalidateMailItem(key,reason)  // 标记 invalid=true + statusText，不删除
- removeMailItem(key)            // 仅手动 × 
- renderMail 分「待处理」+「已失效」两组，已失效隐藏同意/拒绝并显示状态标签
- 接入：pact-request / pact-declined / pact-formed / joint-request / joint-launched / joint-cancelled / onTradeResult

## 内部远征沙盒（5.4 §3.2，最小可用）
- state.mode='sandbox'：不建 WS，用本地副本 state 跑 render 循环
- 上传 .json（world/planets/players/fleets/nodes/rules）→ 装载并渲染
- expeditionStartDefault：生成标准演习星域（若干星球+玩家+AI 占位）
- 局内菜单「导出本地存档」→ 下载 JSON

## 硬约束
- public/ 全目录 Emoji 计数 = 0
- #adminModal 不得出现在 index.html
- node --check 三文件通过
- 11 套件 0 失败