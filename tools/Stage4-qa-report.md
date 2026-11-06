# Stage 4 (H1/H2/H3) —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 最终构建：server.js 2026-11-02T15:10:57.779Z；portal.js 2026-11-02T15:10:57.723Z；public/game.js 2026-11-02T15:03:10.089Z
- 私有端口：游戏服 8796；门户用临时实例（随机端口 + /tmp 隔离 DB，不触碰 8686）
- 测试脚本：tools/test-stage3.js（Stage4 版，已扩展）；tools/test.js（已按纯API更新3条静态断言）

## 一、总览（最终构建，每套件干净席位）
| 套件 | 结果 |
| :-- | :-- |
| **tools/test-stage3.js（Stage4版）** | **ALL PASS 82/82（0 跳过 0 失败）** |
| test.js（已更新纯API断言） | ALL PASS 34/34 |
| test-long.js | ALL PASS 7/7 |
| test-bugs-fixed.js | ALL PASS 13/13 |
| test-node-exclusive.js | ALL PASS 5/5 |
| test-neutral-purity.js | ALL PASS 5/5 |
| test-taskb.js | ALL PASS 18/18 |
| test-taskc.js | ALL PASS 39/39 |
| test-taskd.js | ALL PASS 20/20（1 跳过：枯竭运行期难构造，已静态核对） |
| test-visual-patch.js | ALL PASS 49/49 |

合计 272 通过 / 1 跳过 / 0 失败。

## 二、Stage4 验收点覆盖（tools/test-stage3.js）
- **①纯API游戏服**：GET / → 403 JSON error='game_node_api_only'（非 HTML）；GET /index.html → 403 非 HTML。OK
- **②门户静态托管**：portal GET / → 200 Content-Type text/html。OK
- **③首启管理员 A/B**：
  - A（无用户无 .env）：/api/bootstrap/status initialized=false；错误令牌 init→403；正确 bootstrapToken（从控制台 BOOTSTRAP_TOKEN 捕获）→200 role=admin+sessionToken；随后 initialized=true；二次 init→409。OK
  - B（ADMIN_USER/ADMIN_PASS）：启动即 initialized=true，管理员可登录。OK
- **④门户票据端到端**：portal 注册登录 → /api/rooms/join 拿 ticket → 原样发游戏服 WS {t:'join',ticket,roomId} → 收到 hello，roomId=e2e-normal 与票据一致（100% 验签，兼容 hex 签名）。OK
- **⑤门户建淘汰房端到端**：/api/rooms/create(mode=elim) → join 票据 → WS → hello room.mode==='elim' && room.status==='waiting'。OK
- **保留既有断言**：RoomManager/hello房间字段/W_score(86≈85)/离线online=false/AI集火静态/portal 注册登录恢复码/同IP>5次429/二次登录互踢/管理员kick/reset-password/ban/config/delete-user/非管理员403；插件 nebula-overdrive 加载与 hello.mods；spectate 全量 state。OK

## 三、静态复核（全部 OK）
- public：四视图元素 bootstrapView/authView/lobbyHallView/adminModal 齐全；局内 #roomListModal 已删除；退出对局使用 showConfirm（无 window.confirm 调用）。
- portal.js：含 bootstrap(init/status)、静态托管(text/html/index.html)、loadDotEnv/.env、ws upgrade 代理。
- server.js：GET / 纯 API 403 game_node_api_only；verifyTicket 兼容 hex+base64url；/internal/heartbeat 心跳上报。

## 四、说明/限制
1) 最后5分钟禁入、最后3分钟倒计时/排行榜需临近结算，运行期未等待 35 分钟，已静态核对（延续 Stage3 结论）。
2) test-taskd 枯竭扣能运行期难构造 → 静态核对（1 跳过）。
3) 普通房保留离线席位（设计）；CI 建议每套件独立干净服，避免离线占座累计满员导致 defaultNormalRoom 新建第二房。
4) tools/test.js 已按 H2 更新：GET / 与 /game.js、/style.css 期望由 200 改为 403（game_node_api_only），恢复全绿 34/34。

## 五、结论
H1/H2/H3 全部验收点通过；tools/test-stage3.js 82/82，全量 272 通过/1 跳过/0 失败。未发现阻断缺陷。