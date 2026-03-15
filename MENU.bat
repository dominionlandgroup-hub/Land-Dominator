@echo off
REM ============================================
REM Land Parcel Analysis Tool - Complete Guide
REM ============================================

setlocal enabledelayedexpansion
cls

echo.
echo ============================================
echo Land Parcel Analysis Tool - Setup ^& Start
echo ============================================
echo.
echo What would you like to do?
echo.
echo 1. Setup and start all (recommended)
echo 2. View status and access points
echo 3. Exit
echo.

set /p choice="Enter your choice (1-3): "

if "%choice%"=="1" goto setup_and_start
if "%choice%"=="2" goto show_status
if "%choice%"=="3" goto exit_script
goto invalid

:setup_and_start
cls
echo ============================================
echo Running Complete Setup...
echo ============================================
echo.
call start-dev.bat
goto end

:show_status
cls
echo ============================================
echo Land Parcel Analysis Tool - Access Points
echo ============================================
echo.
echo Frontend Application:
echo   URL: http://localhost:3000
echo.
echo Backend API:
echo   URL: http://localhost:8000
echo   Documentation: http://localhost:8000/docs
echo.
echo ============================================
echo.
pause
goto end

:invalid
cls
echo Invalid choice. Please try again.
timeout /t 2 /nobreak > nul
goto setup_and_start

:exit_script
exit /b 0

:end
cls
echo.
echo Menu closed. 
echo.
