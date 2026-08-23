@echo off
title ragui dev
cd /d "%~dp0"
echo.
echo   Starting RagUi: [db] Postgres + [backend] FastAPI + [web] Next.js
echo   Open http://localhost:3000 when ready. Close this window to stop.
echo.
npm run dev
pause
