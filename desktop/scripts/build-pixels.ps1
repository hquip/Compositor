$ErrorActionPreference = 'Stop'
$desktopDirectory = Split-Path $PSScriptRoot -Parent
$workspace = Split-Path $desktopDirectory -Parent
$sources = Get-ChildItem -LiteralPath (Join-Path $workspace 'Compositor/Rendering') -Filter '*.c' | Select-Object -ExpandProperty FullName
$portableSources = Get-ChildItem -LiteralPath (Join-Path $desktopDirectory 'native') -Filter '*.c' | Select-Object -ExpandProperty FullName
$output = Join-Path $desktopDirectory 'renderer/pixels.wasm'
& clang --target=wasm32 -Oz -std=c11 -nostdlib -fno-builtin -fblocks -I (Join-Path $desktopDirectory 'native/compat') $sources $portableSources '-Wl,--no-entry' '-Wl,--export-all' '-Wl,--allow-undefined' '-Wl,--initial-memory=131072' '-Wl,--max-memory=2147483648' -o $output
if ($LASTEXITCODE -ne 0) { throw 'Pixel kernel compilation failed.' }
Write-Output ('Shared C kernels: ' + $output)
