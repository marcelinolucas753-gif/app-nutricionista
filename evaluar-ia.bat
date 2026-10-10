@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo No encontramos Node.js. Instalalo desde https://nodejs.org/ y volve a abrir este archivo.
  pause
  exit /b 1
)
node evaluar-ia.mjs %*
pause
