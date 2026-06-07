@echo off
title Usta Bazar - Backend API
cd /d "%~dp0backend"
if not exist node_modules (
  echo Paketlar o'rnatilmoqda...
  call npm install
)
echo.
echo ========================================
echo   USTA BAZAR API v1.4.0
echo   http://localhost:3001/api/health
echo   http://localhost:3001/Usta%%20Bazar.html
echo ========================================
echo.
start "" "http://localhost:3001/Usta%%20Bazar.html"
call npm start
pause
