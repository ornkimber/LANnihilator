# This fixed script is embedded in the executable. It uses the local Windows
# NetAdapter provider only: no remote CIM session or network connection.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Get-Eligible {
    @(Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetAdapter |
        Where-Object {
            $_.HardwareInterface -and -not $_.Virtual -and
            $_.InterfaceType -eq 6 -and $_.NdisPhysicalMedium -eq 14 -and
            $_.PNPDeviceID -like 'PCI\*'
        })
}
function Get-Identity($adapter) {
    ([Guid]$adapter.InterfaceGuid).ToString('D').ToLowerInvariant()
}
function Get-Enabled($adapter) {
    # MSFT_NetAdapter can leave this inherited property null on healthy devices.
    # Do not cast null to zero in snapshots while rejecting it during toggles.
    $problem = $adapter.ConfigManagerErrorCode
    if ($problem -eq 22) { return $false }
    if ($null -ne $problem -and $problem -ne 0) { return $null }
    if ($adapter.InterfaceAdminStatus -eq 1) { return $true }
    if ($adapter.InterfaceAdminStatus -eq 2) { return $false }
    return $null
}
function Get-StateDetail($adapter) {
    $admin = if ($null -eq $adapter.InterfaceAdminStatus) { 'not reported' } else { [string]$adapter.InterfaceAdminStatus }
    $problem = if ($null -eq $adapter.ConfigManagerErrorCode) { 'not reported' } else { [string]$adapter.ConfigManagerErrorCode }
    "admin=$admin, driver error=$problem"
}

try {
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    $elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($Action -eq 'toggle') {
        if (-not $elevated) { throw 'Administrator permission required. Close the app and explicitly Run as administrator. No elevation was attempted.' }
        $target = @(Get-Eligible | Where-Object { (Get-Identity $_) -eq $TargetGuid })
        if ($target.Count -ne 1) { throw 'The selected physical Ethernet adapter is missing or ambiguous. No fallback is allowed.' }
        $current = Get-Enabled $target[0]
        if ($null -eq $current) { throw "Adapter state is unknown or faulty ($(Get-StateDetail $target[0])). Operation refused. Rescan before retrying." }
        if ($current -ne $ExpectedEnabled) { throw 'Adapter state changed outside the application. Rescan and try again.' }
        if ($target[0].AdminLocked) { throw 'This adapter is locked by Windows policy. Contact your administrator.' }
        $method = if ($ExpectedEnabled) { 'Disable' } else { 'Enable' }
        $result = Invoke-CimMethod -InputObject $target[0] -MethodName $method
        if ($result.ReturnValue -ne 0) { throw "Windows rejected $method (provider code $($result.ReturnValue)). State is unconfirmed; rescan before retrying." }
        $confirmed = $false
        $lastState = 'selected adapter not present'
        for ($attempt = 0; $attempt -lt 24; $attempt++) {
            $target = @(Get-Eligible | Where-Object { (Get-Identity $_) -eq $TargetGuid })
            if ($target.Count -eq 1) {
                $lastState = Get-StateDetail $target[0]
                $observed = Get-Enabled $target[0]
                # Unknown states during a driver transition are not success and
                # must not abort verification before the next bounded poll.
                if ($null -ne $observed -and $observed -eq (-not $ExpectedEnabled)) {
                    $confirmed = $true
                    break
                }
            }
            Start-Sleep -Milliseconds 200
        }
        if (-not $confirmed) { throw "Windows did not confirm the requested state ($lastState). It may still change. Rescan or use ncpa.cpl to recover." }
    }
    $adapters = @(Get-Eligible | ForEach-Object {
        @{
            id = Get-Identity $_
            name = [string]$_.Name
            description = [string]$_.InterfaceDescription
            admin = [uint32]$_.InterfaceAdminStatus
            media = [uint32]$_.MediaConnectState
            problem = if ($null -eq $_.ConfigManagerErrorCode) { $null } else { [uint32]$_.ConfigManagerErrorCode }
        }
    })
    @{ adapters = $adapters; elevated = $elevated } | ConvertTo-Json -Depth 4 -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
