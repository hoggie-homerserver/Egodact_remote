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
echo Starting Egodact Remote in anywhere mode...
echo Keep this window open; the public link is printed below.
echo.

node "agent\anywhere.js" %*

echo.
echo Remote stopped.
pause
