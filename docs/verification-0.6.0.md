# Local verification of preview 0.6.0

Verified on Windows on October 8, 2026. This release adds shared editable paths and vector-backed masks, saves format 13, and preserves versions 1–12 for reading. See [vector workflows](vector-workflows.md) for controls and limits.

| Coverage | Result |
| --- | --- |
| Unit, reference/native stores, phone archives, pixel/color/geometry kernels | 46 passed |
| Windows UI and native filesystem | 77 distinct cases passed; 1 skipped |
| Phone Chromium and WebKit UI | 109 distinct cases passed; 1 skipped |
| New path cases in an actual Android WebView/emulator | 8 passed |
| Native Android smoke | ADB touch, local storage, cold restart, language preference, rendered pixels and synthetic Bayer DNG decoding passed |
| Windows Release build | 0 errors, 0 warnings |
| Android build and lint | Build passed; lint 0 errors, 17 existing template/resource warnings |
| iOS source wiring | Static reference/plugin check passed; Xcode compilation remains outstanding |
| Runtime asset identity | 91 shared files match source, Windows package, phone web bundle, Android APK and iOS bundle; phone CSS also matches APK |

Counts include broad regression runs and successful targeted reruns after correcting the smooth/corner expectation, coordinate assertion and recovery-test restart procedure. Duplicate reruns are counted once. Native Android taps use ADB calibrated against the WebView's actual frame; CDP's inherited context does not enable Playwright touchscreen emulation. The Windows skip needs the Mac-saved CI artifact. The WebKit skip uses Chromium-only multi-touch injection.

The vector cases verify real touch/mouse creation, Bézier handles, exact cubic splitting, compound holes, editable masks, unchanged cache preservation, cancellation, duplication, PSD raster delivery, Chinese controls, independent handles, draft recovery after restart, image resizing and pixel/filter previews on path layers. The Windows/native/reference/archive readers reject malformed geometry and version-12 manifests carrying version-13 data.

Native Mac source adds format validation and geometry preservation through opening, saving, duplication, canvas resizing and image resizing. Native Mac path authoring is not implemented, and neither the new Mac source/tests nor the native iOS application has been compiled on Xcode in this environment. Photoshop application acceptance and physical stylus acceptance remain outstanding.

Packages are `dist/windows/Compositor-Windows-0.6.0-x64.zip` (9.61 MiB; 23.94 MiB unpacked) and `dist/mobile/Compositor-Android-0.6.0-debug.apk` (14.51 MiB). The Android package is debug signed. SHA-256 values are recorded in `dist/SHA256-0.6.0.txt`:

- Windows ZIP: `B1930D3EDEF374C299E0BDE2AE751FE9EA547E4EF4C87EB6DD14AD34D60CAEAE`
- Android APK: `AA23BC9CFC22F9D3E6C2F8625733C8DC28A0B3BD7CE5BCB280B9AEA5F9549B6C`

No repository was created or pushed; the physical Android device was not changed. The task-owned emulator was stopped after acceptance.
