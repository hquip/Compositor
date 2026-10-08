# Local verification of preview 0.8.0

Verified on Windows on October 8, 2026. New saves use format 15; versions 1–14 remain readable. See [smart objects and HDR](smart-hdr.md) for supported operations, formats and limits.

| Coverage | Result |
| --- | --- |
| Unit, reference/native stores, archives, pixel/color/float geometry | 55 passed |
| Windows UI/native filesystem | 90 distinct cases passed; 1 skipped |
| Chromium/WebKit phone UI | 133 passed; 1 skipped |
| Smart-object/HDR cases in actual Android WebView | 6 passed |
| Native Android smoke | Storage, cold restart, language preference, pixels and synthetic Bayer DNG decoding passed |
| Windows Release build | 0 errors, 0 warnings |
| Android build/lint | Build passed; lint 0 errors, 17 existing template/resource warnings |
| iOS references/plugins | Static check passed; Xcode compilation remains outstanding |
| Packaged runtime identity | 101 shared files match source, Windows package, Android APK, phone web bundle and iOS bundle; phone CSS matches APK |

There are 284 distinct passed cases and 2 skips across broad runs and targeted checks; repeated cases are counted once. The skips need the Mac-saved round-trip artifact or Chromium-specific multi-touch injection. A float blur unit check found a missing vertical stride argument; after correcting it, the float-source unit suite passed. The final shared tests also cover cached HDR reopen, protected object replacement and embedded PNG/placed-layer PSD records.

The Windows native HDR check exports a real float32 TIFF, verifies highlights/negative values/alpha, saves a smart/HDR `.comp` through native dialogs and reads its unchanged TIFF original using the reference/native store. Portable archives validate the same raw asset format. Smart content tabs apply rasterized contents back to a live parent as one edit. Tests do not establish Photoshop application behavior, every HDR operation/profile or full Smart Object round-trip equivalence.

Native Mac source preserves raw TIFF bytes, object identity, caches, masks, filters and preview settings; protected pixel mutation is blocked until explicit preview rasterization. The native Mac source/new tests have not been compiled with Xcode here. Native Mac content editing/HDR rendering, native iOS compilation and physical stylus acceptance remain outstanding.

Packages:

- `dist/windows/Compositor-Windows-0.8.0-x64.zip`: 9.63 MiB, 24.02 MiB unpacked. SHA-256 `F3BF07802D6BBA1B1D00C6448047B35FA6C67211DD00496E321F841F2E73997E`.
- `dist/mobile/Compositor-Android-0.8.0-debug.apk`: 14.52 MiB, debug signed. SHA-256 `ABC4A7170F291BC880E0F8E5387814E8D2D89C696E87826F70CFA4768FD5618F`.

Hashes also appear in `dist/SHA256-0.8.0.txt`. No repository was created or pushed; no physical Android device was changed. The task-owned emulator was stopped after acceptance.
