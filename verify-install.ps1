# dsh-comfyui-canvas — 新用户安装验证脚本（方案 A）
# 在真机 PowerShell 运行：模拟新用户分别从 npm / GitHub 安装到临时 profile，
# 验证发布物可装、可解析、无 schemastery 坑。不碰现有开发环境。
#
# 用法：cd F:\Deepseek-harness 后执行  .\projects\dsh-comfyui-canvas\verify-install.ps1

$ErrorActionPreference = 'Stop'
$repo = 'F:\Deepseek-harness'
Set-Location $repo

# 1. 临时 profile 名（避免撞名）
$n = 'verify-install-' + (Get-Date -Format 'HHmmss')

Write-Host "`n=== A1. 从 npm 安装（dsh-comfyui-canvas@latest = 0.1.3）===" -ForegroundColor Cyan
& node --import tsx/esm apps/cli/src/bin.ts plugin --profile $n-npm add dsh-comfyui-canvas
if ($LASTEXITCODE -ne 0) { Write-Host "❌ npm 安装失败" -ForegroundColor Red; exit 1 }

Write-Host "`n=== A2. 从 GitHub 安装（main 分支）===" -ForegroundColor Cyan
& node --import tsx/esm apps/cli/src/bin.ts plugin --profile $n-git add github:wbin0001/dsh-comfyui-canvas
if ($LASTEXITCODE -ne 0) { Write-Host "❌ GitHub 安装失败" -ForegroundColor Red; exit 1 }

# 2. 逐项校验两个临时 profile 的已装包
foreach ($p in @("$n-npm", "$n-git")) {
  $pkg = "F:\Deepseek-harness\.dsh\profiles\$p\node_modules\dsh-comfyui-canvas"
  Write-Host "`n=== 校验 profile $p ===" -ForegroundColor Yellow
  if (-not (Test-Path "$pkg\package.json")) { Write-Host "❌ 包未装到 $pkg" -ForegroundColor Red; continue }

  $ver = (Get-Content "$pkg\package.json" -Raw | ConvertFrom-Json).version
  Write-Host "版本: $ver"

  # 语法检查
  node --check "$pkg\lib\index.js" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ lib/index.js 语法错误" -ForegroundColor Red; continue }
  node --check "$pkg\lib\client.js" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Host "❌ lib/client.js 语法错误" -ForegroundColor Red; continue }
  Write-Host "语法: OK"

  # schemastery 坑扫描（zod 风格链式调用，应无残留）
  $bad = Select-String -Path "$pkg\lib\index.js" -Pattern '\.nullable\(|\.optional\(|\.enum\(' -ErrorAction SilentlyContinue
  if ($bad) { Write-Host "⚠️ 发现 zod 风格 schema 残留:" -ForegroundColor Red; $bad | ForEach-Object { "  L$($_.LineNumber): $($_.Line.Trim())" } }
  else { Write-Host "schemastery 坑扫描: 干净" }

  # 关键工具存在
  $tools = (Select-String -Path "$pkg\lib\index.js" -Pattern "name: 'comfyui_" | ForEach-Object { if ($_.Line -match "name: '(comfyui_[a-z_]+)'") { $matches[1] } } | Sort-Object -Unique).Count
  Write-Host "工具数: $tools（期望 19）"

  # 文本/提示词 mediaType 存在
  $txt = Select-String -Path "$pkg\lib\index.js" -Pattern "json: 'application/json'" -ErrorAction SilentlyContinue
  Write-Host "文本上传支持: $(if ($txt) { '✓' } else { '✗' })"
}

Write-Host "`n=== 完成。验证后清理临时 profile：===" -ForegroundColor Green
Write-Host "Remove-Item 'F:\Deepseek-harness\.dsh\profiles\$n-npm' -Recurse -Force"
Write-Host "Remove-Item 'F:\Deepseek-harness\.dsh\profiles\$n-git' -Recurse -Force"
