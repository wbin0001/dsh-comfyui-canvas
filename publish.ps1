# dsh-comfyui-canvas — npm publish 一次性脚本（v0.1.1）
# 在真机 PowerShell 里运行（沙箱网络/缓存受限，必须在真机执行）
#
# 用法：cd 到脚本所在目录后执行  .\publish.ps1
# 前置：npm 账号已登录（npm adduser 浏览器授权）

$ErrorActionPreference = 'Stop'
$repo = 'F:\Deepseek-harness\projects\dsh-comfyui-canvas'
Set-Location $repo

Write-Host "=== 1. 切到官方 registry ===" -ForegroundColor Cyan
npm config set registry https://registry.npmjs.org
Write-Host "registry: $(npm config get registry)"

Write-Host "`n=== 2. 确认登录 ===" -ForegroundColor Cyan
$who = npm whoami 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "未登录，开始登录（浏览器会弹出授权）..." -ForegroundColor Yellow
    npm adduser
}
Write-Host "已登录: $(npm whoami)"

Write-Host "`n=== 3. 确认包未被占用 ===" -ForegroundColor Cyan
npm view dsh-comfyui-canvas version 2>$null
if ($LASTEXITCODE -eq 0) { Write-Host "包已存在（版本号冲突则无法发布）" -ForegroundColor Yellow }

Write-Host "`n=== 4. 干跑检查发布内容 ===" -ForegroundColor Cyan
npm pack --dry-run

Write-Host "`n=== 5. 确认版本号 ===" -ForegroundColor Cyan
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
Write-Host "即将发布: dsh-comfyui-canvas@$ver"

Write-Host "`n=== 6. 发布 ===" -ForegroundColor Cyan
npm publish

Write-Host "`n=== 7. 验证 ===" -ForegroundColor Cyan
npm view dsh-comfyui-canvas version

Write-Host "`n=== 8. 恢复镜像 registry（可选）===" -ForegroundColor DarkGray
# npm config set registry https://registry.npmmirror.com

Write-Host "`n✅ 发布完成！用户即可用: dsh plugin --profile web add dsh-comfyui-canvas"
