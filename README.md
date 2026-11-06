# AstraFront · 星海边境

> A real-time multiplayer orbital fleet strategy game — pure Node.js + HTML5 Canvas, **zero dependencies**.
>
> 纯原生 Node.js + Canvas 实现的多人实时星海战略游戏，**零第三方依赖**。

---

## 概览 Overview

| 项 | 说明 |
| --- | --- |
| 玩法 | 实时舰队调度 / 星球占领 / 七态外交 / 三档对局模式 |
| 架构 | **门户（唯一 Web 入口）** + **游戏节点（纯 API/WS）** 双进程 |
| 渲染 | HTML5 Canvas 2D：球面自转贴图、双层星云视差、3D 环轨舰队、四舰种真 Alpha 精灵 |
| 依赖 | 仅 Node.js 标准库（`http` `crypto` `child_process` `net`），**无 npm 依赖** |
| 鉴权 | 三层链路：HMAC 节点心跳 → `Session_Token` → 一次性 `Game_Ticket` |
| 体验 | 首页待机态「点击空白进入」+ 相机偏航推摇 + 全局点击星芒 + 弹窗缩放动画 |

---

## 快速开始 Quick Start

### 1. 启动门户（唯一 Web 入口）

```bash
node portal.js
# 默认 http://127.0.0.1:8686
```

首次启动时，控制台会打印 **`BOOTSTRAP_TOKEN`**，用它完成管理员初始化。

### 2. 创建游戏节点

浏览器打开 `http://<host>:8686` → 登录 → 进入管理台 **`/qaqmin`** →
「本地受管游戏服」→ **一键初始化并启动**。

门户会从 GitHub Release 下载游戏服产物，单实例托管，随后即可进入房间大厅开房。

### 3. 自定义管理台路径（可选）

```bash
ADMIN_PATH=/my-secret-console node portal.js
```

也可在管理台内修改，保存后立即生效。

---

## 直接运行游戏服

```bash
node server.js            # 默认 8787，纯 API/WS（GET / 返回 403）
node server.js --config game-node.config.json
```

游戏服对外只暴露 API 与 WebSocket，**不托管前端**；前端统一由门户提供。

---

## 目录结构 Layout

```
astra-front/
├─ portal.js              # 门户：静态托管 / 鉴权 / 大厅 / /ws 代理 / 管理台 / 节点编排
├─ server.js              # 游戏服：房间 / 战斗 / 外交 / 纯 API+WS
├─ public/
│  ├─ index.html          # 三视图（认证 / 首页 / 大厅）+ 局内 HUD
│  ├─ game.js             # 引擎：渲染 / 相机 / 舰队 / 沙盒 / 邮件 / 粒子
│  ├─ style.css
│  └─ assets/             # 11 张 WebP（星云 / 星球 / 4 艘战舰）
├─ plugins/               # 内置 Mod（nebula-overdrive）
├─ tools/                 # 15 个零依赖测试套件
└─ docs/                  # 各阶段协议与变更说明
```

---

## 测试 Tests

```bash
node tools/test.js          # 基础 / 长时间 / Bug 回归 / 阶段测试共 11 套件
```

每个套件建议在**独立干净的游戏服**上运行（离线席位会累积）。

---

## 反向代理 Reverse Proxy

门户是唯一入口，反代到 `8686` 并**开启 WebSocket** 即可：

| 路径 | 目标 | 说明 |
| --- | --- | --- |
| `/` | `8686` | 门户（含 `/ws` 转发） |
| `/yxapi` | `8787` | 可选：直连游戏节点（管理台填「子路径反代前缀」） |

---

## 授权 License

MIT — 见 [LICENSE](LICENSE)。
