# Stage 5.1：深度修复 + 游戏主界面首页 + /yxapi 反代向导 + 性能倍增

团队并行：server-eng(server.js/portal.js) / client-eng(public/) / qa-eng(tools)；Lead 复验、重启、打包。

## 5 个致命页面 Bug 修复
- B-S5-1：game.js `seatedots` 拼写 → `seatdots`（全文件 0 处 seatedots），房间列表不再 ReferenceError。
- B-S5-2：重写 bindPortalUI() 纯事件委托，绑定 #homeView、#lobbyHallView(#mcRoomList/#hallFilters/#mcJoinSelected/#mcCreateElim/#mcSpectate/#mcRefresh/#hallLogout/#hallBackHome)、#adminModal 三栏(#adminTabSys/Nodes/Acc、#adminPaneSys/Nodes/Acc、#cfgProxyPrefix/#saveNetCfgBtn/#testConnBtn、#nodeStart/Restart/StopBtn/#openNodeAdmin、#createUserBtn/#adminUserSearch)。
- B-S5-3：新增 #homeView 游戏主界面首页（快速出征/房间大厅/画面与音频设置/作战手册/管理后台仅admin），登录后默认进首页，大厅可「←返回首页」。
- B-S5-4：server.js 新增 normalizeNodePath，HTTP 与 WS upgrade 统一归一化，兼容 /yxapi/ws、/yxapi/admin、/yxapi/api/status；ADMIN_HTML 改用相对路径 nodeApiUrl(sub) 并补 NODE_BOOTSTRAP_TOKEN 首启表单。
- B-S5-5：loadAdmin 并发拉取 users + node-manager/status 合并节点；portal.js 新增 POST /api/admin/create-user（返回恢复码）。

## J1 反代向导（#adminPaneSys）
- 三选一卡片：①门户内置 /ws（推荐）②子路径反代（只填前缀如 /yxapi，实时推导 /yxapi/ws、/yxapi/api/status、/yxapi/admin）③独立域名直连；一键 WebSocket 连通性测试 + 保存（proxyPrefix 推导 gamePublicWsUrl/gamePublicApiUrl）。

## J2 首页与设置
- #homeView 全屏透景 + 五入口；#settingsModal：主音量/UI音效/画质档位(DPR 2/1.5/1)/星云亮度 20-100%/FPS 延迟开关；首页与局内菜单均可打开。

## J3 Canvas 性能倍增
- 视锥剔除（屏幕世界边界外扩 260px 跳过屏外星，仅更新 _visCap/_visPur）。
- getTintedPlanetStrip（1024×256 双倍宽预染色条，≤60 缓存）+ getSphereShadeCanvas（量化半径光影罩），每帧单次 strip+cloudStrip+shade，移除 color 混合与每帧渐变。
- nebulaBuffer 960×540 每 3 帧/50ms 离屏合成，主画布每帧 1 次 drawImage。

## J4 节点编排闭环
- 后台 Tab2 合并显示在线节点与受管子进程（PID/端口/状态/房间数/日志），按钮：下载配置并启动、启动/重启/停止、打开游戏服独立面板（子路径 /yxapi/admin 或 host:port/admin，带 ssoTicket 免密）。
- Tab3 建号/搜索过滤/踢人/封号解封/重置/删除/IP 黑名单。

## 验证
- tools/test-stage5.js：39/39（Stage5 I1–I7 + Stage5.1 J1–J5：无 seatedots、bindPortalUI 绑定齐全、/yxapi HTTP+WS、create-user、node-manager status+ssoTicket）。
- 全量回归（Lead 每套件独立干净服）：test 34 · long 7 · bugs 13 · node 5 · neutral 5 · taskb 18 · taskc 39 · taskd 19(+2跳过) · stage3 98 · stage5 39 · visual 49 → 326 通过 / 2 跳过 / 0 失败。
- 线上实测：8686 / 200、/assets/nebula_deep_1.webp 200；8787 / 403、/yxapi/api/status 200、/yxapi/admin 200、ws://…/yxapi/ws join→hello。

## 运行
- 门户（唯一入口）：http://127.0.0.1:8686；游戏服 8787（/admin 独立面板）。
- 1Panel/Nginx：/ → 8686；/yxapi → 8787（开启 WS）；后台「子路径反代模式」填 /yxapi 即可自动推导。

## 风险/未决
- 无浏览器环境，首页动线/玻璃拟态/双层自转星球/MC 列表/三栏后台/性能实感建议 8686 GUI 复验。
- test-taskd 枯竭扣能运行期难构造（2 跳过，已静态核对）。
- 受管节点状态为进程内存态，门户重启需重新接管（目录/配置保留）；ssoTicket 60s 一次性。
