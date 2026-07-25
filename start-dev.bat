@echo off
title Workspace Platform - Dev Server
color 0A

echo.
echo  ============================================
echo   Workspace Platform - Starting Dev Servers
echo  ============================================
echo.
echo  Frontend:  http://localhost:3000
echo  API:       http://localhost:3001
echo  WebSocket: ws://localhost:3002
echo  Yjs:       ws://localhost:3003
echo.
echo  Press Ctrl+C to stop all servers.
echo  ============================================
echo.

cd /d "%~dp0"

:: Open the browser after a short delay
start "" cmd /c "timeout /t 8 /nobreak >nul && start http://localhost:3000"

:: Start all dev servers via turbo (runs both web + api)
pnpm dev
