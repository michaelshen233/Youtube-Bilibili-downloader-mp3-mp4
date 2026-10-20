@echo off
setlocal
cd /d "%~dp0"
echo Close YouTube Downloader before updating.
".tools\node.exe" "app\setup.js" --update --portable
pause
