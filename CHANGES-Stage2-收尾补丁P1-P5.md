# Stage 2 收尾补丁（P1–P5）+ 仅剩一星不可摧毁

## P1 六边形按钮缩小为 2/3 + 纯矢量 SVG 图标
- .hex-btn 40→27px（移动端 36→24px），内部 SVG 14px（移动端 12.5px）。
- 去掉 信/让/易/毁/外 汉字，改为 HEX_ICONS 四套线性图标：信息星环 / 转让单向迁跃 / 交易双向互换 / 摧毁准星 / 外交双环。
- 环绕半径 Math.max(56,(r*1.65+34)*z) → Math.max(38,(r*1.42+22)*z)；角度 -32/0/32 → -30/0/30。

## P2 去除左下角星球信息面板
- #factionPanel 默认 hidden（仅 ☰「阵营/外交」时以弹窗查看阵营情报，星域版图列表移除）。
- updateOrderPanel 不再为星球打开 #orderPanel（信息统一走六边形①浮窗）；保留舰队面板与停泊点选址借用。

## P3 聊天栏进局默认折叠并避开滑条
- startGame 中 chatPanel 显示且默认 collapsed（「全局/联盟/▸」）；
- .chat-panel 宽度 430→340px + collapsed 紧凑规则；≤960px 时聊天条上移与 #dispatchDock 错开。

## P4 长按他方星球统一打开七态外交模态框
- startLongPress 的 showDiplomacyConfirm → openDiploPanel(pl)。

## P5 允许从驻有己方协防舰队的盟友星球拖拽派遣
- dragTo 去掉 sp0.owner===selfId 限制；dragEligible 改为「己方星球且有驻军 或 己方在该星有在轨协防舰队」。

## 新增规则：己方仅剩一颗星球时不可摧毁
- 服务端 intentDestroy 前置校验 hasOtherLandingSpot()，并新增该方法；读条期间若失去其它落脚点则自动 destroy-cancel（防自爆最后一星）。
- 客户端摧毁前同规则本地拦截提示。

## 验证
- node --check server.js / public/game.js 通过
- 回归：test.js 34/34 · test-long 7/7（已加入「仅剩一星不可摧毁」断言并改为先建停泊点再摧毁）· test-bugs-fixed 13/13 · test-node-exclusive 5/5 · test-neutral-purity 5/5 · test-taskb 18/18 · test-taskc 39/39 · test-taskd 20(+1跳过) · test-visual-patch 49/49
- 14 项 P1–P5 静态结构断言全部通过
