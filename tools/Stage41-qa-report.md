# Stage 4.1 (B-S4-1/3/4/5 + 反代 + UX) —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 最终构建：server.js 2026-11-03T00:46:35.826Z；portal.js 2026-11-03T00:46:36.130Z；public/game.js 2026-11-03T00:46:33.438Z
- 私有端口：游戏服 8796；门户临时实例（随机端口 + /tmp 隔离 DB，不触碰 8686）
- 测试脚本：tools/test-stage3.js（Stage4.1 版）；tools/test.js（已按纯API更新3条断言）

## 一、总览（最终构建，0 失败）
| 套件 | 结果 |
| :-- | :-- |
| **tools/test-stage3.js（Stage4.1版）** | **ALL PASS 98/98（0 跳过 0 失败）** |
| test.js | ALL PASS 34/34 |
| test-long.js | ALL PASS 7/7 |
| test-bugs-fixed.js | ALL PASS 13/13 |
| test-node-exclusive.js | ALL PASS 5/5 |
| test-neutral-purity.js | ALL PASS 5/5 |
| test-taskb.js | ALL PASS 18/18 |
| test-taskc.js | ALL PASS 39/39 |
| test-taskd.js | ALL PASS 20/20（1 跳过：枯竭运行期难构造，已静态核对） |
| test-visual-patch.js | ALL PASS 49/49 |

合计 288 通过 / 1 跳过 / 0 失败。

## 二、Stage4.1 QA 验收点（tools/test-stage3.js）
1) 未初始化 POST /api/register → 403 bootstrap_required；已初始化实例注册用户名 'admin' → role==='user'。OK
2) admin/config 写 {key:'gamePublicWsUrl',value:'/api/ws'} → POST /api/rooms/join 返回 wsUrl==='/api/ws'。OK
3) admin/ban 与解封往返：banned 准确 true→false；admin reset-password 返回新密码与轮换恢复码。OK
4) 过期票据+有效 token 重连：入座后关闭连接，随后用已过期 ticket（自构造 exp 过期 payload）+ 有效 token 重连 → 100% 恢复席位（hello 收到，不报票据无效）。OK
5) admin spectate 进满员/禁入房：hello.spectating===true，且不占参赛席位（hello id=0）。OK

## 三、保留的既有断言
纯API游戏服 GET / 与 /index.html → 403 game_node_api_only；门户 GET / → 200 text/html；bootstrap A/B（initialized→403/200/409）；门户票据端到端（100%验签 hello）；门户建 elim 房 → server hello room.mode==='elim' && status==='waiting'；RoomManager/计分/离线[掉线]/portal 注册登录恢复码/同IP>5次429/二次登录互踢/管理员 kick/reset/ban/config/delete/非管理员403/Mod nebula-overdrive/spectate 全量 state。

## 四、静态复核（全 OK）
- public 四视图 bootstrapView/authView/lobbyHallView/adminModal 齐全；#roomListModal 已删除；退出用 showConfirm（无 window.confirm 调用）。
- resolveGameWsUrl 存在；admin 反代表单 #cfgGameWs；recovery 复制按钮 #recoveryCopy；退出对局 keepSeat。
- portal.js：bootstrap_required + gamePublicWsUrl + 静态托管 + .env + ws upgrade。
- server.js：game_node_api_only 403、verifyTicket 双编码、token 重连、leave keepSeat。

## 五、关于 server-eng 反馈（已解决）
- 通用 portalTests 段原先假设“首注册=admin”，与 B-S4-1 冲突。已改为该测试实例以 ADMIN_USER/ADMIN_PASS 启动并以 .env 管理员登录取得 admin token；注册/登录/重置/rooms/票据/管理员用例全部通过（不再有 8 项失败）。
- tools/test.js 三条旧静态断言已改为 8787 GET / 与 /index.html → 403 JSON game_node_api_only（及 /game.js、/style.css → 403），复跑 34/34 全绿。

## 六、说明
- test-taskd 枯竭扣能运行期难构造 → 1 跳过（静态核对）。其余全绿。
- 无阻断缺陷。临时服均已关闭；未修改 server.js/portal.js/public/docs。