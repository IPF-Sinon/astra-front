# Stage 5.5：十项缺陷审计修复 + 项目更名 astra-front

## 一、审计结论
上一轮 Stage53 包虽通过单元测试，但存在 10 处「未接线 / 视觉失真 / 半途而废」：
静帧暴涨的假球平移、待机点击无响应、远征是死地图、5 个设置开关是空壳、
点击粒子被 UI 遮挡、弹窗没有关闭动画、阵营面板闪退、滑条被精确值卡死、
大厅仍在预取 Mod、管理台乱码与 Emoji。本轮全部修复。

## 二、修复明细

1. **真正的 3D 摄像机偏航**
   - `drawHeroPlanet` 增加 `easePan` 参数，球面采样经度 `camShift=(easePan)*115` 同步滚动，云层 `camShift*1.25`。
   - 半径改为恒定：`baseR=max(w*0.25,h*0.43)`，`hr=baseR*(1+easePan*0.04)` —— 不再是 330→540 的 62% 暴涨。
   - 行星刚体移动：`hx 0.50w→0.02w`，`hy 0.50h→0.51h`，星环与 15 艘环轨战舰同参数退场。
   - 背景：星云按 `-0.18w + off, 1.36w × 1.16h` 绘制，**彻底消除右侧黑边断层**；星层 `-0.34w` 视差。
   - `updateHeroCamera`：镜头在 `hall` 与 `home+menu` 时左移，竖屏强制居中，阻尼 `dt*3.8`。

2. **首页三态交互闭环**
   - `#homeNoticeBtn` / `#homeSwitch` 提升为 `#startScreen` 直接子级：未登录也能看到公告。
   - `applyHeroStage`：auth 显公告；standby 显公告+退出登录+呼吸条；menu 全部隐藏并显主菜单。
   - 空白点击改绑 `#startScreen`（原 `#homeView` 高度为 0，点不中），并过滤按钮/输入/卡片。
   - 竖屏提示由 toast 改为**居中弹窗**。
   - 移除底部旧 `.start-footer` 横条。

3. **可玩的本地远征沙盒**
   - 新增 `handleSandboxIntent` / `spawnSandboxFleet` / `stepSandboxSimulation`。
   - `sendIntent` 首行拦截沙盒指令 → 不再弹「链路未连接」。
   - 支持：派兵出击、抵达结算与占领、星球自动补船与资源枯竭、摧毁读条、每 4.5s 演习 AI 出征、存档导入/导出。

4. **MC 式设置真正接线**
   - `state.settings` 十字段全部落地并持久化；`dom` 补齐 5 个复选框引用。
   - 生效位置：`planetRotate`→球面/云层自转；`nebulaFlow`→星云相位与星尘；`particles`→交战粒子；
     `engineTrails`→舰队尾焰与引擎辉光；`planetRings`→星环与大气辉光；`showFps`→帧率角标；`quality`→DPR 三档。

5. **顶层点击星芒**：新增 `#fxCanvas`（`z-index:9999; pointer-events:none`），`getFxCtx()` 按 DPR 缩放绘制，穿透所有弹窗。

6. **弹窗缩放关闭**：新增 `closeModalAnimated(el)`（`.closing` → 160ms → hidden），已接入 7 类弹窗共 8 处关闭路径。

7. **阵营外交**：`factionList` 点击改为直接 `openDiploPanel`，不再被 `updateOrderPanel` 的 100ms Tick 秒关。

8. **派遣滑条**：拖动与点击刻度时清空 `dispatchExactCount`，恢复按百分比计算。

9. **大厅 Mod 预取**：已从 `refreshHall` 移除，仅在收到 `hello` 时 `ModSandbox.load`。

10. **管理台清理**：`户子进程` → `门户子进程`；按钮 Emoji 全清，改纯文字。

## 三、项目更名与发布

- 项目名：**astra-front**（AstraFront · 星海边境）。
- 新增 `package.json`（name=astra-front）、`README.md`、`.gitignore`（排除运行期数据与打包产物）。
- 仓库：https://github.com/IPF-Sinon/astra-front （main 分支）。
- Release：**v1.0.0** ，资产 `server.js`（163,776 B）。
- 门户默认游戏服下载地址：`https://github.com/IPF-Sinon/astra-front/releases/latest/download/server.js`
  （可由 `NODE_DOWNLOAD_URL` 环境变量或后台 `nodeDownloadUrl` 覆盖；断网时自动回退本地拷贝）。

## 四、验证

- 全量 11 套件：test 34 · long 7 · bugs 13 · node 5 · neutral 5 · taskb 18 · taskc 39 · taskd 19(+2跳过) · stage3 99 · stage5 67 · visual 52
  → **358 通过 / 2 跳过 / 0 失败**。
- Release 资产实测：下载 163,776 B 与本地 `server.js` **逐字节一致**，`node --check` 通过。
- 门户实测：`/` 200、`/qaqmin` 200、`nodeDownloadUrl` 指向 Release、管理台 0 乱码 0 Emoji。

## 五、未决 / 风险

- 无浏览器环境，偏航观感、星云黑边、弹窗动画、战舰舰体需 GUI 复验。
- 沙盒 AI 仅驱动 `owner === 2` 阵营，标准演习星域已含该阵营。
- 若仓库转为私有，Release 下载需带令牌；当前为 public，直接可用。
