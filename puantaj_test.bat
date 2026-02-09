@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul

REM =========================
REM PuantajMVP Quick Test
REM =========================
REM Edit these if needed:
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

REM Where to write logs:
set "OUTDIR=%~dp0"
set "LOGFILE=%OUTDIR%puantaj_test_log.txt"
set "JSONFILE=%OUTDIR%puantaj_test_output.json"

echo [INFO] Log: "%LOGFILE%"
echo [INFO] Output JSON: "%JSONFILE%"
echo.

set "PS1=%TEMP%\puantaj_test_%RANDOM%.ps1"

REM --- Write PowerShell runner to temp ---
> "%PS1%" (
echo $ErrorActionPreference = "Stop"
echo $base = "%BASE_URL%"
echo $adminUser = "%ADMIN_USER%"
echo $adminPass = "%ADMIN_PASS%"
echo $deptName = "%DEPARTMENT_NAME%"
echo $empName = "%EMPLOYEE_NAME%"
echo $siteId = "%SITE_ID%"
echo $homeLat = [double]"%HOME_LAT%"
echo $homeLon = [double]"%HOME_LON%"
echo $homeRadius = [int]"%HOME_RADIUS_M%"
echo $deviceFp = "%DEVICE_FP%"
echo $outLat = [double]"%OUT_LAT%"
echo $outLon = [double]"%OUT_LON%"
echo $acc = [double]"%ACC_M%"
echo $logFile = "%LOGFILE%"
echo $jsonFile = "%JSONFILE%"
echo
echo function Log([string]$msg) { $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss"); $line = "[$ts] $msg"; $line ^| Tee-Object -FilePath $logFile -Append }
echo function J([object]$o) { return ($o ^| ConvertTo-Json -Depth 12 -Compress) }
echo
echo Log "=== PuantajMVP TEST START ==="
echo Log "Base URL: $base"
echo
echo try {
echo   # 1) Admin login
echo   Log "1) Admin login..."
echo   $loginBody = @{ username = $adminUser; password = $adminPass } ^| ConvertTo-Json
echo   $login = Invoke-RestMethod -Method Post -Uri "$base/api/admin/auth/login" -ContentType "application/json" -Body $loginBody
echo   $token = $login.access_token
echo   if (-not $token) { throw "No access_token returned from login." }
echo   $hdr = @{ Authorization = "Bearer $token" }
echo   Log "   OK: token received."
echo
echo   # 2) Departments: get or create
echo   Log "2) Departments get/create..."
echo   $deps = Invoke-RestMethod -Method Get -Uri "$base/admin/departments" -Headers $hdr
echo   $dep = $deps ^| Where-Object { $_.name -eq $deptName } ^| Select-Object -First 1
echo   if (-not $dep) {
echo     Log "   Department '$deptName' not found, creating..."
echo     $dep = Invoke-RestMethod -Method Post -Uri "$base/admin/departments" -Headers $hdr -ContentType "application/json" -Body (@{ name = $deptName } ^| ConvertTo-Json)
echo   }
echo   $depId = [int]$dep.id
echo   Log "   OK: department_id=$depId"
echo
echo   # 3) Employees: get or create
echo   Log "3) Employees get/create..."
echo   $emps = Invoke-RestMethod -Method Get -Uri "$base/admin/employees" -Headers $hdr
echo   $emp = $emps ^| Where-Object { $_.full_name -eq $empName } ^| Select-Object -First 1
echo   if (-not $emp) {
echo     Log "   Employee '$empName' not found, creating..."
echo     $empBody = @{ full_name = $empName; department_id = $depId; is_active = $true } ^| ConvertTo-Json
echo     $emp = Invoke-RestMethod -Method Post -Uri "$base/admin/employees" -Headers $hdr -ContentType "application/json" -Body $empBody
echo   }
echo   $empId = [int]$emp.id
echo   Log "   OK: employee_id=$empId"
echo
echo   # 4) Work rules: ensure exists for dept (break=0 for clean tests)
echo   Log "4) Work rules ensure..."
echo   $rules = Invoke-RestMethod -Method Get -Uri "$base/admin/work-rules" -Headers $hdr
echo   $rule = $rules ^| Where-Object { $_.department_id -eq $depId } ^| Select-Object -First 1
echo   if (-not $rule) {
echo     Log "   Work rule not found for department, creating..."
echo     $ruleBody = @{ department_id=$depId; daily_minutes_planned=540; break_minutes=0; grace_minutes=5 } ^| ConvertTo-Json
echo     $rule = Invoke-RestMethod -Method Post -Uri "$base/admin/work-rules" -Headers $hdr -ContentType "application/json" -Body $ruleBody
echo   } else {
echo     Log "   Work rule exists (id=$($rule.id))."
echo   }
echo
echo   # 5) Set employee home location (admin override)
echo   Log "5) Set home location..."
echo   $homeBody = @{ home_lat=$homeLat; home_lon=$homeLon; radius_m=$homeRadius } ^| ConvertTo-Json
echo   $homeRes = Invoke-RestMethod -Method Put -Uri "$base/admin/employee-locations/$empId" -Headers $hdr -ContentType "application/json" -Body $homeBody
echo   Log "   OK: home location set to ($homeLat,$homeLon) radius ${homeRadius}m"
echo
echo   # 6) Device invite
echo   Log "6) Create device invite..."
echo   $invBody = @{ employee_id=$empId; expires_in_minutes=60 } ^| ConvertTo-Json
echo   $invite = Invoke-RestMethod -Method Post -Uri "$base/api/admin/device-invite" -Headers $hdr -ContentType "application/json" -Body $invBody
echo   if (-not $invite.token) { throw "Invite token missing." }
echo   Log "   OK: invite token=$($invite.token)"
echo   Log "   invite_url=$($invite.invite_url)"
echo
echo   # 7) Claim device (simulating employee clicking claim link)
echo   Log "7) Claim device..."
echo   $claimBody = @{ token=$invite.token; device_fingerprint=$deviceFp } ^| ConvertTo-Json
echo   $claim = Invoke-RestMethod -Method Post -Uri "$base/api/device/claim" -ContentType "application/json" -Body $claimBody
echo   Log "   OK: device claimed (device_fingerprint=$deviceFp)"
echo
echo   # 8) Check-in (simulate scanning IN|SITE)
echo   Log "8) Check-in..."
echo   $checkinBody = @{
echo     device_fingerprint=$deviceFp
echo     qr=@{ site_id=$siteId; type="IN" }
echo     lat=$homeLat
echo     lon=$homeLon
echo     accuracy_m=$acc
echo   } ^| ConvertTo-Json -Depth 6
echo   $cin = Invoke-RestMethod -Method Post -Uri "$base/api/attendance/checkin" -ContentType "application/json" -Body $checkinBody
echo   Log "   OK: IN event_id=$($cin.event_id) location_status=$($cin.location_status)"
echo
echo   Start-Sleep -Seconds 2
echo
echo   # 9) Checkout (simulate finishing shift at OUT_LAT/OUT_LON)
echo   Log "9) Checkout..."
echo   $checkoutBody = @{
echo     device_fingerprint=$deviceFp
echo     lat=$outLat
echo     lon=$outLon
echo     accuracy_m=$acc
echo   } ^| ConvertTo-Json
echo   $cout = Invoke-RestMethod -Method Post -Uri "$base/api/attendance/checkout" -ContentType "application/json" -Body $checkoutBody
echo   Log "   OK: OUT event_id=$($cout.event_id) location_status=$($cout.location_status)"
echo
echo   # 10) Attendance events (top 5)
echo   Log "10) Fetch last attendance events (top 5)..."
echo   $events = Invoke-RestMethod -Method Get -Uri "$base/admin/attendance-events" -Headers $hdr
echo   $top = $events ^| Select-Object -First 5
echo   Log ("   Top events: " + (J $top))
echo
echo   # 11) Monthly report (today only)
echo   $now = Get-Date
echo   $year = $now.Year
echo   $month = $now.Month
echo   $dateStr = $now.ToString("yyyy-MM-dd")
echo   Log "11) Monthly report for employee_id=$empId year=$year month=$month..."
echo   $rep = Invoke-RestMethod -Method Get -Uri "$base/api/admin/monthly/employee?employee_id=$empId&year=$year&month=$month" -Headers $hdr
echo   $day = $rep.days ^| Where-Object { $_.date -eq $dateStr } ^| Select-Object -First 1
echo   Log ("   Today (" + $dateStr + ") = " + (J $day))
echo   Log ("   Totals = " + (J $rep.totals))
echo
echo   # Write a combined JSON output file for sharing
echo   $outObj = [ordered]@{
echo     base_url = $base
echo     department = $dep
echo     employee = $emp
echo     work_rule = $rule
echo     home_location = $homeRes
echo     invite = $invite
echo     claim = $claim
echo     checkin = $cin
echo     checkout = $cout
echo     today_report = $day
echo     totals = $rep.totals
echo     top_events = $top
echo   }
echo   $outObj ^| ConvertTo-Json -Depth 12 ^| Set-Content -Encoding UTF8 $jsonFile
echo
echo   Log "=== TEST PASSED ==="
echo   Log "Share these files: $logFile and $jsonFile"
echo } catch {
echo   Log "!!! TEST FAILED !!!"
echo   Log ($_ ^| Out-String)
echo   try {
echo     if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
echo       $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
echo       $body = $sr.ReadToEnd()
echo       Log ("ResponseBody: " + $body)
echo     }
echo   } catch {}
echo   exit 1
echo }
)

REM --- Run PowerShell script ---
powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
set "RC=%ERRORLEVEL%"

REM Clean up temp ps1
del "%PS1%" >nul 2>nul

echo.
if "%RC%"=="0" (
  echo [OK] Test tamamlandi. Log ve JSON dosyalarini bana gonder.
) else (
  echo [ERR] Test fail oldu. "%LOGFILE%" icinden hata satirlarini bana yapistir.
)

exit /b %RC%
