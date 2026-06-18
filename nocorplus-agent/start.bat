@echo off
title Nocorp+ QA Agent

if not exist ".env" (
    echo.
    echo  Crie o arquivo .env antes de iniciar.
    echo  Copie .env.example para .env e preencha as chaves.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo  Instalando dependencias...
    call npm install
    if errorlevel 1 (
        echo  Erro na instalacao. Verifique o Node.js ^(>=18^).
        pause
        exit /b 1
    )
)

node worker.js
pause
