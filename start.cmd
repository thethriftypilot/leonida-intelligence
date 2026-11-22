@echo off
rem Double-click to start Leonida Intelligence.
cd /d "%~dp0"
title Leonida Intelligence
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
pause
