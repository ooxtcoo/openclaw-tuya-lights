@echo off
setlocal

set "ROOT=%~dp0gui-v1"
set "TUYA_GUI_API_PORT=4890"
set "URL=http://127.0.0.1:5173"

echo Starting Tuya Lights GUI...
start "Tuya Lights GUI" cmd /c "cd /d %ROOT% && set TUYA_GUI_API_PORT=%TUYA_GUI_API_PORT% && npm start"

timeout /t 3 /nobreak >nul
start "" "%URL%"

endlocal
