@echo off
TITLE CYBER-DECK COMMAND CONSOLE
COLOR 0C

echo ======================================================================
echo    FUTURISTIC DISCORD BOT ENGINE // CYBER-DECK COMMAND CONSOLE
echo    Next-Gen Autonomous Support & Server Operations
echo ======================================================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not recognized in current PATH.
    echo Refreshing environment path...
    set "PATH=%PATH%;C:\Program Files\nodejs"
)

echo [SYSTEM] Launching Cyber-Deck Console & Discord Engine...
echo [SYSTEM] Opening http://localhost:3000 in your browser...
start http://localhost:3000

node src/index.js
pause
