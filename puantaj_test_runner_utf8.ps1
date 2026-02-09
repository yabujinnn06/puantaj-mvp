param()

# PuantajMVP Test Runner (UTF-8 safe for Windows PowerShell 5.1)

$ErrorActionPreference = "Stop"

# Ensure console output is UTF-8 (reduces mojibake in display)
try {
  [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch {}

function Log([string]$msg) {
  $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
  $line = "[$ts] $msg"
  $line | Tee-Object -FilePath $env:LOGFILE -Append | Out-Null
  Write-Host $line
}

function J([object]$o) {
  return ($o | ConvertTo-Json -Depth 12 -Compress)
}

# Force UTF-8 JSON bytes for Windows PowerShell 5.1
function PostJson([string]$url, [object]$obj, [hashtable]$headers=$null) {
  $json = $obj | ConvertTo-Json -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  if ($headers) {
    return Invoke-RestMethod -Method Post -Uri $url -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
  } else {
    return Invoke-RestMethod -Method Post -Uri $url -ContentType "application/json; charset=utf-8" -Body $bytes
  }
}

function PutJson([string]$url, [object]$obj, [hashtable]$headers) {
  $json = $obj | ConvertTo-Json -Depth 10
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  return Invoke-RestMethod -Method Put -Uri $url -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
}

$base      = $env:BASE_URL
$adminUser = $env:ADMIN_USER
$adminPass = $env:ADMIN_PASS
$deptName  = $env:DEPARTMENT_NAME
$empName   = $env:EMPLOYEE_NAME
$siteId    = $env:SITE_ID

$homeLat    = [double]$env:HOME_LAT
$homeLon    = [double]$env:HOME_LON
$homeRadius = [int]$env:HOME_RADIUS_M

$deviceFp = $env:DEVICE_FP
$outLat   = [double]$env:OUT_LAT
$outLon   = [double]$env:OUT_LON
$acc      = [double]$env:ACC_M

Log "=== PuantajMVP TEST START ==="
Log "Base URL: $base"

try {
  Log "1) Admin login..."
  $login = PostJson "$base/api/admin/auth/login" @{ username=$adminUser; password=$adminPass }
  $token = $login.access_token
  if (-not $token) { throw "No access_token returned from login." }
  $hdr = @{ Authorization = "Bearer $token" }
  Log "   OK: token received."

  Log "2) Departments get/create..."
  $deps = Invoke-RestMethod -Method Get -Uri "$base/admin/departments" -Headers $hdr
  $dep = $deps | Where-Object { $_.name -eq $deptName } | Select-Object -First 1
  if (-not $dep) {
    Log "   Department '$deptName' not found, creating..."
    $dep = PostJson "$base/admin/departments" @{ name=$deptName } $hdr
  }
  $depId = [int]$dep.id
  Log "   OK: department_id=$depId"

  Log "3) Employees get/create..."
  $emps = Invoke-RestMethod -Method Get -Uri "$base/admin/employees" -Headers $hdr
  $emp = $emps | Where-Object { $_.full_name -eq $empName } | Select-Object -First 1
  if (-not $emp) {
    Log "   Employee '$empName' not found, creating..."
    $emp = PostJson "$base/admin/employees" @{ full_name=$empName; department_id=$depId; is_active=$true } $hdr
  }
  $empId = [int]$emp.id
  Log "   OK: employee_id=$empId"

  Log "4) Work rules ensure..."
  $rules = Invoke-RestMethod -Method Get -Uri "$base/admin/work-rules" -Headers $hdr
  $rule = $rules | Where-Object { $_.department_id -eq $depId } | Select-Object -First 1
  if (-not $rule) {
    Log "   Work rule not found for department, creating..."
    $rule = PostJson "$base/admin/work-rules" @{ department_id=$depId; daily_minutes_planned=540; break_minutes=0; grace_minutes=5 } $hdr
  } else {
    Log "   Work rule exists (id=$($rule.id))."
  }

  Log "5) Set home location..."
  $homeRes = PutJson "$base/admin/employee-locations/$empId" @{ home_lat=$homeLat; home_lon=$homeLon; radius_m=$homeRadius } $hdr
  Log "   OK: home location set to ($homeLat,$homeLon) radius ${homeRadius}m"

  Log "6) Create device invite..."
  $invite = PostJson "$base/api/admin/device-invite" @{ employee_id=$empId; expires_in_minutes=60 } $hdr
  if (-not $invite.token) { throw "Invite token missing." }
  Log "   OK: invite token=$($invite.token)"
  Log "   invite_url=$($invite.invite_url)"

  Log "7) Claim device..."
  $claim = PostJson "$base/api/device/claim" @{ token=$invite.token; device_fingerprint=$deviceFp }
  Log "   OK: device claimed (device_fingerprint=$deviceFp)"

  Log "8) Check-in..."
  $cin = PostJson "$base/api/attendance/checkin" @{
    device_fingerprint=$deviceFp
    qr=@{ site_id=$siteId; type="IN" }
    lat=$homeLat
    lon=$homeLon
    accuracy_m=$acc
  }
  Log "   OK: IN event_id=$($cin.event_id) location_status=$($cin.location_status)"

  Start-Sleep -Seconds 2

  Log "9) Checkout..."
  $cout = PostJson "$base/api/attendance/checkout" @{
    device_fingerprint=$deviceFp
    lat=$outLat
    lon=$outLon
    accuracy_m=$acc
  }
  Log "   OK: OUT event_id=$($cout.event_id) location_status=$($cout.location_status)"

  Log "10) Fetch last attendance events (top 5)..."
  $events = Invoke-RestMethod -Method Get -Uri "$base/admin/attendance-events" -Headers $hdr
  $top = $events | Select-Object -First 5
  Log ("   Top events: " + (J $top))

  $now = Get-Date
  $year = $now.Year
  $month = $now.Month
  $dateStr = $now.ToString("yyyy-MM-dd")

  Log "11) Monthly report for employee_id=$empId year=$year month=$month..."
  $rep = Invoke-RestMethod -Method Get -Uri "$base/api/admin/monthly/employee?employee_id=$empId&year=$year&month=$month" -Headers $hdr
  $day = $rep.days | Where-Object { $_.date -eq $dateStr } | Select-Object -First 1
  Log ("   Today (" + $dateStr + ") = " + (J $day))
  Log ("   Totals = " + (J $rep.totals))

  $outObj = [ordered]@{
    base_url = $base
    department = $dep
    employee = $emp
    work_rule = $rule
    home_location = $homeRes
    invite = $invite
    claim = $claim
    checkin = $cin
    checkout = $cout
    today_report = $day
    totals = $rep.totals
    top_events = $top
  }
  $outObj | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $env:JSONFILE

  Log "=== TEST PASSED ==="
  Log "Share these files: $($env:LOGFILE) and $($env:JSONFILE)"
  exit 0
}
catch {
  Log "!!! TEST FAILED !!!"
  Log ($_ | Out-String)
  try {
    if ($_.Exception.Response -and $_.Exception.Response.GetResponseStream()) {
      $sr = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
      $body = $sr.ReadToEnd()
      Log ("ResponseBody: " + $body)
    }
  } catch {}
  exit 1
}
