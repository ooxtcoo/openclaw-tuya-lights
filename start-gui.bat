@echo off
setlocal

set "ROOT=C:\Users\1111\.openclaw\workspace\tuya-lights\gui-v1"
set "URL=http://127.0.0.1:5173"

echo Starting Tuya Lights GUI...
start "Tuya Lights GUI" cmd /k "cd /d %ROOT% && npm start"

timeout /t 3 /nobreak >nul
start "" "%URL%"

endlocal
