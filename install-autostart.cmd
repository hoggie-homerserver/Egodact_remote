@echo off
cd /d "%~dp0"
if exist "EgodactRemote.exe" (
  "EgodactRemote.exe" --install-startup
) else (
  echo EgodactRemote.exe not found. Build or download the PC release first.
)
pause
