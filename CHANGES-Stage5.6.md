# Stage 5.6：首页战舰贴图 / 空房泛滥 / 节点初始化 三处实机缺陷修复

## 一、你反馈的三个问题与根因

| 现象 | 根因（实查代码） | 修复 |
| --- | --- | --- |
| **首页飞船是三角形** | `public/game.js` 的 `ASSET_SRC` 只注册了 7 张星球/星云图，**4 张战舰贴图根本没登记**；`asset('ship_flagship')` 恒为 `null`，`drawHeroShipSprite` 因此一直走矢量回退分支画成三角舰体 | `ASSET_SRC` 补入 `ship_flagship / ship_cruiser / ship_interceptor / ship_fighter`，资产预加载器自动覆盖 |
| **没初始化就一堆房间、还进不去** | ① `RoomManager.tick()` 每 tick 保底 **3 个**普通房（`while (joinable.length < 3)`），启动时也预建 3 个 → 大厅一上来就有 `norm-1/2/3`；② 门户从 GitHub Release 下载的 `server.js` 是**旧资产**（163,776 B），不含任何修复 | ① 保底数由 3 降为 **1**；② 重新上传 Release 资产为最新 `server.js`（163,847 B） |
| **管理初始化报错 `invalid_node_id`** | `/api/admin/node-manager/start` 与 `/restart` 强制要求 `body.nodeId`，缺省直接 400 `invalid_node_id`；但门户本就只托管单实例 `local-node` | 两个路由的 `nodeId` 改为**可选**，默认单实例 `LOCAL_NODE_ID`，端口取 `GAME_PORT\|\|8787` |

## 二、改动文件

- `public/game.js`：`ASSET_SRC` 增加 4 项战舰贴图。
- `server.js`：删除启动时「补到 3 个普通房」的循环；`tick()` 保底数 3 → 1。
- `portal.js`：`node-manager/start`、`node-manager/restart` 不再校验 `nodeId`。

## 三、端到端验证（隔离环境 8801 门户 + 8802 节点）

```
START(不传 nodeId) = {"ok":true,"nodeId":"local-node","port":8802,"started":true}
节点健康          = 200
受管 server.js    = 163847 B（与仓库源码一致，非旧 Release）
门户 /api/rooms   = count=2  → norm-1/canJoin=true/bots=3  +  endless/locked
/api/rooms/join   = ok=true, hasTicket=true, ws=ws://127.0.0.1:8802/ws
```

即：不再有「一堆空房」，节点能一键初始化，房间能真正加入并拿到 WS ticket。

## 四、回归

全部 11 套件：test 34 · long 7 · bugs 13 · node 5 · neutral 5 · taskb 18 · taskc 39 · taskd 20(+1跳过) · stage3 99 · stage5 67 · visual 52
→ **359 通过 / 1 跳过 / 0 失败**。

## 五、发布

- 仓库 main 提交：`e80bf16`（已推送）
- Release v1.0.0 资产 `server.js` 已替换为 163,847 B 最新版
- 门户默认下载地址：`https://github.com/IPF-Sinon/astra-front/releases/latest/download/server.js`

## 六、你的操作

1. 刷新 `http://<host>:8686`（强制刷新，避免旧缓存）。
2. 进 `/qaqmin` →「本地受管游戏服」→ **一键初始化并启动**（这次不会再报 `invalid_node_id`）。
3. 进入房间大厅应只看到 **1 个普通房 + 无尽模式灰置**；点进去即可开局。

> 若之前已启动过旧节点，请先在管理台点「停止」，再「一键初始化并启动」，让门户重新从 Release 拉取新版 `server.js`。
