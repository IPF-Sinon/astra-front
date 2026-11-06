# Stage 3 (Task E / F / G) —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 被测版本：server.js mtime 2026-11-02T12:55:26.106Z；public/game.js 2026-11-02T12:40:24.566Z；portal.js 已落地；plugins/nebula-overdrive= 存在
- 私有端口：游戏服 8796、门户（临时实例随机端口，PORTAL_DB 指向 /tmp 隔离库）
- 测试脚本：tools/test-stage3.js（本任务新增）

## 一、总览

| 套件 | 结果 |
| :-- | :-- |
| **tools/test-stage3.js（新增）** | **ALL PASS 52/52（0 跳过 0 失败）** |
| test.js | ALL PASS 34/34 |
| test-long.js | ALL PASS 7/7（已按更新版“仅剩一星不可摧毁+先建停泊点”） |
| test-bugs-fixed.js | BUGS ALL PASS 13/13 |
| test-node-exclusive.js | NODE-EXCLUSIVE ALL PASS 5/5 |
| test-neutral-purity.js | NEUTRAL-PURITY ALL PASS 5/5 |
| test-taskb.js | ALL PASS 18/18 |
| test-taskc.js | ALL PASS 39/39（在干净席位的新服上） |
| test-taskd.js | ALL PASS 20/20（1 跳过：枯竭运行期难构造，已静态核对） |
| test-visual-patch.js | VISUAL-PATCH ALL PASS 49/49 |

全量回归合计 190 通过 / 1 跳过 / 0 失败；Stage3 专测 52/52。

## 二、Task E（RoomManager 与三模式）
- hello 含 roomId/mode/status/maxPlayers/hostId/mods；默认加入普通房 norm-1。
- calcScore：实测 score=86 vs 公式 10*Vtotal+2*Nships+round(res) ≈85（误差≤3）。
- roomList：返回 3 房；可加入普通房 ≥2；无尽模式灰置入口 locked=true。
- state 含 roomId/mode/status/remainingMs/noJoin。
- 离线：玩家断开后 online=false（前端 [掉线]），普通房星球不清空（1→1）。
- 静态核对：最后5分钟 noJoin、最后3分钟 countdownSec+leaderboard、永久淘汰 permanentlyOut、淘汰禁结盟文案、AI 集火 score*=0.5 均存在。
- 淘汰房 roomCreate(elim) 运行期有响应；25min 结算/最后3分钟广播因需等待 35 分钟无法运行期触发，已以源码路径+字段静态核对（列为限制）。

## 三、Task F（portal.js 三链路/恢复码/管理员）
- 注册返回 12 位恢复码 XXXX-XXXX-XXXX（字符集正确）；登录返回 sessionToken。
- 同账号二次登录互踢：旧 token GET /api/rooms=401，新 token=200。
- 恢复码重置密码成功且轮换新恢复码；新密码可登录。
- 同 IP 60s 内 >5 次重置尝试 → 429（实测 statuses=[401,401,401,401,429,429]）。
- 心跳版本：version=0.0.0 → versionOk=false/versionMismatch；version=2.0.0 → accepted=true。
- /api/rooms 含节点房间与无尽灰置入口；draining 节点房间被排除（只出不进）。
- 入房票据：payload{uid,roomId,mode,exp}，exp≈now+60s，HMAC(NODE_SECRET) 可复算验签。
- 管理员：kick / reset-password / ban(uid) / ban(ip) / config / delete-user 全部 200；非管理员调用 403。

## 四、管理员上帝视角 spectate
- spectate 后收到 state.spectating=true；state 含全量舰队航线字段与所有玩家 resource（能量/资源）。

## 五、Task G（插件 + Mod 热加载）
- 服务端扫描 plugins：/api/status mods=["nebula-overdrive"]；hello.mods 含 config/sharedCode/clientCode。
- 客户端 ModSandbox：存在 onRenderPlanet/onRenderHud/onEvent/addStyle/load/unloadAll/runPlanetHooks；drawPlanet 末尾 runPlanetHooks；收到 hello 先 unloadAll 再 load；收到 leave/断开 unloadAll（退房零残留）。

## 六、P1–P5 与 Task E 客户端静态复核（全部 OK）
- P1 六边形按钮 27px（移动端 24px），内部为 SVG 图标（无汉字）。
- P2 #factionPanel 默认隐藏；选中星球不再弹 #orderPanel（星球信息改六边形①浮窗 openPlanetInfo）。
- P3 长按走 openDiploPanel。
- P4 聊天默认折叠（chatCollapsed 状态 + 面板默认隐藏）。
- P5 dragEligible 拖拽资格规则存在（己方驻军≥1 或己方在轨≥1）。
- Task E 客户端含 roomList/room-settled/leaderboard/countdownSec/lobby/spectating 标记。

## 七、限制与观察
1) 最后 5 分钟禁入与最后 3 分钟 countdown/leaderboard 需临近 40 分钟结算才下发，运行期不等待 35 分钟 → 以源码路径与 state 字段静态核对。
2) 普通房会保留离线玩家席位（设计如此）。若在“同一长期运行服”上顺序跑多个多人测试，前序套件若未 leave 产生离线占座，累计满 8 后 defaultNormalRoom 会新建 norm-2，使后续 5 人级测试跨房（test-taskc 曾因此 E 落入 norm-2）。在“每个套件独立干净服”下全部 0 失败。建议 CI 每套件重启或套件结束 leave。此非产品缺陷，属测试环境席位复用。
3) “Draining sector...” 为本服 SIGTERM/SIGINT 优雅停机处理（测试收尾 kill 时出现），非功能缺陷。

## 八、结论
Task E/F/G 全部落地并通过 tools/test-stage3.js 52/52；原有 9 套回归在独立干净服下全部 0 失败（190 通过/1 跳过）。未发现阻断缺陷。