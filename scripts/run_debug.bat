@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PY=python
where python >nul 2>nul || set PY=py

%PY% -m pip install --quiet --disable-pip-version-check requests beautifulsoup4 openpyxl

echo.
echo Saving raw site responses to the debug_raw folder...
%PY% price_scraper.py --debug -o prices_debug.xlsx
echo.
echo Send all files in the debug_raw folder (and prices_debug.xlsx).
if exist debug_raw start "" debug_raw
pause
