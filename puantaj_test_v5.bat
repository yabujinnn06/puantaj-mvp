@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul

REM =========================
REM PuantajMVP Quick Test (v5)
REM - Uses UTF-8 safe runner: puantaj_test_runner_utf8.ps1
REM =========================

REM ---- Edit these if needed ----
set "BASE_URL=http://127.0.0.1:8000"
set "ADMIN_USER=admin"
set "ADMIN_PASS=Admin123!"
set "DEPARTMENT_NAME=Saha"
set "EMPLOYEE_NAME=Test Çalışan"
set "SITE_ID=HQ"
set "HOME_LAT=41.0"
set "HOME_LON=29.0"
set "HOME_RADIUS_M=300"
set "DEVICE_FP=dev-test-001"
set "OUT_LAT=41.0"
set "OUT_LON=29.0"
set "ACC_M=20"

REM Output files in current folder
set "LOGFILE=%CD%\puantaj_test_log.txt"
set "JSONFILE=%CD%\puantaj_test_output.json"

echo [INFO] Base URL  : %BASE_URL%
echo [INFO] Log file  : %LOGFILE%
echo [INFO] JSON file : %JSONFILE%
echo.

REM Runner must be in the same folder as this BAT
set "RUNNER=%~dp0puantaj_test_runner_utf8.ps1"

if not exist "%RUNNER%" (
  echo [ERR] Runner bulunamadi: "%RUNNER%"
  echo Bu dosya BAT ile ayni klasorde olmali: puantaj_test_runner_utf8.ps1
  pause
  exit /b 2
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%RUNNER%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo [OK] Test tamamlandi. puantaj_test_log.txt ve puantaj_test_output.json dosyalarini bana gonder.
) else (
  echo [ERR] Test fail oldu. puantaj_test_log.txt icindeki hata satirlarini bana yapistir.
)

pause
exit /b %RC%
