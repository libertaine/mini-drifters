@echo off
setlocal
cd /d "%~dp0"
set "NODE="
where node >nul 2>nul && set "NODE=node"
rem Node on PATH is preferred; a portable copy in a neighbouring _tools folder also works.
if not defined NODE for /d %%D in ("%~dp0..\_tools\node-v*") do if exist "%%~fD\node.exe" set "NODE=%%~fD\node.exe"
if not defined NODE (
  echo Node.js 22 or newer is needed. See README.md.
  pause
  exit /b 1
)
rem Opens the browser a moment later, once the server below is listening.
start "" /b cmd /c "ping -n 2 127.0.0.1 >nul & start "" http://127.0.0.1:4190"
"%NODE%" server.mjs
pause
