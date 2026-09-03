# dsh-comfyui-canvas v0.1.4 方案（草案）

> **本文档是新会话接手说明书**：下个版本开发请新开会话，先读本文件 + `docs/NEXT-VERSION-PLAN.md`（接手说明）+ `docs/PLAN-v0.1.3.md`（上一版方案），即可接续全部开发意图。
> 状态：**草案**（2026-09-03 起草，未开工；等决定升级本地 DSH 时再执行）
> 前置条件：**本地 DSH 升到 v0.1.2-rc.1**（v0.1.4 的硬前置）

---

## 1. 一句话目标

**适配 DSH 上游 v0.1.2-rc.1 的破坏性 client 更新，让插件在新 DSH（含 DSH Desktop 社区封装）上恢复「分屏画布 + 对话 rail」可用**，顺带把 v0.1.3 搁置的工程化项收尾。

## 2. 背景与根因（必读，避免重踩）

### 2.1 问题现象
- DSH Desktop v2.0.4（社区 Electron 封装，anywhere-labs/dsh-desktop）用户反映：「装插件后右侧面板不显示」——画布只剩全屏 ComfyUI 标签，没有右侧对话 rail。
- 未来本地 DSH 升到 v0.1.2 系列时，同样的现象会在官方版出现。

### 2.2 根因
- 插件 client 基于官方 **v0.1.1-rc.2** 开发，依赖以下契约：
  - `conversation.view` slot 注入（分屏视图）
  - split-rail 分屏结构（`[class*="splitRail"]` 等 CSS hash）
  - client module 加载契约（`window.__ModuleLoader__`）
- 上游 **v0.1.2 系列有破坏性更新**（官方 release note 自述「会导致很多插件不可用」）→ 上述契约变更 → 分屏视图挂不上。

### 2.3 版本事实记录
- 官方 DSH 版本线：全是 **v0.1.x**（最新 release `v0.1.2-rc.1`，2026-09-03）；**没有 2.x**。
- DSH Desktop 的 v2.x 是**桌面壳自己的版本号**（Electron 套壳，官方 Web UI 原样加载），内部跑的上游仍是 0.1.x。
- 本地 DSH = `F:/Deepseek-harness` package.json `version: 0.1.1-rc.2`（当前与插件基线一致 → 兼容）。

## 3. 必做项（P0）

### 3.1 适配上游 v0.1.2-rc.1 破坏性 client 更新
| 子项 | 说明 |
|---|---|
| 本地 DSH 升级 | `0.1.1-rc.2` → `v0.1.2-rc.1`（官方正式候选版，有完整 release notes；升级前确认开发环境回退方案） |
| diff 上游变更 | 对照 v0.1.1-rc.2 → v0.1.2 对 `conversation.view` / split-rail / client module 的破坏性变更 |
| 修 client | `lib/client.js` 按新契约适配（视图注入 / rail 结构 / module 加载） |
| 验证 | 新 DSH 上跑通：分屏画布 + 对话 rail + 设置页 + 导航图标 |
| 同步 | 三副本（源码 → node_modules → E 盘 bridge 如涉及） |

### 3.2 版本声明更新（配套）
- README 中英把「v0.1.2+ 未适配」改为「已适配」（含 v0.1.2-rc.1）
- DSH 徽章版本范围更新

## 4. 候选收尾项（P1/P2，看时间排）

| 项 | 等级 | 来源 |
|---|---|---|
| src/ + 构建管线 | P3 | v0.1.3 不做清单 |
| DOM 选择器集中管理 | P3 | v0.1.3 不做清单 |
| 工作流链式组合（单链 set_param+run，ref→i2v→lipsync） | P1 | 第三方评估建议 |
| `/dsh-bridge/report` 鉴权 | 远期 | localhost-only 已可接受，可选 |

## 5. 明确不做（留 v0.2+）

- ❌ WebSocket 推送替代轮询（改动大，收益中等）
- ❌ A3 画布「+文件」按钮（已砍：A1 attach_file 已覆盖 agent 侧传输，浏览器路径传递收益边际低）

## 6. 实施步骤（草案，实际动手时细化）

```
step 1  升级本地 DSH 到 v0.1.2-rc.1（含回退方案确认）
step 2  diff 上游 client 契约变更（conversation.view / split-rail / module loader）
step 3  修 lib/client.js 适配新契约；host/lib/index.js 如有 API 变更一并适配
step 4  验证：分屏画布 + 对话 rail + 设置页 + 导航图标 在新 DSH 全通
step 5  npm run check + npm test（16 用例应保持绿）→ 三副本同步
step 6  README 版本声明更新（v0.1.2+ 已适配）+ 版本号 0.1.3 → 0.1.4
step 7  git commit → 推送 → npm publish → GitHub Release v0.1.4
step 8  cnb 镜像同步（平台 PR 流水线自动，或 @CodeBuddy 拉取更新）
```

## 7. 风险与注意

- **升级 DSH 本身是重操作**：影响整个开发环境；升级前确认 DSH 本体回退方案（git checkout 旧 tag + 重装依赖）
- **上游 v0.1.2 破坏性更新范围可能超出 client**：host 工具注入 / settings 契约 / peerDeps 版本都要检查
- **DSH Desktop 兼容**：v0.1.4 适配的是官方上游，DSH Desktop 社区版跟随上游后应一并恢复；但社区版可能滞后/超前，仍不保证 100%
- **测试保持绿**：utils.js 测试与 client 改动无关，适配后 16 用例应原样通过

## 8. 参考

- `docs/NEXT-VERSION-PLAN.md` 顶部备忘（2026-09-03）
- `docs/PLAN-v0.1.3.md`（v0.1.3 已交付，不做清单在本版接续）
- 官方 DSH release：`dsh-v0.1.2-rc.1`（2026-09-03，含破坏性更新说明）
- cnb 镜像：`https://cnb.cool/Loxi009/dsh-comfyui-canvas`（定时同步流水线 PR #2）