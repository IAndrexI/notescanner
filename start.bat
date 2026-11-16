@echo off
setlocal
title RocketScan for Seafile
cd /d "%~dp0"

echo ===================================================
echo   RocketScan for Seafile (Windows Desktop Launcher)
echo ===================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not found in your PATH.
    echo Please install Node.js (v18+) from https://nodejs.org/ to run RocketScan.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [INFO] Installing required dependencies...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Dependency installation failed.
        pause
        exit /b 1
    )
)

if "%1"=="--server" goto :run_server

if exist "node_modules\electron" (
    echo [INFO] Launching RocketScan Standalone Desktop Application...
    call npm run start:desktop
    goto :done
)

:run_server
echo [INFO] Starting RocketScan Web Server on http://localhost:3000...
start http://localhost:3000
call npm start

:done
pause
