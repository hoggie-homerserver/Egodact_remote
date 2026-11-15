@echo off
cd /d "%~dp0"
if exist "EgodactRemote.exe" (
  "EgodactRemote.exe" --uninstall-startup
) else (
  echo EgodactRemote.exe not found.
)
pause
