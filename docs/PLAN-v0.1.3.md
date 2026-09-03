# dsh-comfyui-canvas v0.1.3 方案

> 目标：从「画布遥控器」进化为「可复现的创作工作台」——补齐运行溯源、输出不覆盖、项目目录三大能力（P0），加画布文件上传通道（A3，v0.1.2 搁置项）与失败结构化诊断（P1）。
> 依据：第三方评估报告（2026-09-02）的 6 项优化建议 + v0.1.2 收尾时搁置的 A3。

## 1. P0-1：运行溯源 `.runs.json`（~30 行）

**问题**：`comfyui_run` 返回 promptId 后，批量跑多个 seed/prompt 变体，无法追溯「哪张图对应什么参数」。

**方案**：host 端在每次 run/batch_run 时记录 `{ promptId, overrides, timestamp, status }` 到内存；`get_outputs` 下载时把记录 append 到 `downloadDir/<workflow_name>.runs.json`（无则新建）。

```json
[
  { "run": 1, "promptId": "abc123", "overrides": [{"nodeId":6,"key":"seed","value":42}],
    "timestamp": "2026-09-02T22:00:00Z", "status": "success", "files": ["char_ref.01.png"] }
]
```

**价值**：可复现是创作的命脉。agent 读 `.runs.json` 对比历史运行，用户追溯任意一张图的来源参数。

## 2. P0-2：输出不覆盖命名（~20 行）

**问题**：ComfyUI `output/` 用自带命名规则，批量跑后文件混乱、可能互相覆盖。

**方案**：`get_outputs` 下载时新增 `outputStem` 参数（可选）。扫描 `downloadDir` 已有 `<stem>.NN.<ext>` 文件，NN 自增不覆盖。

**价值**：批量跑 20 个变体后文件名直接反映顺序，永不覆盖。

## 3. P0-3：项目目录概念（~15 行）

**问题**：导出的 API JSON、下载的图片、溯源文件散落各处。

**方案**：ConfigSchema 新增 `projectDir` 字段。`get_outputs` 下载、`export_api` 导出、`.runs.json` 默认落在 `projectDir/<workflow_name>/`；未设时回退现有行为（不破坏兼容）。

**价值**：一个创作项目的所有资产（工作流/输出/溯源）聚在一起，agent 用文件工具管理整个项目。

## 4. A3：画布会话框「+ 文件」通道 —— 已砍（2026-09-03 决策）

**原内容**：画布会话框加「+ 文件」按钮，直接传本地文件进 ComfyUI `input/`。

**硬前置**：浏览器 `<input type="file">` 给的是 File 对象、不是绝对路径，而 `attach_file` 收 `path`——需先确认 client → host 传参通道（v0.1.2 方案开放问题 #1）。

**砍的原因**：A1（host 侧 `attach_file`）已让 agent 能传任意文件（含文本/提示词），A3 只是「手动点按钮直传」的锦上添花，浏览器路径传递是硬前置、收益边际低。**留 v0.2+ 或不做**。若有需要，降级方案：agent 引导用户给路径，无需 UI。

## 5. P1：运行失败结构化诊断（~40 行）

**问题**：`run` 失败只返回 HTTP 错误或 `node_errors`，无法定位具体节点异常。

**方案**：`run` 的 sendCommand 返回后，若 nodeErrors 非空，自动 GET `/history/{promptId}` 提取 `execution_error`，结构化返回：

```json
{
  "promptId": "abc123", "success": false,
  "nodeErrors": {"7": ["missing required input 'model'"]},
  "executionError": { "nodeId": 7, "nodeType": "CheckpointLoaderSimple",
    "exception": "FileNotFoundError", "message": "Checkpoint file not found: sd_xl_base.safetensors" }
}
```

**价值**：agent 直接定位「节点 7 缺 checkpoint」并修复，不用看一堆 JSON。

## 6. 本版顺手修复

- ✅ `get_outputs` 无限超时（已修）：history fetch 15s、文件下载 fetch 30s 超时（`AbortSignal.any([exec.signal, timeout])`）
- 桥接鉴权告警（设置页 + 画布激活，host 代理探测）——已实现（v0.1.2 后补，随 v0.1.3 发布）
- ✅ `attach_file` 文本/提示词上传（`d58d302`）：mediaType 映射新增 txt/md/json/csv/yaml/yml/srt——提示词/批量提示词 JSON 等文本可直接进 ComfyUI `input/` 供文本类 Load 节点消费

### 文件上传支持矩阵（`attach_file`，2026-09-03）

| 类别 | 扩展名 | mediaType |
|---|---|---|
| 图片 | png / jpg / jpeg / webp / gif | image/* |
| 音频（含音乐） | wav / mp3 / ogg / flac / m4a / aac | audio/* |
| 视频 | mp4 / webm / mov / mkv / avi | video/* |
| 3D | glb / gltf / obj / fbx / stl | model/* |
| **文本/提示词** | txt / md / json / csv / yaml / yml / srt | text/plain、application/json、text/markdown、text/csv、application/yaml、application/x-subrip |
| 其他 | 任意 | application/octet-stream 透传 |

## 不做清单（范围控制）

- ❌ WebSocket 推送替代轮询（P2，改动大，收益中等，留 v0.2）
- ❌ 工作流链式组合（P1，单链封装 set_param+run，可用性待验证）
- ❌ src/ + 构建管线、CI、DOM 选择器集中管理（工程化，独立排期）
- ❌ `/dsh-bridge/report` 鉴权（localhost-only 已可接受，远期选项）

## 实施步骤

```
step 1  P0-1 `.runs.json`：host 记录 run/batch_run 元数据 → get_outputs 下载时 flush
step 2  P0-2 输出不覆盖命名：get_outputs 加 outputStem，NN 自增
step 3  P0-3 项目目录：ConfigSchema 加 projectDir → get_outputs/export_api 默认路径
step 4  P1 失败诊断：run 失败自动拉 /history/{pid} execution_error
step 5  A3 画布上传通道：探 client→host 传参通道；不可行则降级/砍
step 6  README 更新（P0 三项 + 新工具/参数说明）+ 版本号 0.1.2 → 0.1.3
step 7  npm run check → 同步三处 → 提交推送 → npm publish → GitHub Release
```

## 参考

- 第三方评估报告（2026-09-02）：6 项优化建议，P0 三项 ~65 行
- v0.1.2 方案 `docs/PLAN-v0.1.2.md` §4.5「剩余」：A3 移入 v0.1.3
