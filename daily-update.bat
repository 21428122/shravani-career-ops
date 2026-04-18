@echo off
REM Daily refresh — runs scan, generates tailored PDFs, pushes to GitHub.
REM Registered in Windows Task Scheduler to run daily at 7:00 AM ET.

cd /d "%~dp0"
node scripts\daily-update.mjs
