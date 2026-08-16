@echo off
title BAR 2026 Mock Reviewer & Supreme Court AI Platform
cd /d "%~dp0"
node launcher.js
if %errorlevel% neq 0 (
    echo.
    echo Press any key to exit...
    pause >nul
)
