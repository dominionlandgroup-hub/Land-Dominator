@echo off
REM Quick local development setup for Land Parcel Analysis Tool (Windows)

echo.
echo 🚀 Setting up Land Parcel Analysis Tool...
echo.

REM Backend Setup
echo 📦 Setting up Backend...
cd backend

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python is not installed. Please install Python 3.11+ first.
    exit /b 1
)

REM Create virtual environment
echo Creating virtual environment...
python -m venv venv

REM Activate virtual environment
echo Activating virtual environment...
call venv\Scripts\activate.bat

REM Install dependencies
echo Installing Python dependencies...
pip install -r requirements.txt

REM Copy env file
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo ⚠️  Update backend\.env with production values before deploying!
)

cd ..

REM Frontend Setup
echo.
echo 🎨 Setting up Frontend...
cd frontend

REM Check if Node is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js 20+ first.
    exit /b 1
)

REM Install dependencies
echo Installing Node dependencies (this may take a minute)...
call npm ci

REM Copy env file
if not exist .env (
    echo Creating .env from .env.example...
    copy .env.example .env
    echo ⚠️  Update frontend\.env if using non-local API!
)

cd ..

echo.
echo ✅ Setup complete!
echo.
echo 📝 Next steps:
echo   1. Backend:  cd backend ^&^& venv\Scripts\activate.bat ^&^& python main.py
echo   2. Frontend: cd frontend ^&^& npm run dev
echo.
echo 🌐 Open browser to:
echo    Frontend: http://localhost:5173
echo    Backend:  http://localhost:8000/docs
echo.
