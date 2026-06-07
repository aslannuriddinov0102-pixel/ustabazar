@echo off
title Usta Bazar - Telegram Bot
cd /d "%~dp0"
echo.
echo ========================================
echo   USTA BAZAR TELEGRAM BOT
echo   @UstaBazar_bot
echo.
echo   1) Avval START.bat ishlashi kerak (API)
echo   2) .env da TELEGRAM_BOT_TOKEN bo'lishi kerak
echo   3) FAQAT BITTA bot oynasi ochiq bo'lsin!
echo ========================================
echo.
node telegram\bot.js
if errorlevel 1 (
  echo.
  echo Token xato — BotFather dan yangi token oling!
  echo .env faylini yangilang.
)
pause
