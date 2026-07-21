@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo AgenticThat Publishing Companion
echo Keep this window open so uploads, schedules, and browser publishing continue to work.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-publishing-companion.ps1"

if errorlevel 1 (
  echo.
  echo The companion stopped with an error. Check logs\publishing-companion.log for details.
  pause
)
