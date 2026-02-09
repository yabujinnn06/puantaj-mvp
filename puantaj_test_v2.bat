@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul

REM =========================
REM PuantajMVP Quick Test (v2)
REM - Runs everything inside one PowerShell command (no temp .ps1)
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

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
"$ErrorActionPreference='Stop';" ^
"$base=$env:BASE_URL; $adminUser=$env:ADMIN_USER; $adminPass=$env:ADMIN_PASS;" ^
"$deptName=$env:DEPARTMENT_NAME; $empName=$env:EMPLOYEE_NAME; $siteId=$env:SITE_ID;" ^
"$homeLat=[double]$env:HOME_LAT; $homeLon=[double]$env:HOME_LON; $homeRadius=[int]$env:HOME_RADIUS_M;" ^
"$deviceFp=$env:DEVICE_FP; $outLat=[double]$env:OUT_LAT; $outLon=[double]$env:OUT_LON; $acc=[double]$env:ACC_M;" ^
"$logFile=$env:LOGFILE; $jsonFile=$env:JSONFILE;" ^
"function Log([string]$msg){$ts=(Get-Date).ToString('yyyy-MM-dd HH:mm:ss'); $line='['+$ts+'] '+$msg; $line ^| Tee-Object -FilePath $logFile -Append ^| Out-Null; Write-Host $line }" ^
"function J([object]$o){ return ($o ^| ConvertTo-Json -Depth 12 -Compress) }" ^
"Log '=== PuantajMVP TEST START ==='; Log ('Base URL: '+$base);" ^
"try {" ^
"  Log '1) Admin login...';" ^
"  $loginBody=@{username=$adminUser; password=$adminPass} ^| ConvertTo-Json;" ^
"  $login=Invoke-RestMethod -Method Post -Uri ($base+'/api/admin/auth/login') -ContentType 'application/json' -Body $loginBody;" ^
"  $token=$login.access_token; if(-not $token){ throw 'No access_token returned.' }" ^
"  $hdr=@{ Authorization = 'Bearer '+$token };" ^
"  Log '   OK: token received.';" ^

"  Log '2) Departments get/create...';" ^
"  $deps=Invoke-RestMethod -Method Get -Uri ($base+'/admin/departments') -Headers $hdr;" ^
"  $dep=$deps ^| Where-Object { $_.name -eq $deptName } ^| Select-Object -First 1;" ^
"  if(-not $dep){ Log ('   Creating department: '+$deptName); $dep=Invoke-RestMethod -Method Post -Uri ($base+'/admin/departments') -Headers $hdr -ContentType 'application/json' -Body (@{name=$deptName} ^| ConvertTo-Json) }" ^
"  $depId=[int]$dep.id; Log ('   OK: department_id='+$depId);" ^

"  Log '3) Employees get/create...';" ^
"  $emps=Invoke-RestMethod -Method Get -Uri ($base+'/admin/employees') -Headers $hdr;" ^
"  $emp=$emps ^| Where-Object { $_.full_name -eq $empName } ^| Select-Object -First 1;" ^
"  if(-not $emp){ Log ('   Creating employee: '+$empName); $emp=Invoke-RestMethod -Method Post -Uri ($base+'/admin/employees') -Headers $hdr -ContentType 'application/json' -Body (@{full_name=$empName; department_id=$depId; is_active=$true} ^| ConvertTo-Json) }" ^
"  $empId=[int]$emp.id; Log ('   OK: employee_id='+$empId);" ^

"  Log '4) Work rules ensure...';" ^
"  $rules=Invoke-RestMethod -Method Get -Uri ($base+'/admin/work-rules') -Headers $hdr;" ^
"  $rule=$rules ^| Where-Object { $_.department_id -eq $depId } ^| Select-Object -First 1;" ^
"  if(-not $rule){ Log '   Creating work rule...'; $rule=Invoke-RestMethod -Method Post -Uri ($base+'/admin/work-rules') -Headers $hdr -ContentType 'application/json' -Body (@{department_id=$depId; daily_minutes_planned=540; break_minutes=0; grace_minutes=5} ^| ConvertTo-Json) } else { Log ('   Work rule exists (id='+$rule.id+')') }" ^

"  Log '5) Set home location...';" ^
"  $homeRes=Invoke-RestMethod -Method Put -Uri ($base+'/admin/employee-locations/'+$empId) -Headers $hdr -ContentType 'application/json' -Body (@{home_lat=$homeLat; home_lon=$homeLon; radius_m=$homeRadius} ^| ConvertTo-Json);" ^
"  Log ('   OK: home=('+$homeLat+','+$homeLon+') radius='+$homeRadius+'m');" ^

"  Log '6) Create device invite...';" ^
"  $invite=Invoke-RestMethod -Method Post -Uri ($base+'/api/admin/device-invite') -Headers $hdr -ContentType 'application/json' -Body (@{employee_id=$empId; expires_in_minutes=60} ^| ConvertTo-Json);" ^
"  if(-not $invite.token){ throw 'Invite token missing.' }" ^
"  Log ('   OK: invite token='+$invite.token);" ^
"  Log ('   invite_url='+$invite.invite_url);" ^

"  Log '7) Claim device...';" ^
"  $claim=Invoke-RestMethod -Method Post -Uri ($base+'/api/device/claim') -ContentType 'application/json' -Body (@{token=$invite.token; device_fingerprint=$deviceFp} ^| ConvertTo-Json);" ^
"  Log ('   OK: claimed device_fingerprint='+$deviceFp);" ^

"  Log '8) Check-in...';" ^
"  $cin=Invoke-RestMethod -Method Post -Uri ($base+'/api/attendance/checkin') -ContentType 'application/json' -Body (@{device_fingerprint=$deviceFp; qr=@{site_id=$siteId; type='IN'}; lat=$homeLat; lon=$homeLon; accuracy_m=$acc} ^| ConvertTo-Json -Depth 6);" ^
"  Log ('   OK: IN event_id='+$cin.event_id+' location_status='+$cin.location_status);" ^
"  Start-Sleep -Seconds 2;" ^

"  Log '9) Checkout...';" ^
"  $cout=Invoke-RestMethod -Method Post -Uri ($base+'/api/attendance/checkout') -ContentType 'application/json' -Body (@{device_fingerprint=$deviceFp; lat=$outLat; lon=$outLon; accuracy_m=$acc} ^| ConvertTo-Json);" ^
"  Log ('   OK: OUT event_id='+$cout.event_id+' location_status='+$cout.location_status);" ^

"  Log '10) Fetch last attendance events (top 5)...';" ^
"  $events=Invoke-RestMethod -Method Get -Uri ($base+'/admin/attendance-events') -Headers $hdr;" ^
"  $top=$events ^| Select-Object -First 5;" ^
"  Log ('   Top events: '+(J $top));" ^

"  $now=Get-Date; $year=$now.Year; $month=$now.Month; $dateStr=$now.ToString('yyyy-MM-dd');" ^
"  Log ('11) Monthly report (employee_id='+$empId+' year='+$year+' month='+$month+')...');" ^
"  $rep=Invoke-RestMethod -Method Get -Uri ($base+'/api/admin/monthly/employee?employee_id='+$empId+'&year='+$year+'&month='+$month) -Headers $hdr;" ^
"  $day=$rep.days ^| Where-Object { $_.date -eq $dateStr } ^| Select-Object -First 1;" ^
"  Log ('   Today '+$dateStr+': '+(J $day));" ^
"  Log ('   Totals: '+(J $rep.totals));" ^

"  $outObj=[ordered]@{ base_url=$base; department=$dep; employee=$emp; work_rule=$rule; home_location=$homeRes; invite=$invite; claim=$claim; checkin=$cin; checkout=$cout; today_report=$day; totals=$rep.totals; top_events=$top };" ^
"  $outObj ^| ConvertTo-Json -Depth 12 ^| Set-Content -Encoding UTF8 $jsonFile;" ^

"  Log '=== TEST PASSED ==='; Log ('Share: '+$logFile+' and '+$jsonFile);" ^
"} catch {" ^
"  Log '!!! TEST FAILED !!!';" ^
"  Log ($_ ^| Out-String);" ^
"  try { if($_.Exception.Response -and $_.Exception.Response.GetResponseStream()){ $sr=New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $body=$sr.ReadToEnd(); Log ('ResponseBody: '+$body) } } catch {}" ^
"  exit 1" ^
"}"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] Test tamamlandi. Log ve JSON dosyalarini bana gonder.
) else (
  echo [ERR] Test fail oldu. puantaj_test_log.txt icinden hata satirlarini bana yapistir.
)

pause
exit /b %RC%
