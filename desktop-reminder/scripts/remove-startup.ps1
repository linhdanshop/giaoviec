$ErrorActionPreference = "Stop"

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Giaoviec Desktop Reminder.lnk"

if (Test-Path -LiteralPath $shortcutPath) {
  Remove-Item -LiteralPath $shortcutPath -Force
  Write-Host "Da go auto-start: $shortcutPath"
} else {
  Write-Host "Khong tim thay shortcut auto-start."
}
