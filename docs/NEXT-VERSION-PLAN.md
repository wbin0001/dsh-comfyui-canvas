# dsh-comfyui-canvas — 下个版本开发规划（v0.1.1）

> **本文档是「新会话接手说明书」**：下个版本开发请新开一个会话，先读本文件 + `docs/architecture.html`（分层架构）+ `docs/architecture-flow.html`（流程图），即可接续全部开发意图。
> 最后更新：2026-09-03

> **最新状态备忘（2026-09-03，v0.1.3 已发布版之后）**：
> - ✅ **v0.1.3 已发布**（npm `dsh-comfyui-canvas@0.1.3` + GitHub Release v0.1.3）：项目目录 / `.runs.json` 溯源 / `outputStem` NN 命名 / 失败结构化诊断 / 文本·提示词上传 / 鉴权告警；A3（画布「+文件」按钮）已砍。
> - ✅ **测试 + CI 已补**：`lib/utils.js` 抽取纯逻辑（mediaTypeOf / extractExecutionError / nextStemNumber / upsertRun），`test/utils.test.js` 16 个用例（`node:test`，`npm test`），`.github/workflows/test.yml`（check + test + pack，GitHub Actions 已验证绿）。
> - ⚠️ **待办（v0.1.4）：适配官方上游破坏性更新** ——
>   - 现象：DSH Desktop v2.0.4（社区封装版 anywhere-labs/dsh-desktop，内部跑上游 **v0.1.2-alpha.1**）用户反映「装插件后右侧面板不显示」。
>   - 根因：插件 client 基于官方 **v0.1.1-rc.2** 开发（`conversation.view` 注入 / splitRail 分屏 / client module 契约），上游 v0.1.2 系列有**破坏性更新**（官方 release note 自述"会导致很多插件不可用"）→ 分屏视图挂不上，只剩全屏 ComfyUI 标签。
>   - 计划：把本地 DSH 从 `0.1.1-rc.2` 升到官方最新 **`v0.1.2-rc.1`**，在最新上游上验证并修复插件兼容性，发 v0.1.4；同时解决 DSH Desktop 用户兼容。
>   - 事实记录：DSH Desktop ≠ 官方产品（社区封装，Electron 套壳，官方 Web UI 原样加载）；其 v2.x 是桌面壳自己的版本号，上游仍跟随 0.1.x。

---

## 0. 如何接续（先读这里）

下个会话请按此顺序恢复上下文：

1. **读本文档** —— 理解下版本目标、技术边界、实施步骤
2. **读 `docs/architecture.html` / `docs/architecture-flow.html`** —— 在浏览器打开这两张图，理解三侧（浏览器 / DSH Host / ComfyUI）架构
3. **跑一次 `npm run check`** —— 确认当前代码语法可用
4. **确认环境三副本可访问**（见 §1.3）

---

## 1. 项目现状快照

### 1.1 基本信息
- **包名/版本**：`dsh-comfyui-canvas` / `0.1.0`
- **仓库（已开源 Public）**：https://github.com/wbin0001/dsh-comfyui-canvas
- **许可证**：MIT；**语言**：host = JS（ESM），bridge 后端 = Python，bridge 前端 = JS
- **README**：`README.md`（en）+ `README.zh.md`（zh），功能表已按「画布操作 / 生产任务 / 环境维护」三面组织

### 1.2 当前 12 个 agent 工具（host `lib/index.js`）
```
comfyui_read_workflow     读画布（先 refresh_report 再读；无上报返回 ready:false 诊断）
comfyui_add_node          加节点（class + 可选 pos，立即显示在画布）
comfyui_connect           连线 srcId:srcSlot → dstId:dstSlot
comfyui_set_param         改 widget 值（支持 combo 校验 + callback）
comfyui_remove_node       删节点
comfyui_load_workflow     整图替换（兼容 read 结果整对象回传的 unwrap）
comfyui_run               运行（可选 overrides 临时覆盖 widget，跑完还原画布）
comfyui_get_outputs       取回出图（读 /history/:id + /view，可选 downloadDir 落盘）
comfyui_batch_run         参数矩阵批量（runs=[{overrides:[...]}]，逐组入队）
comfyui_debug             纯校验（不触发执行；switch/index 动态槽归 warnings 不报错）
comfyui_config            会话隔离的画布感知 + 连接配置
comfyui_upgrade           git pull 核心 + 全部自定义节点
```

### 1.3 三副本位置（改代码必须三处同步）
| 角色 | 路径 | 说明 |
|---|---|---|
| 源码主仓（权威源） | `F:\Deepseek-harness\projects\dsh-comfyui-canvas` | git 管理，这是改代码的地方 |
| DSH 运行时副本 | `F:\Deepseek-harness\.dsh\profiles\web\node_modules\dsh-comfyui-canvas` | DSH 启动实际加载这份 —— 改完 host/client 要复制过来 |
| ComfyUI 桥接节点 | `E:\AI-ComfyUI\ComfyUI_windows_portable\ComfyUI\custom_nodes\ComfyUI-DSH-Canvas` | 只同步 `comfyui-bridge/` 下的 `__init__.py` + `entry/bridge.js` —— 改 bridge 要复制过来并**重启 ComfyUI** |

> 同步约定：host/client 改动 → 同步到 node_modules 副本；bridge 改动 → 同步到 node_modules 副本 + E 盘 custom_nodes。改完跑 `node --check` + `python -m py_compile`。

### 1.4 关键机制速记
- **bridge 三件套**：`__init__.py`（Python 路由 + 可选 `DSH_BRIDGE_TOKEN` 鉴权 + report 8MB 上限 + clientId 定向）+ `entry/bridge.js`（前端注入，执行白名单命令）
- **命令白名单**（bridge.js `executeCommand`）：`add_node / connect / set_param / remove_node / load_workflow / run / batch_run / validate / highlight / refresh_report`（+ 下版本将加 `inject_text`）
- **画布数据流**：host 工具 → HTTP `/dsh-bridge/command` → bridge 后端 → WebSocket `send_sync` → 前端执行 → POST `/dsh-bridge/result` → host 轮询
- **出图取回**：`get_outputs` 直连 ComfyUI 原生 `/history/:id` + `/view`（不经过 bridge），区分 `output/`（SaveImage 永久）与 `temp/`（PreviewImage 临时）

---

## 2. 下版本目标：v0.1.1 ——「对话产物进画布」

### 2.1 一句话目标
让 **agent 在对话中生成的内容（文本 / 图片）直接作为 ComfyUI 工作流的节点输入**，形成「对话创意 → 画布产出」的闭环，无需手动切工具。

### 2.2 核心新增项（本版本必做）

#### A. 新增工具 `comfyui_attach_image` —— 把图片送进画布
- **职责**：把 agent 本机的一张图片上传进 ComfyUI 的 `input/` 目录，并（可选）更新指定 `LoadImage` 节点的文件名，使其立刻生效
- **实现位置**：**host 端（`lib/index.js`）** —— 走 ComfyUI **原生 `POST /upload/image`** 端点，**不经过 bridge**（源文件在 agent 本机，bridge 无本机路径概念）
- **为什么在 host**：云端 ComfyUI 场景下「DSH 机器」与「ComfyUI 机器」不是同一台，文件读取与上传必须由 host 从本机发起；这正是 ComfyUI 官方 web UI 传图的同一条路
- **接口草案**：
  ```js
  comfyui_attach_image({
    image:   string  // 本机图片绝对路径（必填）
    nodeId?: number  // 可选：指定 LoadImage 节点，上传后自动 set_param 指向新文件名
  })
  // 返回 { filename, subfolder, nodeId?, updated? }
  ```
- **要点**：上传后返回的文件名要与 `LoadImage` 节点 widget `image` 期望的值一致（ComfyUI `/upload/image` 返回的 `name` + `subfolder` 拼进 filename）；可组合 `set_param` 复用现有路径
- **验收**：对话里生成/出现一张图 → `attach_image` → 画布上 LoadImage 显示该图 → `run` 能正常走通

#### B. 新增工具 `comfyui_inject_text` —— 把文本注入节点（含建源连线）
- **职责**：把一段文本写入某节点 widget（如 CLIPTextEncode 的 `text`）；或先 `add_node` 一个 text/primitive 源节点、填值、再 `connect` 到目标节点的输入——即「对话文本作为独立可连线源」
- **实现位置**：**host 注册工具 + bridge 加 command 分支**（画布操作必须由前端 LiteGraph 执行）
  - host `lib/index.js`：定义 `comfyui_inject_text`，拼 command 下发
  - bridge.js `executeCommand` 新增 `inject_text` 分支：`add_node`（若给 class）→ `set_param` → `connect`
- **本质**：现有 `add_node + set_param + connect` 的组合封装，提供「一步到位」的语义
- **日常替代**：若只改已有节点 widget（多数文本场景），`set_param` 已够；`inject_text` 是「要新建源并连线」时的便捷入口
- **接口草案**：
  ```js
  comfyui_inject_text({
    text:      string  // 要注入的文本
    nodeId?:   number  // 可选：目标节点，直接写其 widget（如 text/prompt）
    widgetKey?:string  // 可选：目标 widget 名，默认 "text"
    newClass?: string  // 可选：先新建此类型节点（如 "StringConcatenate"）作源
    targetId?: number  // 可选：把新源节点 connect 到目标节点输入
    targetSlot?:number // 可选：目标输入槽位
  })
  ```
- **验收**：对话生成一段提示词 → `inject_text` → 画布出现新文本节点并接到 CLIP 类节点 → `run` 生效

### 2.3 架构边界原则（重要，写死）
| 操作类型 | 归属 | 执行路径 |
|---|---|---|
| 文件传输（上传图片到 input/） | **host** | 直连 ComfyUI 原生 `/upload/image`，不经过 bridge |
| 画布节点操作（增删连改） | **host 注册 + bridge 分支** | `/dsh-bridge/command` → 前端 LiteGraph 执行 |
| 读取执行结果 / 出图 | **host** | 直连 `/history/:id` + `/view` |

> 一句话：**凡是「本机文件 ↔ ComfyUI 文件」走 host + 原生 API；凡是「动画布 / LiteGraph」走 bridge command；读结果走原生 API。** 不要跨层。

### 2.4 其他候选（按优先级，时间允许再做）
1. `comfyui_export_api` —— 把当前画布导出为 **API 格式 workflow JSON**（供 MCP comfy-cli `run_workflow` 无人值守批量用）—— 打通「画布 ↔ MCP」衔接
2. `batch_run` 增强 —— 支持 zip 式参数矩阵（多字段同步扫）+ 返回每组的 `get_outputs` 摘要
3. 授权审批增强 —— 越权高的命令（`load_workflow`/`run`/`upgrade`）走 pending 审批流（现有授权遮罩已就位，补命令级钩子）
4. README 补「对话产物进画布」用法章节 + 录一段演示 GIF

---

## 3. 实施步骤（新会话照此执行）

```text
step 1  读本文档 + 两张架构图 → 跑 npm run check 确认基线
step 2  实现 A：comfyui_attach_image（host lib/index.js）
        - 复用 bridgeToken/bridgeHeaders 风格；用 fetch 打 /upload/image
        - multipart 构造（FormData/Blob，Node 22 可用）
        - 注意 ComfyUI /upload/image 的字段：image=file, type=input, overwrite=false
        - 可选：返回后调 set_param 更新 LoadImage
step 3  实现 B：comfyui_inject_text
        - bridge.js executeCommand 加 inject_text 分支
        - host 加 comfyui_inject_text 工具（含参数 schema）
step 4  三处同步（源码 → node_modules → E 盘 custom_nodes）
        - node --check（lib 两个 JS + bridge.js）
        - python -m py_compile（__init__.py）
step 5  真机验证（ComfyUI 运行中）
        - attach_image：本机放一张图 → 上传 → 画布 LoadImage 可见 → run 走通
        - inject_text：生成一段提示词 → 注入新节点并连线 → run 生效
step 6  README（中/英）：
        - What you get 表加新工具
        - 新增「对话产物进画布」小节（含 attach_image / inject_text 用法）
        - 12 → 14 工具计数
step 7  npm run check + python -m py_compile → git commit → 三处同步
step 8  发布（见 §4）
```

**新增/修改文件清单（预计）**
- `lib/index.js`：+`comfyui_attach_image`，+`comfyui_inject_text`
- `comfyui-bridge/ComfyUI-DSH-Canvas/entry/bridge.js`：+`inject_text` 分支
- `README.md` / `README.zh.md`：工具表与用法
- `docs/architecture-flow.html`：可选补「对话产物 → 画布」一段

---

## 4. 发布与生态（上版本遗留待办，可一并收尾）

- **npm publish**（让 `dsh plugin add dsh-comfyui-canvas` 可装）
  ```powershell
  cd F:\Deepseek-harness\projects\dsh-comfyui-canvas   # 或新仓库本地路径
  npm config set registry https://registry.npmjs.org   # 当前指向 npmmirror，必须切回官方
  npm adduser                                          # 浏览器授权登录
  npm whoami                                           # 确认用户名
  npm publish                                          # 发布（tarball 已验证干净：无 pyc/缓存）
  ```
  - 已确认：包名 `dsh-comfyui-canvas` 在 npm **未被占用**；package.json `files` 已排除 `__pycache__`/`*.pyc`
- **awesome-dsh-plugin 收录**（让 `dshmarket` 市场可见）
  - 前置：仓库已加 `dsh-plugin` topic ✅；`dsh.bundle` manifest ✅；commit ≥10 ✅；需**仓库创建满 1 天**（CI 硬性检查，2026-09-01 后可提）
  - 提交 PR：在 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的 `data/plugins/` 加一个文件 `wbin0001__dsh-comfyui-canvas.yml`
  - 条目草稿（description 必须属实，会被对照代码检查）：
    ```yaml
    url: https://github.com/wbin0001/dsh-comfyui-canvas
    name: wbin0001/dsh-comfyui-canvas
    category: tools
    description:
      en: 'Embed your ComfyUI as a split-screen canvas in DSH Web and let the agent operate it live: read/write workflows, edit nodes, wire links, run, fetch output images, and batch-sweep parameters straight from the chat.'
      zh: '把 ComfyUI 作为分屏画布嵌入 DSH，agent 可视化操作：读写工作流、改节点、连线、运行、取回出图、批量扫参，全程不离开对话。'
    ```
    > 注意：description 含 `: `（冒号加空格）时必须加引号，详见该仓库 `contributing.md`

---

## 5. 已知事项 / 坑（写死，避免重踩）

- **运行时副本版本号滞后**：node_modules 副本是 0.2.0、源码是 0.1.0——功能一致，仅版本号不同；`npm publish` 后如需统一可重装官方版。当前不处理
- **DSH 侧工具热加载**：host 工具的 `name`/`description` 改动需**重启 DSH** 才注入 agent 工具列表；bridge 改动需**重启 ComfyUI/重开画布页**
- **was-ns 依赖**：ComfyUI venv 的 NumPy 已固定 `<2.4`（启动器会自动校验降级），不要随意升级 numpy，否则 was-ns/numba 报错
- **Cloud ComfyUI**：`networkMode` 支持 cloud-selfhosted/saas；云端需自行部署桥接节点 + DSH 可达 + token 两端一致
- **安全基线**：`/dsh-bridge/*` 保护 host→bridge 通道（token）；前端上报（/report、result）不 gate；report ≤8MB；多标签 clientId 定向；命令无 client_id 时拒绝
- **版本号策略**：v0.1.0 已发布；下版升 **0.1.1**（用户指定——新增工具作为小版本增量推进，不跨次版本号）