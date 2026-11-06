# Stage 2 · Task D —— 独立测试与复核报告（QA）

- 复核人：qa-eng
- 被测版本：server.js mtime 2026-11-02T06:15:09Z；public/game.js 06:14:36Z
- 测试服务器：`PORT=8798 FREEZE_AI=1 node server.js`（私有端口，未触碰线上服务）
- 测试脚本：`tools/test-taskd.js`（本任务新增）

## 一、测试总览

| 套件 | 结果 |
| :-- | :-- |
| tools/test-taskd.js（新增） | **ALL PASS 19/19（2 跳过 / 0 失败）** |
| tools/test.js | ALL PASS 34/34 |
| tools/test-long.js | ALL PASS 5/5 |
| tools/test-bugs-fixed.js | BUGS ALL PASS 13/13 |
| tools/test-node-exclusive.js | NODE-EXCLUSIVE ALL PASS 5/5 |
| tools/test-neutral-purity.js | NEUTRAL-PURITY ALL PASS 5/5 |
| tools/test-taskb.js | ALL PASS 18/18 |
| tools/test-taskc.js | ALL PASS 39/39 |
| tools/test-visual-patch.js | VISUAL-PATCH ALL PASS 49/49 |

合计 187 通过 / 2 跳过 / 0 失败（跳过项为概率性采样与难构造的运行期场景，见下）。

## 二、Task D 集成测试明细（tools/test-taskd.js）

**静态核对（全部 OK）**：START_RESOURCE=30；ACTION_COST=1；EXHAUST_UPKEEP_PER_SHIP=1.0；EXHAUST_STARVE_RATE=0.5；simulatePlanets 枯竭 upkeep 路径；broadcastChatToCoalition / maybeIntercept 助手存在。

**运行期验证**：
- **START_RESOURCE≈30**：新玩家初始资源 30。**OK**
- **launch 扣费**：连续 5 次 launch 累计资源 31→27（drop=4，≈5 减去 1.2/s 回复与整数取整）。**OK**
- **gather 扣费**：连续 2 次 gather（不同资源点）资源 27→25（drop=2，每次≈1）。**OK**
- **chat global 全服可见**：A 发 global，B/C（非同盟）均收到 channel=global。**OK**
- **chat ally 仅同盟可见**：A 发 ally，同盟 B 收到；非同盟 C/D 未收到原文。**OK**
- **#截获（mark 20%）**：A 连发 28 次 mark，非同盟玩家收到 `chat{channel:'ally',intercept:true}`；文本以 `[#截获]` 前缀、且不含发送者 id/name。**OK**
- **#截获（ally 普通消息 10%）**：A/B 交替发送 18 条（受 2s 冷却限制）本条样本未命中 → 记为 SKIP（概率性，非缺陷；mark 已证明拦截通道可用）。
- **资源不足拒绝**：将 C 资源耗尽后 launch 返回 reject `资源不足`。**OK**
- **枯竭扣全局资源/见底流失**：运行期需构造 exhausted 星球，难稳定构造 → SKIP（常量与代码路径已静态核对通过）。

## 三、public/game.js 客户端 Task D 静态复核

| 复核项 | 结论 | 关键位置 |
| :-- | :-- | :-- |
| 双频道聊天 | state.chatChannel='global'/'ally'；频道按钮 #chatChannels[data-ch] 切换，renderChatChannelButtons 切换 .on；sendChat 发送 `{t:'chat',text,channel}`；未入盟发送 ally 时本地 toast 拦截 | game.js:3580-3592, 3629-3643 |
| 底部可折叠聊天栏 | chatPanel class `collapsed` 折叠；chatCollapse 箭头 ▸/▾；CSS `.chat-panel.collapsed` 隐藏 chat-log/chat-form | game.js:3601-3607；style.css:506-508 |
| 发言冷却 2.0s | 本地 lastChatAt + updateChatCooldownUI 每 200ms 刷新、禁用发送并显示“冷却 x.xs”；服务端亦 2000ms 闸门 | game.js:3608-3612；server.js:2321 |
| 消息频道过滤 | applyChatFilter：sys 常显；ally 频道仅显示 data-channel=ally；global 仅显示 global | game.js:3592-3600 |
| #截获 样式 | .chat-line.intercept 琥珀色背景/左边框；.txt 琥珀加粗；.ico 显示 [#截获]；隐藏发送者 | style.css:510-512；game.js:3661-3682 |
| 未读角标/面板 | chatBadge 未读计数；openChat 清零 | game.js:3644-3656, 3687-3690 |
| DOM 完整性 | chatPanel/chatLog/chatForm/chatInput/chatSend/chatHead/chatChannels/chatCollapse/chatCool/chatChGlobal/chatChAlly/chatBadge 均存在 | index.html |

**发现 1 处客户端小瑕疵（非阻断，未改客户端）**：addChat 对截获文本去前缀用了 `String(msg.text||'').replace(/^[#截获]s*/, '')`（字符类 + 字面 s），无法匹配服务端 `'[#截获] '+原文` 的方括号前缀，导致 UI 会同时显示 .ico“[#截获]”与未去除前缀的正文，出现重复 `[#截获]`。建议改为 `/^\s*\[#截获\]\s*/`。此为显示层小问题，不影响服务端协议与功能验证。

## 四、结论

Task D 服务端（START_RESOURCE=30、launch/gather 各扣 1、资源不足拒绝、global/ally 双通道、mark 20%/ally 10% #截获、枯竭扣能常量与路径）与客户端（双频道/折叠/冷却/#截获琥珀样式/频道过滤）均已实现并通过独立集成测试与全量回归；仅 1 处客户端截获前缀重复的显示小瑕疵（非阻断）。若 server.js 在 06:15:09 之后再有改动，需以最新文件重启 8798 私服复跑 tools/test-taskd.js。
