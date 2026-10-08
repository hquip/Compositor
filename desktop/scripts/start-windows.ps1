$ErrorActionPreference = 'Stop'
$desktopDirectory = Split-Path $PSScriptRoot -Parent
$project = Join-Path $desktopDirectory 'windows/Compositor.Windows.csproj'
node (Join-Path $PSScriptRoot 'bundle-vendor.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime asset build failed.' }
& (Join-Path $PSScriptRoot 'build-pixels.ps1')
node (Join-Path $PSScriptRoot 'verify-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime assets are incomplete.' }
dotnet build $project --configuration Release --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }
& (Join-Path $desktopDirectory 'windows/bin/Release/net48/Compositor.exe')
