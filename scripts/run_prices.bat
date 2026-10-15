@echo off
chcp 65001 >nul
cd /d "%~dp0"

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
%PY% price_scraper.py -f items.txt -o prices.xlsx
if exist prices.xlsx start "" prices.xlsx
echo.
pause
