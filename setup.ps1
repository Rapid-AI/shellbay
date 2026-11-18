# Run in Windows PowerShell or PowerShell 7 from the Shell Bay folder.
$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    foreach ($command in 'go', 'node', 'npm.cmd') {
        if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
            throw "Install $command first. See README.md."
        }
    }

    $wailsVersion = 'v2.17.1'
    $goBin = go env GOBIN
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the Go configuration.' }
    if (-not $goBin) { $goBin = Join-Path (go env GOPATH) 'bin' }
    $wails = Join-Path $goBin 'wails.exe'
    if (-not (Test-Path $wails) -or (& $wails version | Select-Object -First 1) -ne $wailsVersion) {
        go install "github.com/wailsapp/wails/v2/cmd/wails@$wailsVersion"
        if ($LASTEXITCODE -ne 0) { throw 'Wails installation failed.' }
    }

    & $wails build -trimpath -skipbindings
    if ($LASTEXITCODE -ne 0) { throw 'The Shell Bay build failed.' }
    Write-Host 'Build complete. Look for ShellBay.exe in build\bin.'
} finally {
    Pop-Location
}
