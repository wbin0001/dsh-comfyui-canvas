# DSH 核心改动备份：ComfyUI 画布设置面板导航图标（大写 C）

本目录备份了为 `dsh-comfyui-canvas` 插件定制 DSH 核心（`packages/client/ui-settings-general`）所需的**两个源码文件**。

> ⚠️ 这是**侵入式修改 DSH 核心**的临时方案。DSH 升级（`git pull`）后，`SettingsRoot.tsx` 可能与上游冲突、`ComfyUIIcon.tsx` 可能因清理丢失。升级后按下方「恢复步骤」重新应用即可。长期建议：推动 DSH 核心为插件开放「设置导航图标」通道，彻底去掉这份补丁。

## 涉及的核心文件

| 文件 | 改动 |
|---|---|
| `src/client/SettingsRoot.tsx` | `navIcon(id)` 增加 `comfyui-canvas` 分支 → 返回 `IconComfyUIOutline16`（+2 行） |
| `src/client/ComfyUIIcon.tsx` | **新增**：大写 C 图标组件（`IconComfyUIOutline16`，fontSize 26，居中） |

> `lib/client.js` 是构建产物（`.gitignore` 忽略、未跟踪），DSH 更新/重建 bundle 时按 `src/` 自动重新生成，**无需备份**。

## 恢复步骤（DSH 升级后）

```powershell
# 1. 目标路径（DSH 核心包）
$core = "F:\Deepseek-harness\packages\client\ui-settings-general\src\client"
$bak  = "F:\Deepseek-harness\projects\dsh-comfyui-canvas\patches\dsh-core-navicon-backup"

# 2. 复制两个源码文件回核心包
Copy-Item "$bak\ComfyUIIcon.tsx"   "$core\ComfyUIIcon.tsx"   -Force
Copy-Item "$bak\SettingsRoot.tsx"  "$core\SettingsRoot.tsx"  -Force   # 若上游改动过需手工合并 navIcon 函数

# 3. 重建 bundle（生成带图标的 lib/client.js）
cd F:\Deepseek-harness
pnpm --filter @deepseek-ai/dsh-client-ui-settings-general bundle

# 4. 重启 DSH（host 加载新 bundle），浏览器刷新
```

## 如果上游 `SettingsRoot.tsx` 已改动（合并冲突）

不要整文件覆盖（会丢上游改动）。只把这段逻辑合并进新文件的 `navIcon(id)`：

```tsx
import { IconComfyUIOutline16 } from './ComfyUIIcon.tsx'
// ...
if (id === 'comfyui-canvas') return <IconComfyUIOutline16 className={css.navIcon} size={16} />
```

同时把 `ComfyUIIcon.tsx` 复制进去，然后按第 3、4 步重建。

## 当前生效状态

- 备份日期：2026-09-01
- 来源版本：DSH `master` @ `aa6c600`；插件 v0.1.1
- 图标规格：大写 C、fontSize 26、居中、`fill="currentColor"`（符合 DSH monochrome outline 约定）
