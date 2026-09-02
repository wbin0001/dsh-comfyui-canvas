# dsh-comfyui-canvas — v0.1.2 开发规划（完整方案）

> **本文档是 v0.1.2 的完整方案**：方向 + 细化设计（含画布会话框上传通道 A3、专属管理技能 B3）已合一，不写代码。实现时新开会话，先读本文件 + `docs/architecture.html` + `docs/architecture-flow.html` + `NEXT-VERSION-PLAN.md`（v0.1.1 记录，含架构边界与坑）。
> 最后更新：2026-09-02（已并入原独立的上传通道细化文档，本文档为唯一方案）

---

## 0. 一句话目标

把「对话 ↔ 画布」的文件传输从**「仅图片」**扩展为**「通用文件」**（图像 / 音频 / 视频 / 3D），并上线**专属技能包（skill）**，让 agent 能完整驱动「生成 → 传输 → 音画合成 → 取回」的创作链路。**播放能力不做**——那是 DSH 生态的事。

## 1. 定位与边界（先写死，避免跑偏）

### 1.1 本插件做什么 / 不做什么

| 能力 | 本插件 | 归属 |
|---|---|---|
| **传输**（对话 ↔ 画布的文件上传 / 读取 / 取回） | ✅ **核心** | 本插件 |
| **播放**（视频/音频在对话里播放） | ❌ 不做 | DSH 生态 / 其他插件 |
| ComfyUI 节点 / 生成逻辑 | ❌ 不改 | ComfyUI 生态（已成熟） |
| TTS 生成音频 | ⚠️ 仅作为「文件传输的一类输入」 | 走通用文件传输，不专门做 |

### 1.2 为什么不做播放 / 不加节点（决策依据）

- **播放**：DSH 核心附件系统只支持图片（png/jpeg/webp/gif），视频/音频/3D 无附件类型；播放应等 DSH 生态或第三方插件，本插件硬做只会重复造轮子。
- **节点 / 生成逻辑**：ComfyUI **原生已支持音频、视频、3D 的加载**（LoadAudio / LoadVideo / 3D 网格加载等节点），音画合成生态也已成熟（Wan2.5/Kling 2.6/LTX-2 音画同步、`VideoAddAudio`、Index-TTS/ChatterBox 等 TTS 节点）——自研节点反而让工作流更复杂、用户要学新东西。
- **TTS 的真实定位**：是「做视频时的音频/配音文件」（配旁白、音轨），本质是**传输的一类文件**，不是独立播放能力。

### 1.3 版本衔接

- v0.1.1 已完成：`comfyui_attach_image`（图片进画布）+ `comfyui_inject_text`（文本注入）+ 启动/预览 bug 修复。
- v0.1.2 是在此之上的**传输泛化 + 技能包**，不推翻 v0.1.1 的任何接口。

---

## 2. 核心交付

### A. 通用文件传输（传输能力扩展，必做）

现状：`comfyui_attach_image` 只接受图片；`comfyui_get_outputs` 只回图片预览。

目标：**上传 / 取回都支持 图像、音频、视频、3D 等通用文件。**

#### A1. 新增 `comfyui_attach_file`（或扩展 `attach_image`）
- **职责**：把 agent 本机任意文件上传进 ComfyUI 的 `input/` 目录（沿用 ComfyUI 原生上传端点，host 端、不经过 bridge）
- **支持类型**：`image/*`（png/jpeg/webp/gif）、`audio/*`（wav/mp3/ogg）、`video/*`（mp4/webm/mov）、`3D`（glb/gltf/obj/fbx/stl）
- **接口草案**：
  ```js
  comfyui_attach_file({
    path:     string  // 本机文件绝对路径（必填）
    nodeId?:  number  // 可选：上传后 set_param 指向对应 LoadAudio/LoadVideo/LoadImage/GLB 节点
    mediaType?:string // 可选：显式指定类型；缺省按扩展名推断
  })
  // 返回 { filename, subfolder, mediaType, nodeId?, updated? }
  ```
- **兼容**：保留 `comfyui_attach_image` 作为图片快捷别名（或标记 deprecated 由通用入口替代，二选一，实现时定）
- **验收**：对话里一个 mp4/wav/glb → `attach_file` → ComfyUI input/ 出现该文件 → 对应 Load 节点可选到它

#### A2. `comfyui_get_outputs` 泛化：结果携带文件路径/URL
- **现状**：返回图片预览（/view 直连）
- **扩展**：每条结果附加 `fileUrl` / `localPath`（若 ComfyUI 本机可及）——视频 mp4、音频 wav、3D glb 都能以「文件路径/URL」形式交回对话
- **语义**：DSH 不播放，但 agent 和用户能**拿到文件地址去打开/二次使用**
- **验收**：跑一个含视频/音频/3D 输出的工作流 → `get_outputs` 返回对应文件的 URL/路径

#### A3. 画布会话框上传通道（client 侧，与 A1 配套）

现状：画布右侧 rail composer 只有「+ 图片」入口（`injectRailComposerPlus`），`accept` 仅图片、走 DSH 官方附件通道（`addDraftImages`）——音频/视频/3D 进不去。

目标：**新增「+ 文件」通用入口**，两类通道并行、语义分家：

| 通道 | 类型 | 走向 | 反馈 |
|---|---|---|---|
| 图片（已有） | image/* | DSH 附件（agent 能看） | 现有附件预览 |
| 文件（新增） | audio/video/3D | host `attach_file` → ComfyUI `input/`（供 Load 节点） | 对话内提示 |

**交互形态（D 混合）**：图片「+」号不动；新增「+ 文件」按钮（样式对齐 28px 圆角虚线框），支持多选、逐个上传、失败不阻塞其余。

**类型路由**：`image/*` → 图片通道；wav/mp3/ogg/flac/m4a → 音频；mp4/webm/mov/mkv → 视频；glb/gltf/obj/fbx/stl → 3D；其余 → 一律进 `input/` 透传。

**上传流程**：
```
「+ 文件」→ 文件选择器(多选)
  → 按扩展名推断 mediaType（路由表）
  → 调 host comfyui_attach_file({ path, mediaType? })   ← host 直连原生上传
  → 返回 { filename, subfolder, mediaType }
  → 对话追加提示：✅ 已上传 <filename> → input/  或  ❌ 失败 <原因>
```

**反馈设计**：用对话消息做载体（留痕、可回看、衔接后续操作），不悬浮 toast。

**涉及文件**：`lib/client.js`（「+ 文件」入口 + 选择器 + 上传调用 + 提示）、`lib/index.js`（`attach_file`，即 A1）、README 中英、三副本同步。

**开放问题（实现时决策）**：
1. 本地文件路径传递：浏览器文件选择器能否拿到 host 可读的绝对路径？（客户端 → host 传参通道需确认；拿不到则改 host 自行读取或走其他入口）——**硬前置，先探**
2. 自动建 Load 节点：上传成功后是否自动 `add_node(LoadAudio/LoadVideo/3D)` 指向新文件？默认不做，可作下版增值
3. 图片也可走文件通道（绕过 DSH 附件直接进 `input/`）？默认不放行
4. 取回方向（3D/视频取回路径）：随 A2 `get_outputs` 泛化一并考虑

### B. 专属技能包（skill，必做）

技能矩阵（三个，全部可随插件分发）：

| 技能 | 作用域 | 必做/可选 |
|---|---|---|
| `comfyui-canvas-ops` | 画布操作 SOP（读/改/跑/取图/自检） | 必做 |
| `comfyui-video-audio-ops` | 音画创作 SOP（视频+配音/音轨） | 可选 |
| `comfyui-admin-ops` | ComfyUI 环境管理 SOP（配置/启动/更新/节点管理） | 必做 |

> 术语：ComfyUI 生态里的「**节点**」（node / custom node / node pack）即第三方自定义插件，位于 `custom_nodes/` 下；「本插件」指 DSH 侧的 `dsh-comfyui-canvas`。两者不要混称。

#### B1. 核心技能 `comfyui-canvas-ops`（画布操作 SOP）
- **目标**：agent 遇到「用画布作图/改工作流/出图」时，自动按正确顺序驱动工具
- **流程**（草案）：
  ```
  1. comfyui_config —— 确认画布在前台、连接正常
  2. comfyui_read_workflow —— 读当前图，向用户复述并确认关键节点
  3. comfyui_set_param / comfyui_connect / comfyui_add_node —— 按需修改
  4. comfyui_run 运行 → comfyui_get_outputs 取回出图
  5. vision_describe 自检出图 → 不达标迭代；达标交付
  ```
- **注意**：读取永远只读、写操作先确认、运行前讲清改了哪些

#### B2. 可选进阶技能 `comfyui-video-audio-ops`（音画创作 SOP）
- **目标**：agent 做「视频 + 配音/音轨」时知道怎么驱动现有 ComfyUI 节点链路
- **流程**（草案）：
  ```
  1. 生成视频（读图/跑视频节点，如 Wan/Kling/LTX）
  2. 生成音频：TTS/音频文件 → comfyui_attach_file 上传为音轨输入
  3. 走音画合成（VideoAddAudio 或对应工作流）→ comfyui_run
  4. comfyui_get_outputs 取回含音轨的视频文件路径/URL
  ```

#### B3. 新增技能 `comfyui-admin-ops`（ComfyUI 环境管理 SOP，必做）
- **目标**：agent 遇到「配置 / 启动 / 更新 ComfyUI、管理已装节点」时，知道怎么安全地驱动现有工具维护环境
- **覆盖**（运维职责；「开发调试」已升级为核心功能 C，见 §2C）：
  ```
  1. 配置管理 —— comfyui_config 读/改连接（baseUrl/port/networkMode/桥接 token/启动命令/rail 宽度）
  2. 启动 / 状态 —— 用 launchCommand 启动 ComfyUI，轮询 /system_stats 确认在线；launchError 读失败原因
  3. 更新 —— comfyui_upgrade：git pull 核心 + 全部节点（区分核心/节点，失败不中断）
  4. 节点管理 —— 列出已装 custom_nodes、识别 git 托管与手工目录、按需安装/更新节点
  ```
- **安全注意**：更新/重启/装节点是重操作——先确认、讲清影响（如「更新 60+ 节点」「重启中断生成」）；更新前看是否有运行中任务
- **边界**：本技能管「维护/操作」现有生态，**不新增生成节点、不改生成逻辑**——与 §1 决策一致

#### B4. 挂法（二选一，实现时定，推荐 A）
- **A. 源码内嵌**：插件 `inject` 加 `skills`，`ctx.skills.register(...)` 注册 runtime skill —— **随插件分发、用户零步骤**
- **B. 文件版**：包内 `.agents/skills/<name>/SKILL.md`，靠 skill-filesystem 扫描 —— 用户可见可改

### C. 核心功能：画布内开发调试 ComfyUI 节点（升级自 B3 的「开发调试」，必做）

> 这是本插件区别于其他 DSH 插件的**独特价值**：画布正好是节点调试的观察窗——边看画布边改节点源码，全程在对话 + 画布内完成。

#### C1. 一组新工具（开发闭环）
| 新工具 | 职责 | 对应环节 |
|---|---|---|
| `comfyui_read_source` | 读某个节点包源码（`custom_nodes/<name>/` 目录树或单文件，含 `__init__.py`、前端 js） | 看代码 |
| `comfyui_edit_source` | 改节点源码（受控写文件） | 改代码 |
| `comfyui_reload` | 重启 ComfyUI 让改动生效（区分完整重启 / 是否可热重载） | 应用改动 |
| （复用现有）`comfyui_run` / `comfyui_debug` | 在画布上跑 / 校验节点 | 验证 |

**核心闭环**：`read_source` → `edit_source` → `reload` → 画布 `run` → `get_outputs` → 看效果 → 迭代

#### C2. 专属技能 `comfyui-dev-ops`（节点开发调试 SOP，必做）
- **流程**（草案）：
  ```
  1. comfyui_read_source 读目标节点（确认结构：__init__.py 注册、前端 js、依赖）
  2. comfyui_edit_source 修改（Python 节点逻辑 or 前端）
  3. comfyui_reload 重启 ComfyUI（讲清会中断生成；确认无运行中任务）
  4. 画布 comfyui_run 跑一个用该节点的最小工作流验证
  5. comfyui_get_outputs 看结果 → 不达标回 step 2 迭代
  ```
- **安全注意**：改的是 `custom_nodes/` 下的节点源码（本机文件）——写操作先确认、讲清改哪个文件；重启前检查是否有运行中任务
- **边界**：开发调试「已有/正在开发的」节点，**不新增生成节点、不改生成逻辑**——与 §1 决策一致

#### C3. 与 admin / canvas 技能的关系
- `comfyui-admin-ops` = 运维（配置/启动/升级/节点管理），**不含开发调试**
- `comfyui-dev-ops` = 开发调试（读/改/重启/验证），独立成核心功能
- `comfyui-canvas-ops` = 用画布干活（作图/出图），供 dev 技能复用其 `run` 验证环节

---

## 3. 架构边界原则（沿用 v0.1.1，不跨层）

| 操作 | 归属 | 执行路径 |
|---|---|---|
| 文件传输（本机文件 ↔ ComfyUI input/） | **host** | 直连 ComfyUI 原生上传/读端点，不经过 bridge |
| 画布节点操作（增删连改/运行） | **host + bridge** | `/dsh-bridge/command` → 前端 LiteGraph |
| 读取执行结果 / 产物 | **host** | 直连 `/history/:id` + `/view` |
| 技能包（SOP 编排） | **host** | `ctx.skills.register` 或 skill-filesystem |
| 节点源码读写 / 重启 ComfyUI（开发调试 C） | **host** | 直连 `custom_nodes/`（fs）+ shell 重启，不经过 bridge |

> 一句话：**「本机文件 ↔ ComfyUI 文件」走 host + 原生 API；「动画布 / LiteGraph」走 bridge command；「读结果」走原生 API；「教 agent 怎么串」走 skill。** 不要跨层。

---

## 4. 实施步骤（实现时照此执行）

```text
step 1  读本规划 + 两张架构图 + NEXT-VERSION-PLAN.md → npm run check 确认基线
step 2  通用文件传输 A1：comfyui_attach_file（host lib/index.js）
        - 泛化上传：按扩展名推断 mediaType，走原生上传端点
        - 决策：attach_image 保留为别名 or deprecated（实现时定）
step 3  A2：get_outputs 返回 fileUrl/localPath（不限图片）
step 4  A3：画布会话框「+ 文件」入口（client lib/client.js）
        - 先探开放问题 #1（浏览器路径传递）——硬前置
        - 新增按钮 + 文件选择器 + 上传调用 + 对话反馈提示
step 5  技能包 B：ctx.skills.register 内嵌（或 .agents/skills 文件版）
        - 注册 comfyui-canvas-ops（必做）+ comfyui-admin-ops（必做）
        - 可选 comfyui-video-audio-ops（音画创作）
step 5.5 DSH 核心改动处理（§5.5，先 C 后 A）
        - 实现前调研 DSH navIcon 是否支持插件注册通道（决定 A 可行否）
        - 可行 → 插件注册图标，还原核心两个文件，删 patches 备份
        - 不可行 → 把补丁恢复步骤写进 README（方案 B）
step 6  核心功能 C：节点开发调试工具（host lib/index.js）
        - comfyui_read_source（读 custom_nodes/<name>/ 源码）
        - comfyui_edit_source（受控写文件）
        - comfyui_reload（重启 ComfyUI）
        - 注册 comfyui-dev-ops 技能（开发调试 SOP）
step 7  三处同步（源码 → node_modules 副本 → E 盘 custom_nodes，若涉及 bridge）
        - node --check + python -m py_compile
step 8  真机验证（ComfyUI 运行中）
        - attach_file：mp4/wav/glb 上传 → input/ 可见 → Load 节点可选到
        - get_outputs：视频/音频/3D 工作流 → 返回 URL/路径
        - 会话框「+ 文件」：多选上传 → 对话提示成功/失败
        - 技能包：让 agent 跑一次画布作图，观察是否按 SOP 执行
        - 开发调试：改一个节点（如 bridge）→ reload → 画布 run 验证
step 9  README（中/英）：
        - What you get 补「通用文件传输」+「技能包」+「节点开发调试」
        - 工具计数更新（12 → 16/17，视 attach_image 去留）
step 10 npm run check → git commit → 三处同步
step 11 版本号 0.1.1 → 0.1.2（package.json 两副本同步）
step 12 发布（npm publish + awesome-dsh-plugin 收录信息若有变更）
```

---

## 4.5 已完成事项（v0.1.2 前期，2026-09-02）

> 这些在方案定稿前已经落地并推送（`dfbba07` / `92474a0`），记录在此避免重复实施。

### 市场素材已上线
- `docs/screenshots/` 三张演示图（01 启动提示 / 02 画布就绪 / 03 工作流出图）
- `screenshots.json`（package.json 旁，裸数组列相对路径）
- README 中英各嵌主图（`docs/screenshots/03-workflow-output.png`）
- `package.json` `files` 已含 `screenshots.json` + `docs`
- 已推送到 GitHub main（`7e3cd84..92474a0`）
- 待 awesome-dsh-plugin 聚合刷新后市场卡片显示截图（被动等待，无需操作）

### 设置导航图标（核心改动 §5.5）已落地
- 见 §5.5 完整记录；核心已还原、非侵入式图标生效、已推送

### npm publish 已完成（2026-09-02）
- ✅ `dsh-comfyui-canvas@0.1.1` 已发布到官方 registry（https://www.npmjs.com/package/dsh-comfyui-canvas）
- 包名未被占用；`files` 覆盖 LICENSE/README/lib/comfyui-bridge/screenshots.json/docs
- 安装命令已更新为 `dsh plugin add dsh-comfyui-canvas`（npm 方式）
- 发布 SOP：改版本号 → `npm config set registry https://registry.npmjs.org` → `npm publish`
- ⚠️ 注意：账户已开 2FA（安全密钥/Passkey）；发布用 granular token（bypass 2FA，90 天有效，约 2026-12 到期）

### 通用文件传输 A1 + A2 已实现（2026-09-02，`a73ffd4`）
- ✅ `comfyui_attach_file`（host `lib/index.js`）：任意文件（image/audio/video/3D）上传进 ComfyUI `input/`，`mediaTypeOf` 按扩展名推断，可选 `nodeId`+`widgetKey` 指向 Load 节点
- ✅ `comfyui_get_outputs` 泛化：扫描 `images/videos/gifs/audio` 四种 kind，每条带 `kind` + `/view` URL
- 已同步 node_modules 副本、已推送 GitHub

### 技能包 B 已实现（2026-09-02，`d1c3d07`）
- ✅ `ctx.skills.register` 内嵌三个 runtime 技能（随插件分发、零步骤）：
  - `comfyui-canvas-ops`（画布操作 SOP：读→确认→改→跑→取回→自检）
  - `comfyui-admin-ops`（环境管理 SOP：配置/启动/升级/节点管理）
  - `comfyui-video-audio-ops`（音画创作 SOP：视频+配音/音轨）
- `inject` 加 `skills`；技能内容中英双语、含安全约定
- 已同步 node_modules 副本、已推送 GitHub

### 剩余（见 §4 实施步骤）
- A3 画布会话框「+ 文件」通道（client 侧，硬前置：浏览器路径传递）
- C 节点开发调试（`read_source` / `edit_source` / `reload` + `comfyui-dev-ops` 技能）

---

## 5. 不做清单（明确排除，防范围蔓延）

- ❌ 视频/音频播放器、3D 查看器（DSH 生态的事）
- ❌ ComfyUI **新增生成节点** / 改生成逻辑（工作流保持原生）——注意：**开发调试已有节点**（核心功能 C）不算此列，C 只读写/重启已有节点，不新增生成能力
- ❌ DSH 核心附件系统扩展（不碰核心，只在插件层做文件传输）
- ❌ 独立 TTS 服务（音频只是通用文件传输的一类输入）

---

## 5.5 DSH 核心改动处理（必须收尾，v0.1.2 范围）

### 现状与处理结果（2026-09-02 已完成）

插件 v0.1.1 曾为给设置面板加 ComfyUI 导航图标，**侵入式改过 DSH 核心** `packages/client/ui-settings-general`（新增 `ComfyUIIcon.tsx` + 改 `SettingsRoot.tsx` 的 `navIcon()`）。该改动在 v0.1.2 已**彻底移除**，改为**非侵入式**：

**做法（启发自 `dsh-better-sidebar` 的 `settings-nav-icon.ts`）**：
- DSH 的 `settings.section` slot 只投影 `id/order/label`，**无图标位**；`navIcon()` 是硬编码 if 链
- 非侵入式方案：插件 `lib/client.js` 里用 **MutationObserver** 找到「文字 == 本插件 label」的设置导航按钮 → 打 `data-` 标记 → 用插件自身 CSS 的 **SVG mask**（`currentColor` 跟随主题）把核心齿轮替换成 ComfyUI 方形 C 图标
- 全程**不碰 DSH 核心**；`ctx.effect` 包装，重载/卸载自动 dispose，HMR 安全

**已落地**：
- `lib/client.js` 新增 `registerSettingsNavIcon` + `injectSettingsNavIconStyles`（图标 mask 用官方 ComfyUI 方形 C 的 path）
- 图标源文件：`docs/comfyui-nav-icon.svg`（官方 C 形，非手绘）
- DSH 核心已还原：删 `ComfyUIIcon.tsx`、还原 `SettingsRoot.tsx`，git 干净
- 删除 `patches/dsh-core-navicon-backup/`

**为什么必须处理**（已解决）：
1. DSH 升级冲突/丢失 —— ✅ 不再改核心，升级无冲突
2. 发布孤立 —— ✅ 图标随插件 `lib/client.js` 分发
3. 装饰性改动理应有非侵入做法 —— ✅ 照社区成熟模式实现

**残留关注**：DSH 核心 `navIcon()` 仍无「插件图标注册」通道（这是 DSH 核心能力缺口，非插件可单独解决）；若未来 DSH 开放该通道，可再简化。当前非侵入式方案稳定可用，无需依赖。

### 涉及文件（本次）
- `lib/client.js`（+registerSettingsNavIcon / +injectSettingsNavIconStyles / apply 调用）
- `docs/comfyui-nav-icon.svg`（官方 C 形图标源）
- DSH 核心 `ui-settings-general`（还原）
- 本方案文档（本段）

---

## 6. 风险与注意

- **上传端点**：ComfyUI 原生上传走 `/upload/image`（input 目录统一入口），音频/视频/3D 文件同样入 `input/`，配合原生 Load 节点消费——**已确认原生支持，无需自定义端点**；实现时用对应 Load 节点（LoadAudio/LoadVideo/3D 加载）验证文件名/路径约定即可
- **浏览器路径传递（A3 硬前置）**：`<input type="file">` 给的是 File 对象、不是绝对路径，而 `attach_file` 收 `path`——客户端 → host 传参通道需先确认（开放问题 #1）
- **3D 文件体积**：glb 通常大，上传/取回注意体积与超时
- **技能包触发**：runtime skill 要写清「触发条件」，避免误触发；skill 内容用中英双语（模型可能看任一种）
- **开发调试（C）风险**：`edit_source`/`reload` 会改本机 `custom_nodes/` 并重启 ComfyUI——写操作先确认、重启前查运行中任务；改坏了节点可能让 ComfyUI 起不来（应保留备份/可回退，`reload` 提供失败恢复说明）
- **版本号策略**：按用户指定，本次 **0.1.1 → 0.1.2**（新增能力做小版本增量）
