@echo off
title Workspace Platform
color 0A

echo.
echo  ╔══════════════════════════════════════╗
echo  ║      Workspace Platform Starting     ║
echo  ╚══════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: Check if both servers are already running
set "WEB_RUNNING=0"
set "API_RUNNING=0"

netstat -ano 2>nul | findstr ":3009" | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 set "WEB_RUNNING=1"

netstat -ano 2>nul | findstr ":3001 " | findstr "LISTENING" >nul 2>&1
if %errorlevel%==0 set "API_RUNNING=1"

if "%WEB_RUNNING%"=="1" if "%API_RUNNING%"=="1" (
    echo  App is already running! Opening browser...
    start "" "http://localhost:3009"
    timeout /t 2 >nul
    exit
)

echo  Installing dependencies if needed...
call pnpm install --frozen-lockfile >nul 2>&1

:: Start API server (port 3001) in background
if "%API_RUNNING%"=="0" (
    echo  Starting API server on http://localhost:3001 ...
    start /b "" cmd /c "cd /d "%~dp0\packages\api" && npx tsx watch src/index.ts 2>&1"
)

:: Start Next.js dev server (port 3000) in background
if "%WEB_RUNNING%"=="0" (
    echo  Starting Next.js dev server on http://localhost:3009...
    start /b "" cmd /c "cd /d "%~dp0\apps\web" && npx next dev --port 3009"
)

echo.
echo  (This window must stay open. Close it to stop the servers.)
echo.

:: Wait for both servers to be ready
echo  Waiting for servers to start...
:wait_api
timeout /t 2 >nul
curl -s -o nul http://localhost:3001 2>nul
if %errorlevel% neq 0 (
    echo  API server starting...
    goto wait_api
)
echo  ✓ API server ready

:wait_web
timeout /t 2 >nul
curl -s -o nul http://localhost:30092>nul
if %errorlevel% neq 0 (
    echo  Web server starting...
    goto wait_web
)
echo  ✓ Web server ready

echo.
echo  ✓ All servers are ready! Opening browser...
start "" "http://localhost:3009"

echo.
echo  ════════════════════════════════════════
echo   Frontend:  http://localhost:3009
echo   API:       http://localhost:3001
echo   WebSocket: ws://localhost:3002
echo   Yjs:       ws://localhost:3003
echo.
echo   Press Ctrl+C or close this window to stop
echo  ════════════════════════════════════════
echo.

:: Keep the window open so the servers keep running
cmd /k
