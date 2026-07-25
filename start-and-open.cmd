@echo off
title Follow — Full Dev Environment
color 0A
cd /d "C:\Dev\Workspace App"

echo.
echo  ========================================
echo   Follow — Starting Full Dev Environment
echo  ========================================
echo.
echo  This will start:
echo    - Docker (Postgres, Redis, ClickHouse, MinIO)
echo    - API Server (:3001)
echo    - Web App (:3009)
echo    - Dev Console Dashboard (:4000)
echo    - ngrok tunnel (if installed)
echo    - Desktop agent (if configured)
echo.
echo  Press Ctrl+C to stop all services.
echo.

npx tsx scripts/launch.ts

if %errorlevel% neq 0 (
    echo.
    echo  ========================================
    echo   ERROR: Launch failed. See above.
    echo  ========================================
    echo.
    pause
)
