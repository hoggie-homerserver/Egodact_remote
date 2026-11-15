$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "Programs\Egodact Remote"
Write-Host ""
Write-Host "  Egodact Remote - Installatie" -ForegroundColor Cyan
Write-Host "  Bron: $src"
Write-Host "  Doel: $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
$items = @("EgodactRemoteTray.exe","EgodactRemote.exe","app.ico","agent","public","companion","tools","start-remote.cmd","start-remote-anywhere.cmd","install-autostart.cmd","uninstall-autostart.cmd","README.md","package.json")
foreach ($it in $items) { $p = Join-Path $src $it; if (Test-Path $p) { Copy-Item $p (Join-Path $dest $it) -Recurse -Force; Write-Host "  + $it" } }
$srcData = Join-Path $src "data"; $dstData = Join-Path $dest "data"
if (!(Test-Path $dstData)) { New-Item -ItemType Directory -Force -Path $dstData | Out-Null }
if (Test-Path $srcData) { Get-ChildItem $srcData -File -ErrorAction SilentlyContinue | ForEach-Object { $target = Join-Path $dstData $_.Name; if (!(Test-Path $target)) { Copy-Item $_.FullName $target -Force } } }
$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
$lnk = Join-Path $startMenu "Egodact Remote.lnk"
$tray = Join-Path $dest "EgodactRemoteTray.exe"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk); $s.TargetPath = $tray; $s.WorkingDirectory = $dest
if (Test-Path (Join-Path $dest "app.ico")) { $s.IconLocation = (Join-Path $dest "app.ico") }
$s.Description = "Egodact Remote - herlaad extensies vanaf je telefoon"; $s.Save()
Write-Host "  + Startmenu-snelkoppeling"
$uninstKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EgodactRemote"
New-Item -Path $uninstKey -Force | Out-Null
Set-ItemProperty -Path $uninstKey -Name "DisplayName" -Value "Egodact Remote"
Set-ItemProperty -Path $uninstKey -Name "DisplayVersion" -Value "1.1.0"
Set-ItemProperty -Path $uninstKey -Name "Publisher" -Value "Egodact"
Set-ItemProperty -Path $uninstKey -Name "InstallLocation" -Value $dest
if (Test-Path (Join-Path $dest "app.ico")) { Set-ItemProperty -Path $uninstKey -Name "DisplayIcon" -Value (Join-Path $dest "app.ico") }
$uPath = Join-Path $dest "uninstall-from-pc.ps1"
Set-ItemProperty -Path $uninstKey -Name "UninstallString" -Value ("powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$uPath`"")
Set-ItemProperty -Path $uninstKey -Name "NoModify" -Value 1 -Type DWord
Set-ItemProperty -Path $uninstKey -Name "NoRepair" -Value 1 -Type DWord
Write-Host "  + Apps & Features registratie"
$u = @(
  'param([switch]$Quiet)',
  '$ErrorActionPreference = "SilentlyContinue"',
  '$dest = Split-Path -Parent $MyInvocation.MyCommand.Path',
  'try { $conn = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue; if ($conn) { $conn | ForEach-Object { taskkill /PID $_.OwningProcess /T /F 2>$null } } } catch {}',
  'Get-Process EgodactRemoteTray -ErrorAction SilentlyContinue | Stop-Process -Force',
  'schtasks /Delete /TN "Egodact Remote" /F 2>$null | Out-Null',
  'Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup\Egodact Remote.lnk") -Force',
  'Remove-Item (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Egodact Remote.lnk") -Force',
  'Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EgodactRemote" -Recurse -Force',
  'if (!$Quiet) { Write-Host "Egodact Remote verwijderd uit Startmenu en autostart."; Write-Host "Bestanden in $dest zijn NIET verwijderd."; pause }'
)
[System.IO.File]::WriteAllLines($uPath, $u, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  + Uninstaller"
Write-Host ""; Write-Host "  Installatie voltooid. Zoek naar 'Egodact Remote' in Start." -ForegroundColor Green; Write-Host ""
