$ErrorActionPreference = "Stop"

$appDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Giaoviec Desktop Reminder.lnk"
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $npm
$shortcut.Arguments = "start --prefix `"$appDir`""
$shortcut.WorkingDirectory = $appDir
$shortcut.WindowStyle = 7
$shortcut.Description = "Nhac Viec Shop desktop reminder"
$shortcut.Save()

Write-Host "Da cai chay cung Windows: $shortcutPath"
