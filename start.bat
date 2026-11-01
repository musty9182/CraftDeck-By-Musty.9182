@echo off
setlocal
cd /d "%~dp0"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 run.py %*
    goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
    python run.py %*
    goto :done
)

echo.
echo Python 3.10 veya daha yeni bir sürüm bulunamadi.
echo https://www.python.org/downloads/ adresinden indirip "Add python.exe to PATH" secenegini isaretleyin.
echo.
pause
exit /b 1

:done
if %errorlevel% neq 0 pause
endlocal
