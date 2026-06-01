@echo off
title QA Agent - Nocorp
echo.
echo  =======================================
echo   Nocorp QA Agent - Iniciando...
echo  =======================================
echo.
cd /d "%~dp0"
.\venv\Scripts\python.exe main.py
pause
