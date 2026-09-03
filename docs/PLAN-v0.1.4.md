# dsh-comfyui-canvas v0.1.4 方案

> **本文档是新会话接手说明书**：开发请新开会话，先读本文件 + `docs/NEXT-VERSION-PLAN.md`（接手说明）+ `docs/PLAN-v0.1.3.md`（上一版方案）。
> 状态：**已定稿**（2026-09-03；根因已重新定位，方向从「适配 v0.1.2」修正为「分屏能力插件自包含」）
> 范围：**只列与本插件有关的处理事项**（DSH 核心的无关本地定制不在本版处理范围）

---

## 1. 一句话目标

**把「画布 + 对话 rail 分屏」从 DSH 核心私有补丁依赖中解放出来，改成插件自包含渲染**——让插件在任何干净官方 DSH（0.1.1 / 0.1.2）上开箱即用，同时解决 DSH Desktop 用户「右侧面板不显示」的问题。

## 2. 根因（已重新定位，必读）

### 2.1 现象
- DSH Desktop v2.0.4（社区封装，上游 v0.1.2-alpha.1）用户反映：「装插件后右侧面板不显示」——只剩全屏 ComfyUI 标签，没有右侧对话 rail。

### 2.2 真正根因（非 v0.1.2 破坏性更新）
- 插件 `lib/client.js` **大量直接依赖 DSH 核心的 splitRail 结构**：
  - `document.querySelectorAll('[class*="splitRail"]')`（rail 宽度）
  - `[class*="splitRailComposer"]` / `[class*="splitRailInputWrap"]` 等 CSS（rail 编辑器样式）
  - `ctx.slots.inject("conversation.view")` + plugin-declared split-screen（meta passthrough）
- 这些 splitRail 类名与 split-screen 通道**只存在于本地 DSH 的三个私有补丁**（`3926146` / `31131ffc` / `aa6c600`），**官方任何版本都没有**。
- 因此：**任何装干净官方 DSH 的用户，右侧 rail 天生不存在**，与版本号无关。本地正常只是因为本机 DSH 打了私有补丁。

### 2.3 关键判断
- 「导航图标」已做非侵入式（插件自绘），**分屏 rail 是另一套核心依赖，从未处理**。
- v0.1.4 的目标 = 把导航图标那套「插件自包含」思路复制到分屏 rail 上。

## 3. 本版处理事项（只列与插件有关的）

### 3.1 核心：分屏 rail 插件自包含（P0）
| 子项 | 说明 |
|---|---|
| 现状盘点 | 列出 client.js 所有依赖核心 splitRail / split-screen 通道的位置（L169/190/204-215/261-301 等） |
| 自包含方案 | 仿导航图标：插件 client.js 自己渲染 rail 容器 + 注入样式，不依赖核心类名/通道；`conversation.view` 注入保留（该 slot 官方存在），但分屏布局由插件搭建 |
| 兼容性 | 不破坏本机现有 DSH（本地补丁仍在时行为不变）；干净官方 DSH 上 rail 正常出现 |
| 验证 | 干净 DSH 环境（临时 profile 或升级后的 v0.1.2）跑通：分屏画布 + 对话 rail + 设置页 + 导航图标 |

### 3.2 配套：验证基座升级（P0 前置）
- 本地 DSH 升级 `0.1.1-rc.2` → `v0.1.2-rc.1`（官方正式候选版），作为自包含改造的验证环境
- 升级时丢弃 3 个 rail 本地补丁（`3926146` / `31131ffc` / `aa6c600`）——插件自包含后不再需要；**与插件无关的本地定制（子代理目录等）不涉及、不保留判断**
- 升级前确认 DSH 本体回退方案（git checkout 旧 tag + 重装依赖）

### 3.3 版本声明更新（P1）
- README 中英：DSH 兼容声明从「v0.1.2+ 未适配」改为「v0.1.x 全系可用（分屏自包含）」+ DSH 徽章版本范围更新
- 版本号 `0.1.3` → `0.1.4`

### 3.4 质量保持（P1）
- `npm run check` + `npm test`（16 用例应原样保持绿——utils.js 与 client 改动无关）
- 三副本同步（源码 → node_modules → E 盘 bridge 如涉及）

## 4. 明确不做（留 v0.2+）

- ❌ WebSocket 推送替代轮询（改动大，收益中等）
- ❌ A3 画布「+文件」按钮（已砍：A1 attach_file 已覆盖 agent 侧传输）
- ❌ DSH 核心的无关本地定制（子代理目录 UI 等）——不属于本插件范围

## 5. 实施步骤

```
step 1  升级本地 DSH 到 v0.1.2-rc.1（含回退方案）；丢弃 3 个 rail 本地补丁
step 2  盘点 client.js 对核心 splitRail / split-screen 通道的全部依赖点
step 3  client.js 自包含改造：插件自建 rail 容器 + 样式注入 + 布局
step 4  验证（干净环境）：分屏画布 + 对话 rail + 设置页 + 导航图标
step 5  npm run check + npm test（16 用例绿）→ 三副本同步
step 6  README 版本声明更新 + 版本号 0.1.4
step 7  git commit → 推送 → npm publish → GitHub Release v0.1.4
step 8  cnb 镜像同步（平台流水线自动，或 @CodeBuddy 拉取更新）
```

## 6. 风险与注意

- **升级 DSH 本身是重操作**：影响整个开发环境；升级前确认回退方案
- **自包含改造是 client 重写**：工作量集中在 `lib/client.js`，注意与既有 rail 润色（图片预览/发送按钮/授权弹窗）的衔接
- **上游 v0.1.2 其它 client 变更**：除分屏外，`conversation.view` / settings 契约如有变化一并适配（step 3 时核对）
- **DSH Desktop 兼容**：自包含后不依赖上游结构，理论上官方与社区封装都可恢复；但社区版可能滞后/超前，仍不保证 100%

## 7. 参考

- `docs/NEXT-VERSION-PLAN.md` 顶部备忘（2026-09-03）
- `docs/PLAN-v0.1.3.md`（v0.1.3 已交付）
- 本地 DSH 私有补丁：`3926146`（split-rail composer）/ `31131ffc`（plugin split-screen）/ `aa6c600`（rail 改名对齐）
- 官方 DSH release：`dsh-v0.1.2-rc.1`（2026-09-03）
- cnb 镜像：`https://cnb.cool/Loxi009/dsh-comfyui-canvas`（定时同步流水线）