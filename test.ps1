Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Id -ne $null } | ForEach-Object {
    $cmdline = ""
    try {
        $wmi = Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue
        $cmdline = $wmi.CommandLine
    } catch {}
    [PSCustomObject]@{
        Id = $_.Id
        CommandLine = $cmdline
    }
} | Format-Table -AutoSize
