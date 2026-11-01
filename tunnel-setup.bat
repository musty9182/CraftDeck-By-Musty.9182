@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PYTHONIOENCODING=utf-8"

where py >nul 2>nul
if %errorlevel%==0 (
    py -3 -m app.tunnel_setup %*
    goto :done
)
where python >nul 2>nul
if %errorlevel%==0 (
    python -m app.tunnel_setup %*
    goto :done
)

echo.
echo Python 3.10 veya daha yeni bir surum bulunamadi.
echo https://www.python.org/downloads/ adresinden indirip "Add python.exe to PATH" secenegini isaretleyin.
echo.
pause
exit /b 1

:done
if %errorlevel% neq 0 pause
endlocal
