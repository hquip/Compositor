$ErrorActionPreference = 'Stop'
$desktopDirectory = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $desktopDirectory -Parent
$project = Join-Path $desktopDirectory 'windows/Compositor.Windows.csproj'
node (Join-Path $PSScriptRoot 'bundle-vendor.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime asset build failed.' }
& (Join-Path $PSScriptRoot 'build-pixels.ps1')
node (Join-Path $PSScriptRoot 'verify-assets.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Runtime assets are incomplete.' }
dotnet build $project --configuration Release --verbosity minimal
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed.' }

$buildDirectory = Join-Path $desktopDirectory 'windows/bin/Release/net48'
$outputDirectory = [IO.Path]::GetFullPath((Join-Path $workspace 'dist/windows'))
$package = Get-Content -LiteralPath (Join-Path $desktopDirectory 'package.json') -Raw | ConvertFrom-Json
$packageName = 'Compositor-' + $package.version
$packageDirectory = [IO.Path]::GetFullPath((Join-Path $outputDirectory $packageName))
if ($packageDirectory -ne [IO.Path]::Combine($outputDirectory, $packageName) -or
    -not $outputDirectory.StartsWith([IO.Path]::GetFullPath($workspace) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Invalid build output path.'
}
New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
foreach ($name in @('Compositor.exe', 'Compositor.exe.config', 'Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2Loader.dll', 'LICENSE')) {
    Copy-Item -LiteralPath (Join-Path $buildDirectory $name) -Destination $packageDirectory
}
New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'renderer') -Force | Out-Null
Copy-Item -Path (Join-Path $desktopDirectory 'renderer/*') -Destination (Join-Path $packageDirectory 'renderer') -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $packageDirectory 'third-party') -Force | Out-Null
Copy-Item -Path (Join-Path $desktopDirectory 'third-party/*') -Destination (Join-Path $packageDirectory 'third-party') -Recurse -Force
Copy-Item -LiteralPath (Join-Path $desktopDirectory 'README.md') -Destination (Join-Path $packageDirectory 'README.md')
Copy-Item -LiteralPath (Join-Path $desktopDirectory 'WINDOWS-README.txt') -Destination $packageDirectory

$archive = Join-Path $outputDirectory ('Compositor-Windows-' + $package.version + '-x64.zip')
Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archive -Force
$total = (Get-ChildItem -LiteralPath $packageDirectory -Recurse -File | Measure-Object -Property Length -Sum).Sum
Write-Output ('App: ' + (Join-Path $packageDirectory 'Compositor.exe'))
Write-Output ('Program files: ' + [math]::Round($total / 1MB, 2) + ' MiB')
Write-Output ('Portable ZIP: ' + $archive)
Write-Output ('ZIP size: ' + [math]::Round((Get-Item -LiteralPath $archive).Length / 1MB, 2) + ' MiB')
