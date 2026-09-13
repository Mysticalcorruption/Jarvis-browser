@echo off
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "%~dp0release\Jarvis-win32-x64\Jarvis.exe" (
  start "" "%~dp0release\Jarvis-win32-x64\Jarvis.exe"
  exit /b
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
