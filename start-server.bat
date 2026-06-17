@echo off
cd /d "%~dp0"

echo.
echo  ==========================================
echo   Otodom Scraper - lokalny serwer www
echo   http://localhost:8080
echo  ==========================================
echo.

:: Sprawdz dostepne Pythony
set PYTHON=
if exist "C:\Users\Dominik\AppData\Local\Python\bin\python.exe" (
    set PYTHON=C:\Users\Dominik\AppData\Local\Python\bin\python.exe
) else (
    where py >nul 2>&1 && set PYTHON=py
)
if exist "C:\Python313\python.exe" set PYTHON=C:\Python313\python.exe
if exist "C:\Python312\python.exe" set PYTHON=C:\Python312\python.exe
if exist "C:\Python311\python.exe" set PYTHON=C:\Python311\python.exe

if "%PYTHON%"=="" (
    echo  BLAD: Nie znaleziono Pythona!
    pause
    exit /b 1
)

echo  Otwieranie przegladarki za 2 sekundy...
start "" /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8080"

echo  Serwer dziala na http://localhost:8080
echo  Nacisnij Ctrl+C aby zatrzymac.
echo.
"%PYTHON%" -m http.server 8080
pause
