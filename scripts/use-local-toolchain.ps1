param([Uri]$ProxyUrl)

# Dot-source this helper to use the workspace-local build tools. It changes
# only this PowerShell process and its children, never Windows configuration.
$taskTools = Join-Path (Split-Path -Parent $PSScriptRoot) '.tools'
$taskVcVersion = Get-ChildItem (Join-Path $taskTools 'BuildTools/VC/Tools/MSVC') -Directory -ErrorAction Stop |
    Sort-Object { [Version]$_.Name } -Descending | Select-Object -First 1
$taskVcRoot = $taskVcVersion.FullName
$taskSdkRoot = Join-Path $taskTools 'windows-sdk'
$taskSdkVersion = (Get-ChildItem (Join-Path $taskSdkRoot 'Lib') -Directory -ErrorAction Stop |
    Where-Object Name -Match '^\d+\.\d+\.\d+\.\d+$' |
    Sort-Object { [Version]$_.Name } -Descending | Select-Object -First 1).Name
$taskCompiler = Join-Path $taskVcRoot 'bin/Hostx64/x64'
$taskSdkBin = Join-Path $taskSdkRoot "bin/$taskSdkVersion/x64"
$taskLibraryPaths = @(
    (Join-Path $taskVcRoot 'lib/x64'),
    (Join-Path $taskSdkRoot "Lib/$taskSdkVersion/um/x64"),
    (Join-Path $taskSdkRoot "Lib/$taskSdkVersion/ucrt/x64")
)
$taskIncludePaths = @((Join-Path $taskVcRoot 'include'))
foreach ($taskIncludeKind in @('um', 'shared', 'ucrt', 'winrt')) {
    $taskIncludePaths += Join-Path $taskSdkRoot "Include/$taskSdkVersion/$taskIncludeKind"
}
foreach ($taskRequired in @(
    (Join-Path $taskCompiler 'cl.exe'),
    (Join-Path $taskCompiler 'link.exe'),
    (Join-Path $taskSdkBin 'rc.exe'),
    (Join-Path $taskLibraryPaths[0] 'libcmt.lib'),
    (Join-Path $taskLibraryPaths[1] 'kernel32.lib'),
    (Join-Path $taskLibraryPaths[2] 'ucrt.lib'),
    (Join-Path $taskSdkRoot "Include/$taskSdkVersion/shared/winapifamily.h")
)) {
    if (-not (Test-Path -LiteralPath $taskRequired)) {
        throw "Local toolchain file missing: $taskRequired. Use a normal installed MSVC/Windows SDK toolchain instead."
    }
}
if (Test-Path (Join-Path $taskTools 'cargo/bin/cargo.exe')) {
    $env:RUSTUP_HOME = Join-Path $taskTools 'rustup'
    $env:CARGO_HOME = Join-Path $taskTools 'cargo'
    $env:PATH = (Join-Path $taskTools 'cargo/bin') + ';' + $env:PATH
}
$env:PATH = $taskCompiler + ';' + $taskSdkBin + ';' + $env:PATH
$env:LIB = $taskLibraryPaths -join ';'
$env:INCLUDE = $taskIncludePaths -join ';'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = Join-Path $taskCompiler 'link.exe'
$env:CC = Join-Path $taskCompiler 'cl.exe'
$env:CXX = $env:CC
$env:AR = Join-Path $taskCompiler 'lib.exe'
$env:RC = Join-Path $taskSdkBin 'rc.exe'
$env:WindowsSdkDir = $taskSdkRoot + '\'
$env:WindowsSDKVersion = $taskSdkVersion + '\'
$env:VCToolsInstallDir = $taskVcRoot + '\'
if ($ProxyUrl) {
    if ($ProxyUrl.Scheme -notin @('http', 'https')) { throw 'Use an HTTP or HTTPS build proxy.' }
    $env:HTTP_PROXY = $ProxyUrl.AbsoluteUri
    $env:HTTPS_PROXY = $env:HTTP_PROXY
    $env:CARGO_HTTP_PROXY = $env:HTTP_PROXY
    $env:CARGO_HTTP_MULTIPLEXING = 'false'
}
Write-Output "Using workspace MSVC $($taskVcVersion.Name) and Windows SDK $taskSdkVersion"
