@echo off
title Land Parcel Analysis Tool - Setup and Start
echo ================================================
echo  Land Parcel Analysis Tool - Auto Setup + Start
echo ================================================
echo.

REM ── Check Python ──────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found. Install from https://python.org
    pause
    exit /b 1
)
echo [OK] Python found

REM ── Check Node ────────────────────────────────────
node --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found. Install from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found

REM ── Backend: Create venv if missing ──────────────
echo.
echo [1/4] Setting up Python virtual environment...
if not exist "%~dp0backend\venv\Scripts\activate.bat" (
    cd /d "%~dp0backend"
    python -m venv venv
    if errorlevel 1 (
        echo ERROR: Failed to create venv
        pause
        exit /b 1
    )
    echo [OK] venv created
) else (
    echo [OK] venv already exists
)

REM ── Backend: Install requirements ─────────────────
echo.
echo [2/4] Installing Python dependencies...
cd /d "%~dp0backend"
call venv\Scripts\activate.bat
python -m pip install --upgrade pip --quiet
pip install -r requirements.txt --quiet
if errorlevel 1 (
    echo ERROR: pip install failed - check requirements.txt
    pause
    exit /b 1
)
echo [OK] Python dependencies installed

REM ── Frontend: Install node_modules ────────────────
echo.
echo [3/4] Installing Node.js dependencies...
cd /d "%~dp0frontend"
if not exist "node_modules" (
    call npm install --silent
    if errorlevel 1 (
        echo ERROR: npm install failed
        pause
        exit /b 1
    )
    echo [OK] Node modules installed
) else (
    echo [OK] node_modules already exists
)

REM ── Start both servers ────────────────────────────
echo.
echo [4/4] Starting servers...
echo.

start "Backend - Port 8000" cmd /k "cd /d "%~dp0backend" && call venv\Scripts\activate.bat && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload && pause"

timeout /t 3 /nobreak > nul

start "Frontend - Port 3000" cmd /k "cd /d "%~dp0frontend" && npm run dev && pause"

echo.
echo ================================================
echo  Both servers are starting in new windows!
echo ================================================
echo.
echo  Frontend:  http://localhost:3000
echo  Backend:   http://localhost:8000/docs
echo.
echo  Wait ~10 seconds then open http://localhost:3000
echo  in your browser.
echo.
pause
