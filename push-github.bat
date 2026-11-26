@echo off
cd /d "%~dp0"
echo Se trimite proiectul Rentz pe GitHub...
"C:\Program Files\Git\cmd\git.exe" push -u origin main
echo.
echo Gata! Poti inchide aceasta fereastra.
pause
