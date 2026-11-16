@echo off
title Update NoteScan from GitHub
cd /d "%~dp0"
echo ==========================================================
echo   Updating NoteScan from GitHub...
echo ==========================================================
git fetch origin main
git reset --hard origin/main
call npm install --omit=dev
echo.
echo ==========================================================
echo   NoteScan successfully updated to latest GitHub version!
echo ==========================================================
pause
