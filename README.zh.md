# dsh-comfyui-canvas（DSH 画布插件）

把 **ComfyUI**（本地或云端）以分屏画布标签嵌入 [DeepSeek Harness](https://github.com/DeepSeek-Harness/DSH) Web，把 DSH 的 LLM 能力与 ComfyUI 的生成能力合成**一个可视化创作平台**——agent 在对话里激发创意、书写提示词与脚本，实时落到你眼前的画布上，产出图像、音乐、视频、3D。从灵感到成品，全程不离开对话，不用切换任何前端工具：

- **画布操作**：搭建编排、读写工作流、修改节点、连线、运行、调整参数、工作流查错——所见即所得，实时落在你眼前的画布上
- **生产任务**：批量扫参（`batch_run`）、自动取回出图（`get_outputs`）带回对话，实现图像、音乐、视频、3D 等多任务智能创作与批量生产
- **环境维护**：一键启动 ComfyUI、一键升级核心与全部自定义节点（`upgrade`），省心维护不间断

本仓库集成了 **DSH 侧插件（画布副驾）+ ComfyUI 侧桥接节点**。需要无人值守 / 规模化执行时，可配合官方 ComfyUI MCP 服务器使用——见[「画布驱动 vs MCP」](#画布驱动-vs-mcp两种操控-comfyui-的方式)。

---

## 功能特性

| 能力 | 说明 |
|---|---|
| **画布标签页** | 对话里新增 `ComfyUI` 标签，左边画布、右边对话 rail 分屏。iframe 常驻不重载，切标签秒回。 |
| **可视化画布副驾** | agent 操作**你正在看的画布**——节点出现、连线接上、参数变化、运行触发，全部实时显示在屏幕上，每一步都看得见，而不是黑盒改 JSON。出图经 `comfyui_get_outputs` 直接带回对话。 |
| **画布操作工具** | `comfyui_read_workflow` / `add_node` / `connect` / `set_param` / `remove_node` / `load_workflow` / `run` / `debug`——在活画布上搭建与修复工作流。 |
| **生产工具** | `comfyui_batch_run` 一次扫参数矩阵（seed / prompt / 强度）；`comfyui_get_outputs` 把出图直接带回对话。 |
| **维护工具** | `comfyui_upgrade` 一键升级 ComfyUI 核心与全部 git 自定义节点；`comfyui_config` 报告当前连接与画布专注状态。 |
| **画布专注模式（会话隔离）** | agent 通过 `comfyui_config` 感知当前会话是否在画布标签，只在画布场景专注画布操作，且**按会话隔离**——多个会话互不干扰。 |
| **ComfyUI 报错处理** | `debug` 校验工作流并高亮报错节点（纯校验，不触发执行），agent 帮你定位/修复画布错误。 |
| **设置页** | ComfyUI 地址 / 端口 / 网络模式 / 桥接 Token / 启动命令 / 右侧面板宽度，实时生效。 |
| **对话栏增强** | 图片预览并入输入框、`+` 号上传本地图片（走 DSH 官方附件通道）、画布上的授权弹窗、发送按钮贴右下角。 |

---

## 安装

### 1. 安装 DSH 插件

```bash
dsh plugin add github:<你的用户名>/dsh-comfyui-canvas
```

或本地安装：

```bash
# 在 DSH profile 目录下
pnpm add <本仓库路径>
```

插件自带 `cordis.patch.yml`（通过 `dsh.bundle.patch` 声明），装完自动挂载，无需手改配置。

### 2. 安装 ComfyUI 桥接节点

agent 工具通过 `/dsh-bridge/*` 与 ComfyUI 页面通信。桥接节点**已内嵌在仓库** `comfyui-bridge/ComfyUI-DSH-Canvas`，把它复制进 ComfyUI 的 `custom_nodes`：

**Windows（PowerShell / cmd）：**

```powershell
# 方式一：从仓库 checkout 复制
Copy-Item -Recurse comfyui-bridge\ComfyUI-DSH-Canvas <ComfyUI>\custom_nodes\ComfyUI-DSH-Canvas
```

**macOS / Linux（bash）：**

```bash
# 方式一：从仓库 checkout 复制
cp -r comfyui-bridge/ComfyUI-DSH-Canvas <ComfyUI>/custom_nodes/ComfyUI-DSH-Canvas
```

`dsh plugin add` 安装后，已安装的插件里也带这份桥接节点：

```bash
# Windows（PowerShell）
Copy-Item -Recurse (npm root -g)\dsh-comfyui-canvas\comfyui-bridge\ComfyUI-DSH-Canvas <ComfyUI>\custom_nodes\ComfyUI-DSH-Canvas

# macOS / Linux
cp -r $(npm root -g)/dsh-comfyui-canvas/comfyui-bridge/ComfyUI-DSH-Canvas <ComfyUI>/custom_nodes/ComfyUI-DSH-Canvas
```

然后重启 ComfyUI 并打开一次画布页面（注入的 `bridge.js` 会上报画布状态并监听命令）。

### 3. 配置

打开 **设置 → ComfyUI 画布**，填写 ComfyUI 地址（默认 `http://127.0.0.1:8188`）、端口、网络模式、可选桥接 Token、启动命令和右侧面板宽度。

**启动命令**按平台不同：

| 平台 | 示例 |
|---|---|
| Windows | `ComfyUI启动器.bat`（或 `python main.py`） |
| macOS | `python main.py` 或 `./start.sh` |
| Linux | `python main.py` 或 `./start.sh` |

---

## 安全

桥接（`/dsh-bridge/*`）是本插件给 ComfyUI 新增的唯一网络面。把 ComfyUI 暴露到回环地址之外之前请先读这里。

- **信任模型**。默认桥接无鉴权，与 ComfyUI 自身 `/prompt` 的信任模型一致——任何能访问 ComfyUI 端口的人都能读画布、上报状态、下发命令（`load_workflow`/`run` 会消耗 GPU）。前端有命令白名单，**无法**执行任意代码，但这个面是真实存在的。
- **绑定回环**。除非确有局域网/云端需求，请让 ComfyUI 保持 `127.0.0.1`。`networkMode` 只是信息性字段；实际绑定取决于 ComfyUI 启动时的 `--listen`。
- **可选共享 Token**。在 **设置 → ComfyUI 画布 → 桥接 Token** 里填一个 Token，同时用相同值启动 ComfyUI（给它自己的环境变量 `DSH_BRIDGE_TOKEN=...`）。启用后，每个**由 agent 发起**的请求——读画布、下发命令、轮询结果——都必须携带 `Authorization: Bearer <token>`；host 端自动带上，bridge 端拒绝没有 Token 的请求。前端自身的状态上报（`/report`、结果回传）保持开放，因为注入页面无法持有 Token；这些端点只改动内存快照、从不触发执行。两端都留空则保持默认开放行为。
- **多标签页安全**。命令会定向到「最近上报的前端」（`clientId`），所以同时开着多个 ComfyUI 标签页不会各自执行一次命令。

---

## 平台支持

支持 **Windows / macOS / Linux**。agent 工具通过纯 HTTP（`/dsh-bridge/*`）与 ComfyUI 通信，插件本身不依赖任何平台特性——只有**复制命令**和 **ComfyUI 启动命令**因平台而异，上面都已分别说明。

---

## 使用

1. 打开一个会话，切换到 **ComfyUI** 标签——左边是画布，右边是对话。
2. 直接让 agent 干画布活：
   - *“读取当前工作流”*
   - *“给 KSampler 设 seed 为 42”*
   - *“检查画布有没有报错”*
   - *“运行一次”*
3. agent 会先读 `comfyui_config` 确认当前在画布模式，然后专注画布操作。

### 画布驱动 vs MCP——两种操控 ComfyUI 的方式

本插件是**画布驱动**：它看到并编辑用户**正在看的那张活画布**（加节点、连线、改参数、运行，并用 `comfyui_get_outputs` 取回本次出图、用 `comfyui_batch_run` 扫参），无需保存工作流文件。

如果要做**流水线/无人值守**类的批量任务，还可以在 DSH profile 里挂官方 **ComfyUI MCP 服务器（comfy-cli）**——那是一整套独立工具，本插件**刻意不重复实现**：

| 能力 | 本插件（画布） | ComfyUI MCP 服务器（comfy-cli） |
|---|---|---|
| 操作用户正在看的活画布 | ✅ | — |
| 直接运行已保存 / API 格式工作流文件 | ✅（经画布） | ✅（直接） |
| 批量排队 + 取回输出图 | ✅（`batch_run` + `get_outputs`） | ✅（`run_workflow` + `fetch_outputs`） |
| 官方工作流模板 | — | ✅（`templates`） |
| 模型下载 / 管理 | — | ✅（`models`） |
| 托管 / 付费模型（Flux、Veo…） | — | ✅（`partner`） |
| 图结构预检（validate / 依赖） | ✅（`debug`，本地） | ✅（`validate`，服务端） |

**推荐分工**：在画布上**构建/调优**工作流时用本插件；需要**以相同图无人值守规模化执行**（批量流水线、模板、模型管理、托管模型）时用 MCP 服务器。两者连的是同一个 ComfyUI 实例，可并存使用。接入方式：

```bash
dsh plugin add github:Comfy-Org/comfy-cli   # 并在 profile 里配置其 MCP transport
```

---

## 环境要求

- DeepSeek Harness Web（DSH），Node `^22.19.0 || >=24`
- 运行中的 ComfyUI（默认本地 `127.0.0.1:8188`，云端需自行部署桥接节点并确保 DSH 可达），且已装桥接节点
- 浏览器打开过 ComfyUI 画布页（画布标签会自动加载）

---

## 开发

```bash
npm run check   # node --check 校验 lib 两个文件
```

插件位于 DSH profile 的 `node_modules/dsh-comfyui-canvas`；`lib/index.js` 是 host 端工具、`lib/client.js` 是 web 端，改完重启 DSH 生效。

---

## 仓库结构

```
dsh-comfyui-canvas/
├── cordis.patch.yml          # DSH bundle 加载层（自动挂载）
├── comfyui-bridge/           # ComfyUI 侧桥接节点（随仓库发布）
│   └── ComfyUI-DSH-Canvas/
│       ├── __init__.py       # ComfyUI 服务端 /dsh-bridge/* 路由
│       └── entry/bridge.js   # 注入画布前端：上报画布 + 执行命令
├── lib/
│   ├── index.js              # DSH host：12 个画布工具 + 会话隔离模式
│   └── client.js             # DSH web：画布标签 / 设置页 / 对话栏增强
├── LICENSE
├── README.md
├── README.zh.md              # 本文档
└── package.json
```

**桥接节点**是唯一的 ComfyUI 侧依赖：它暴露 `/dsh-bridge/workflow | report | command | result`，并通过 `app.registerExtension` 注入画布页面；没有它 agent 工具就够不到画布。

---

## 许可证

MIT
