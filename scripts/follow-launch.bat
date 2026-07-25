@echo off
title Follow — Launcher
cd /d "C:\Dev\Workspace App"
npx tsx scripts/launch.ts
if %errorlevel% neq 0 (
    echo.
    echo Launch failed. See errors above.
    pause
)
