$ErrorActionPreference = 'SilentlyContinue'

$procs = Get-Process node -ErrorAction SilentlyContinue | Where-Object {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    $cmd -like '*surf*host*'
}

if (-not $procs) {
    Write-Host "No surf host process found."
    exit 0
}

foreach ($p in $procs) {
    Write-Host "Killing surf host PID $($p.Id)"
    Stop-Process -Id $p.Id -Force
}

Write-Host "Done. Chrome will respawn host on next native-messaging connect."
