@echo off
chcp 65001 >nul
title QA Agent — Nocorp
cd /d "%~dp0"

if not exist venv (
    echo  ❌ Ambiente não configurado. Rode o instalador primeiro.
    pause
    exit /b 1
)

.\venv\Scripts\python.exe worker.py
pause
