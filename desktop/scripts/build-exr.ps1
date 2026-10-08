param([string]$SdkDirectory, [string]$SourceDirectory)
$ErrorActionPreference = 'Stop'
$workspace = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$toolsDirectory = Join-Path $workspace 'dist/tooling'
if (-not $SdkDirectory) { $SdkDirectory = if ($env:EMSDK) { $env:EMSDK } else { Join-Path $toolsDirectory 'emsdk' } }
if (-not $SourceDirectory) { $SourceDirectory = Join-Path $toolsDirectory 'openexr-source' }
$emcmake = Join-Path $SdkDirectory 'upstream/emscripten/emcmake.py'
$python = Join-Path $SdkDirectory 'python/3.13.3_64bit/python.exe'
if (-not (Test-Path -LiteralPath $emcmake) -or -not (Test-Path -LiteralPath $python)) { throw 'Install and activate Emscripten 4.0.18, then supply -SdkDirectory.' }
if (-not (Test-Path -LiteralPath $SourceDirectory)) {
    git clone --depth 1 --branch v3.4.16 https://github.com/AcademySoftwareFoundation/openexr.git $SourceDirectory
    if ($LASTEXITCODE -ne 0) { throw 'Could not obtain the OpenEXR source.' }
}
$commit = (git -C $SourceDirectory rev-parse HEAD).Trim()
if ($commit -ne '37d012e2faa04dbf00ca169682ee1eb6d9e8603e') { throw 'Use the pinned OpenEXR v3.4.16 source commit.' }
$build = Join-Path $toolsDirectory 'openexr-build'
& $python $emcmake cmake -S (Join-Path $workspace 'desktop/native/exr') -B $build -G Ninja ('-DOPENEXR_SOURCE=' + [IO.Path]::GetFullPath($SourceDirectory)) '-DCMAKE_BUILD_TYPE=MinSizeRel' '-DCMAKE_C_FLAGS=-Oz -flto' '-DCMAKE_CXX_FLAGS=-Oz -flto -fexceptions'
if ($LASTEXITCODE -ne 0) { throw 'OpenEXR configuration failed.' }
cmake --build $build --target compositor-exr --parallel 4
if ($LASTEXITCODE -ne 0) { throw 'OpenEXR compilation failed.' }
$prebuilt = Join-Path $workspace 'desktop/native/exr/prebuilt'
New-Item -ItemType Directory -Path $prebuilt -Force | Out-Null
$files = [ordered]@{}
foreach ($name in @('compositor-exr.mjs', 'compositor-exr.wasm')) {
    Copy-Item -LiteralPath (Join-Path $build $name) -Destination $prebuilt -Force
    $files[$name] = (Get-FileHash -LiteralPath (Join-Path $prebuilt $name) -Algorithm SHA256).Hash.ToLowerInvariant()
}
$runtime = [ordered]@{ openexr = '3.4.16'; openexrCommit = $commit; emscripten = '4.0.18'; imath = '3.2.2'; libdeflate = '1.25'; openjph = '0.31.0'; files = $files }
[IO.File]::WriteAllText((Join-Path $workspace 'desktop/native/exr/runtime.json'), ($runtime | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'LICENSE.md') -Destination (Join-Path $workspace 'desktop/third-party/OpenEXR-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $SourceDirectory 'external/deflate/COPYING') -Destination (Join-Path $workspace 'desktop/third-party/Libdeflate-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $build '_deps/imath-src/LICENSE.md') -Destination (Join-Path $workspace 'desktop/third-party/Imath-LICENSE.txt') -Force
Copy-Item -LiteralPath (Join-Path $build '_deps/openjph-src/LICENSE') -Destination (Join-Path $workspace 'desktop/third-party/OpenJPH-LICENSE.txt') -Force
Write-Output 'OpenEXR runtime and pinned checksums updated. Run the normal asset build to copy them into the renderer.'
