@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed or not in PATH.
  echo Install it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

echo.
echo Starting Egodact Remote agent...
echo Keep this window open while you use the phone app.
echo.

node "agent\server.js"

echo.
echo Agent stopped.
pause
