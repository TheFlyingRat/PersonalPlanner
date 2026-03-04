@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ========================================
echo   Reclaim — Self-hosted Calendar Manager
echo ========================================
echo.

:: Check for Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Node.js is not installed.
    echo Install Node.js 22+ from https://nodejs.org
    exit /b 1
)

:: Check for pnpm
where pnpm >nul 2>nul
if %errorlevel% neq 0 (
    echo pnpm not found. Installing...
    call npm install -g pnpm@9.15.4
)

:: Create .env from example if it doesn't exist
if not exist .env (
    if exist .env.example (
        copy .env.example .env >nul
        echo Created .env from .env.example — edit it with your settings.
    )
)

:: Parse command (default: dev)
set MODE=%1
if "%MODE%"=="" set MODE=dev

if /i "%MODE%"=="dev" goto :dev
if /i "%MODE%"=="build" goto :build
if /i "%MODE%"=="prod" goto :prod
if /i "%MODE%"=="production" goto :prod
if /i "%MODE%"=="start" goto :prod
if /i "%MODE%"=="test" goto :test
goto :usage

:dev
echo Starting in development mode...
echo.

if not exist node_modules (
    echo Installing dependencies...
    call pnpm install
)

echo API:      http://localhost:3000
echo Frontend: http://localhost:5173
echo.

call pnpm dev
goto :end

:build
echo Building all packages...
echo.

if not exist node_modules (
    echo Installing dependencies...
    call pnpm install
)

call pnpm build

echo.
echo Build complete. Run "start.bat prod" to start.
goto :end

:prod
echo Starting in production mode...
echo.

if not exist node_modules (
    echo Installing dependencies...
    call pnpm install
)

if not exist packages\api\dist\index.js (
    echo Building packages...
    call pnpm build
)

if "%PORT%"=="" set PORT=3000
echo Server: http://localhost:%PORT%
echo.

node packages\api\dist\index.js
goto :end

:test
echo Running tests...
echo.

if not exist node_modules (
    call pnpm install
)

cd packages\engine
call npx vitest run
cd ..\..
goto :end

:usage
echo Usage: start.bat [command]
echo.
echo Commands:
echo   dev          Start in development mode with hot reload (default)
echo   build        Build all packages for production
echo   prod         Start in production mode
echo   test         Run engine tests
echo.
goto :end

:end
endlocal
