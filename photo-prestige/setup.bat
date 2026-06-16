@echo off
REM Photo Prestige - Quick Setup Script for Windows
REM This script initializes the project structure and prepares it for development

echo.
echo ==========================================
echo Photo Prestige - Setup Script
echo ==========================================
echo.

REM Check prerequisites
echo Checking prerequisites...

where docker >nul 2>nul
if %errorlevel% neq 0 (
    echo Docker not found. Please install Docker.
    exit /b 1
)

where docker-compose >nul 2>nul
if %errorlevel% neq 0 (
    echo Docker Compose not found. Please install Docker Compose.
    exit /b 1
)

echo Docker and Docker Compose found
echo.

REM Copy environment file
if not exist .env (
    echo Creating .env file from .env.example...
    copy .env.example .env
    echo WARNING: Please update .env with your Imagga credentials!
    echo.
)

REM Build images
echo Building Docker images...
docker-compose build

echo.
echo Setup complete!
echo.
echo ==========================================
echo Next steps:
echo ==========================================
echo 1. Update .env with Imagga API credentials
echo 2. Run: docker-compose up -d
echo 3. Wait 30 seconds for services to start
echo 4. Check health: curl http://localhost:3001/auth/health
echo 5. Read GETTING_STARTED.md for testing guide
echo ==========================================
echo.
