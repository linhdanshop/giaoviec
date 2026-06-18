$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $appDir

Write-Host "Dang cai/cap nhat package..."
npm install

Write-Host "Dang dong goi bo cai Windows..."
npm run dist

Write-Host ""
Write-Host "Da tao bo cai trong thu muc:"
Write-Host (Join-Path $appDir "dist")
Write-Host ""
Write-Host "Copy file .exe trong thu muc dist sang may khac de cai."
