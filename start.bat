@echo off
TITLE ABYSS // CYBER-DECK COMMAND CONSOLE
COLOR 0C

echo ======================================================================
echo    ABYSS // FUTURISTIC DISCORD BOT & CYBER-DECK COMMAND CONSOLE
echo    Into the dark. Full autonomous server command.
echo ======================================================================
echo.
echo [NOTICE] If your bot is deployed 24/7 on Railway, running this local
echo          instance will cause Discord to receive duplicate messages.
echo          Only run this if Railway is paused or for local development.
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
