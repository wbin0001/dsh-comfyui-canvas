# dsh-comfyui-canvas v0.1.4 方案

> **本文档是新会话接手说明书**：开发请新开会话，先读本文件 + `docs/NEXT-VERSION-PLAN.md`（接手说明）+ `docs/PLAN-v0.1.3.md`（上一版方案）。
> 状态：**已定稿**（2026-09-03；根因已重新定位，方向从「适配 v0.1.2」修正为「分屏能力插件自包含」）
> 2026-09-04 更新：**并入《SPLIT-LAYOUT-ZERO-DIFF-PLAN.md》实现细节**——明确 rail 聊天内容的来源（覆盖层挤压方案），并把「必须在原生核心上开发/验证」定为执行前提。原独立文档已合并删除。
> 范围：**只列与本插件有关的处理事项**（DSH 核心的无关本地定制不在本版处理范围）

---

## 1. 一句话目标

**把「画布 + 对话 rail 分屏」从 DSH 核心私有补丁依赖中解放出来，改成插件自包含渲染**——让插件在任何干净官方 DSH（0.1.1 / 0.1.2）上开箱即用，同时解决 DSH Desktop 用户「右侧面板不显示」的问题。

**实现形态**：不切视图、不建插件自绘聊天——**chat 保持激活（核心渲染完整聊天 + composer），画布以覆盖层形式贴左侧，对话区用 CSS 从右侧挤压**。聊天内容 100% 来自核心，插件只负责画布覆盖层与布局挤压。

## 2. 根因（已重新定位，必读）

### 2.1 现象
- DSH Desktop v2.0.4（社区封装，上游 v0.1.2-alpha.1）用户反映：「装插件后右侧面板不显示」——只剩全屏 ComfyUI 标签，没有右侧对话 rail。

### 2.2 真正根因（非 v0.1.2 破坏性更新）
- 插件 `lib/client.js` **大量直接依赖 DSH 核心的 splitRail 结构**：
  - `document.querySelectorAll('[class*="splitRail"]')`（rail 宽度）
  - `[class*="splitRailComposer"]` / `[class*="splitRailInputWrap"]` 等 CSS（rail 编辑器样式）
  - `ctx.slots.inject("conversation.view")` + plugin-declared split-screen（meta passthrough）
- 这些 splitRail 类名与 split-screen 通道**只存在于本地 DSH 的三个私有补丁**（`3926146` / `31131ffc` / `aa6c600`，已在 0.1.2-rc.1 上重 port 为 `90e8271363` / `b4436075da`），**官方任何版本都没有**。
- 因此：**任何装干净官方 DSH 的用户，右侧 rail 天生不存在**，与版本号无关。本地正常只是因为本机 DSH 打了私有补丁。

### 2.3 关键判断
- 「导航图标」已做非侵入式（插件自绘），**分屏 rail 是另一套核心依赖，从未处理**。
- v0.1.4 的目标 = 把导航图标那套「插件自包含」思路复制到分屏 rail 上。

### 2.4 为什么分屏必须由插件接管（单活视图约束，必读）

0.1.2-rc.1 官方（无补丁）契约下，插件**无法**让核心同时渲染画布与聊天，原因有三：

1. **`conversation.view` 是单活 list 槽**：`ConversationSession` 只渲染 `renderSlot('conversation.view', props, { only: active.id })`（`skeleton/ConversationSession.tsx` 第 302 行）——画布激活时 chat 根本不在 DOM 里。补丁的 split 分支（同时渲染 active + `{ only: 'chat' }`）是核心内部能力，官方没有。
2. **插件拿不到 chat 视图的渲染**：`chat` 条目由独立包 `ui-chat` 注册（`ui-chat/src/client/apply.ts` 第 94~105 行），带自己的 store / children（`conversation.chat.node`、`conversation.message.images`）/ 注入面。槽条目组件收到的是 `PropsRuntime<'conversation.view'>`——**没有 PropsRenderSlots**；client 规则也禁止 feature 插件 import 另一 feature 插件的值。组件内无法再渲染 chat。
3. **meta 透传不存在**：`StoredEntry.options.meta` 是补丁加的，官方 `register({ meta: {...} })` 静默丢失。

> 推论：**「画布 + 聊天并排」在官方核心上只有一条路——不切换视图，让 chat 保持激活，画布覆盖层贴左，对话区 CSS 右移。** 这就是本版方案。

---

## 3. 本版处理事项（只列与插件有关的）

### 3.1 核心：分屏 rail 插件自包含（P0）

**现状盘点**：client.js 所有依赖核心 splitRail / split-screen 通道的位置：

| 位置（lib/client.js） | 依赖的补丁行为 | 官方核心上的下场 |
|---|---|---|
| `meta: { split: true }` 注册（约 L903） | ui-slots meta 透传 + `isSplitView` | meta 静默丢失 → 退回普通 tab |
| `[class*="splitRail"]`（`applyRailWidth`，L166-177） | 核心 split 分支渲染的 `aside.splitRail` | 无匹配 → rail 宽度失效 |
| `[class*="splitRailComposer"]` / `InputWrap` / `Send` 等样式（`injectRailComposerStyles`，L184-227） | splitRail 编辑器 DOM | 无匹配 → 样式失效 |
| `[class*="splitRailComposer"]`（`injectRailComposerPlus`，L234-327） | splitRail 图片区 | 无匹配 →「+」号失效 |
| `ComfyUIApprovalOverlay`（L397-479，挂载 L721-723） | 前提是「分屏下核心不渲染 composer 链」（补丁行为） | 官方下核心自有审批 → 双弹窗，**删除** |

**自包含方案（覆盖层挤压，主实现）**：

| 项 | 当前补丁方案（淘汰） | v0.1.4 方案 |
|---|---|---|
| 进入分屏 | ComfyUI view tab | header `utilities` 按钮（官方 0.1.2 原生插槽 `conversation.session.header.utilities`，`slots.ts` 第 111~115 行） |
| 画布 | 核心 splitStage | 插件 fixed iframe 覆盖层（复用现有 `buildCanvas`/`positionAt`），贴对话区左侧 |
| 聊天 | 核心 rail 里 `{ only: 'chat' }` | **核心正常渲染的完整 chat**（active 不切走）——含全部气泡、工具卡片、附件 |
| 输入 | 插件自绘迷你 composer | **核心完整 composer**：模型选择、计划、命令菜单、审批弹窗、附件拖放全保留 |
| 画布宽度 | railWidth 设置（已存在） | 同设置；覆盖层宽度 = 视口 − railWidth，对话列右移 railWidth |
| 审批弹窗 | 插件自绘 `ComfyUIApprovalOverlay` | 核心 composer 链自带 → **删除 overlay hack** |

**布局挤压的锚点**（全部是官方核心已存在的稳定设施，不改核心）：

| 锚点 | 位置 | 用途 |
|---|---|---|
| `data-conversation-scroll` | `ConversationRoot.tsx` 第 376 行 | 滚动容器；分屏时右移的目标盒 |
| `data-composer-seat` | 同上第 367 行 | composer 座；跟随 scrollBody 右移 |
| `data-phase` | 同上第 373 行 | `active/hero/settling`；只在 active 时挤压 |
| `--dsh-conversation-column-width` | `ConversationRoot` 第 189 行发布 | 对话列宽度；挤压后让核心宽度轴自适应 |
| `--dsh-composer-height` / `--dsh-conversation-viewport-height` | 第 170~174 行 | 浮动控制避让参数 |
| `conversation.session.header.utilities` | `slots.ts` 第 111~115 行，官方原生 | 分屏开关按钮的注册点（list 槽，空 owner，session 级） |
| `settings.section` / `settingsScope` | 插件已有 | rail 宽度、开关状态、会话隔离 map 的持久化 |

**会话隔离（保留现有机制）**：`activeViewBySession` 上报逻辑继续用，分屏开启/关闭时写 `settingsScope`，`comfyui_config` 工具仍能感知会话在画布专注模式。

### 3.2 配套：执行前提 —— 插件必须在原生核心上开发与验证（P0 前置，最重要）

**推论**：只要开发/验证环境的核心带补丁，写出的插件就必然依赖补丁行为（rail 可 hack、meta 可用、overlay 有存在理由）。因此「适配官方」不是重写完成后顺带验证的事，而是**整个开发过程的环境基线**。

**依赖度账本（哪些会写不出来）**：

| 依赖点 | 补丁核心（现状） | 官方核心 |
|---|---|---|
| `meta: { split: true }` | ui-slots 透传 + `isSplitView` 生效 | meta 静默丢失 → 退回普通 tab |
| `[class*="splitRail"]` 系列 | rail DOM 存在可 hack | 核心不渲染 rail，选择器全落空 |
| `ComfyUIApprovalOverlay` | 前提成立 | 前提消失、核心自带审批 → 双弹窗 |

**环境安排（二选一，动手时定）**：

- **A. 主仓库直接回滚核心（推荐）**：打标签/分支保留当前分屏可用态 → `git reset --hard 76fda72979`（远程官方 master）→ 按维护手册第二节步骤 5 重建 `lib/` + `build:web` → 之后插件的一切开发/验证都在官方核心上做。过渡期分屏退化为全屏画布 tab（0.1.1 时代行为），可接受则选此路。
- **B. 独立验证场 + 主仓保留现状**：`git worktree add <dir> 76fda72979` 建官方实例，插件改动先在验证场跑通再合回 `projects/`；主目录日常继续用分屏。代价是两份依赖/两套构建，且容易在补丁核心上顺手改坏。

两条路验收标准相同：**在未打任何补丁的 `76fda72979` 核心上，插件分屏全功能可用**。

### 3.3 插件侧改造清单（`projects/dsh-comfyui-canvas`，仅此一处）

- **a. 入口**：注册 `conversation.session.header.utilities`，渲染 ComfyUI 状态圆点 + 开/关按钮；状态存 `settingsScope`（`splitEnabledBySession` 沿用 `activeViewBySession` 的写裁剪手法）。
- **b. 布局挤压**：分屏开启时给 `[data-conversation-scroll]` / `[data-composer-seat]` 的祖先（按 `data-phase="active"` 选 root）加挤压，并设置 `--dsh-conversation-column-width`，让核心宽度轴整体收敛到右侧 railWidth 区间。用插件注入 `<style>` + MutationObserver（沿用 `injectRailComposerStyles` 手法），选择器只认 data 属性与 CSS 变量——**不认任何 hash 类名**。
- **c. 画布覆盖层**：`buildCanvas`/`positionAt` 改为「分屏模式下贴对话区 left:0、宽 = 视口−railWidth」；卸载时 `visibility:hidden`、iframe 文档常驻不变。
- **d. 删除**：`ComfyUIApprovalOverlay`、`injectRailComposerStyles`/`injectRailComposerPlus` 的 rail 专用 hack、全部 `[class*="splitRail"]` 选择器。
- **e. 保留**：`ComfyUIControl` 启动卡、桥接鉴权告警、设置页全部字段、`DEFAULT_RAIL` 语义、`activeBase` 配置同步、可达性探测。

### 3.4 核心补丁的处置

- 本地补丁提交（`90e8271363` + `b4436075da`，即旧三补丁的 0.1.2 port）**留在本地、不推送**，作为功能基线。
- 验收通过后回滚核心验证插件独立可跑（见 3.2 环境安排 A）；回滚后 `lib/` 按维护手册重建，snapshot 测试同步回原始期望。

### 3.5 配套：验证基座升级（P0 前置）

- 本地 DSH 升级 `0.1.1-rc.2` → `v0.1.2-rc.1`（官方正式候选版），作为自包含改造的验证环境（当前仓库已在 0.1.2-rc.1，见 2.2 补丁 port 记录）。
- 升级/回滚时丢弃 3 个 rail 本地补丁——插件自包含后不再需要；**与插件无关的本地定制（子代理目录等）不涉及、不保留判断**。
- 升级前确认 DSH 本体回退方案（git checkout 旧 tag + 重装依赖）。

### 3.6 版本声明更新（P1）

- README 中英：DSH 兼容声明从「v0.1.2+ 未适配」改为「v0.1.x 全系可用（分屏自包含）」+ DSH 徽章版本范围更新
- 版本号 `0.1.3` → `0.1.4`

### 3.7 质量保持（P1）

- `npm run check` + `npm test`（16 用例应原样保持绿——utils.js 与 client 改动无关）
- 三副本同步（源码 → node_modules → E 盘 bridge 如涉及）

---

## 4. 验收（替换完成后，在官方核心上跑）

```
1. 启动 dsh web（官方核心源码），打开会话 → 点 header 分屏按钮
2. 左侧画布加载 ComfyUI，右侧完整聊天可见（历史消息、工具卡片）
3. 右侧 composer 完整：模型选择、计划入口、命令菜单、粘贴/拖入图片、发送
4. 工具请求越权 → 出现核心审批弹窗（不再有插件 overlay）
5. 折叠/展开 rail、拖动宽度、切会话 → 布局正确、宽度偏好保留
6. 窄视口（<1200px）→ 分屏自动退出或隐藏画布（别挤死聊天）
7. comfyui_config 工具读到的模式与会话隔离正确
8. 插件卸载/HMR 重载不残留全局样式、iframe 不重建
9. 普通视图/全部功能不因挤压 CSS 受影响
```

---

## 5. 实施步骤

```
step 0  搭好「官方核心」开发环境（3.2 的 A 或 B）；确认回退方案
step 1  盘点 client.js 对核心 splitRail / split-screen 通道的全部依赖点（3.1 表已列，动手时复核行号）
step 2  client.js 覆盖层改造：header utilities 入口 + 画布覆盖层 + data-* 挤压 CSS（3.3 a/b/c）
step 3  删除 rail hack 与 overlay（3.3 d）；保留项核对（3.3 e）
step 4  验证（官方核心，按第 4 节验收 1-9 项）
step 5  npm run check + npm test（16 用例绿）→ 三副本同步
step 6  README 版本声明更新 + 版本号 0.1.4（3.6）
step 7  git commit → 推送 → npm publish → GitHub Release v0.1.4
step 8  cnb 镜像同步（平台流水线自动，或 @CodeBuddy 拉取更新）
```

---

## 6. 风险与开放问题

- **挤压宽度轴的正确性**（最高风险）：核心宽度轴（`resolveContentWidth`、宽度手柄、`--dsh-chat-user-width` clamp）基于真实列宽计算。手动改 `--dsh-conversation-column-width` 可能与手柄/拖宽打架——实施时先浏览器实测拖宽 + 手柄位置，必要时只改 `margin-left` 不改变量（右移而不收窄，画布盖左侧空白）。两种策略都列进验收第 5、9 条。
- **交互模型变化**：分屏从 tab 变 header 按钮。若同时要「全屏画布 tab」与「分屏」，可在 `conversation.view` 注册普通 `comfyui-canvas` 条目（不带 meta，官方合法），tab = 全屏画布（0.1.1 时代行为）；分屏走 header 按钮。两入口并存不冲突，是否要 tab 入口需产品拍板。
- **iframe 与 DSH 的 z-index/遮挡**：现有覆盖层 z-index=40 与 overlay rail 的关系需重测（rail 删除后更简单）。
- **`data-phase` 选择器在 hero/settling 相位**：分屏按钮只在 active 相位可用（header 在非 blank 才渲染，天然满足）。
- **升级 DSH 本身是重操作**：影响整个开发环境；升级前确认回退方案（维护手册全套流程）。
- **上游 v0.1.2 其它 client 变更**：除分屏外，`conversation.view` / settings 契约如有变化一并适配（step 2 时核对）。
- **DSH Desktop 兼容**：自包含后不依赖上游结构，理论上官方与社区封装都可恢复；但社区版可能滞后/超前，仍不保证 100%。
- **升级姿态**：若上游未来把 `meta` 透传 / 多视图并排做成正式特性，本方案可无痛迁移回「核心声明式 split」，插件只删 hacks。

---

## 7. 证据索引（2026-09-04 调查所读）

- `packages/client/ui-conversation/src/client/skeleton/ConversationSession.tsx`（单活视图 + 补丁 split 分支）
- `packages/client/ui-conversation/src/client/apply.ts`（viewTabs/激活/注入面）
- `packages/client/ui-conversation/src/client/contract/slots.ts`（`conversation.view` 声明、header utilities、ConvViewProps 无 render slots）
- `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.tsx`（data-* 锚点、宽度轴、composer seat）
- `packages/client/ui-slots/src/index.ts`（PropsRuntime 无 PropsRenderSlots、RenderOpts.only、meta 为补丁新增）
- `packages/client/ui-chat/src/client/apply.ts`（chat 条目、store、注入面、children）
- `packages/client/ui-layout/src/client/AppFrame.tsx`（固定三列）
- `projects/dsh-comfyui-canvas/lib/client.js`（现有覆盖层/rail hack/设置页）

---

## 8. 参考

- `docs/NEXT-VERSION-PLAN.md` 顶部备忘（2026-09-03）
- `docs/PLAN-v0.1.3.md`（v0.1.3 已交付）
- 本地 DSH 私有补丁：`3926146`（split-rail composer）/ `31131ffc`（plugin split-screen）/ `aa6c600`（rail 改名对齐）；0.1.2-rc.1 重 port：`90e8271363` / `b4436075da`
- 官方 DSH release：`dsh-v0.1.2-rc.1`（2026-09-03）
- cnb 镜像：`https://cnb.cool/Loxi009/dsh-comfyui-canvas`（定时同步流水线）
- 维护手册：`F:\Deepseek-harness\DSH依赖故障修复手册.md` 第二节（lib 重建）/ 第三节（插件更新）