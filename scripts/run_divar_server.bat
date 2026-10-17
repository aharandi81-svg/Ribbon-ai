@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Divar cars server

set PY=python
where python >nul 2>nul || set PY=py
where %PY% >nul 2>nul || (
    echo Python is not installed.
    echo Install it from https://www.python.org/downloads/
    echo and tick "Add python.exe to PATH" during setup, then run this file again.
    pause
    exit /b 1
)

echo Installing required packages...
%PY% -m pip install --quiet --disable-pip-version-check requests beautifulsoup4 openpyxl

echo.
echo Other computers on the network will be able to open the viewer.
set "DIVAR_VIEWER_PASSWORD="
set /p "DIVAR_VIEWER_PASSWORD=Viewer password (leave empty for no password): "
echo.
echo Keep this window open. New ads are collected every 6 hours.
echo.
%PY% divar_cars.py --lan --every-hours 6
echo.
pause
