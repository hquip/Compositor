# Local verification of preview 0.7.0

Verified on Windows on October 8, 2026. This release adds independent filter masks/opacity and saves format 14, with versions 1–13 still readable. See [filter masks](filter-masks.md) for operation details and limits.

| Coverage | Result |
| --- | --- |
| Unit, pixel/precision/mask geometry, native/reference stores and phone archives | 51 passed |
| Windows UI/native filesystem | 83 distinct cases passed; 1 skipped |
| Chromium/WebKit phone UI | 121 distinct cases passed; 1 skipped |
| Independent masks in actual Android WebView | 6 distinct cases passed, including actual ADB touch and cold restart |
| Native Android smoke | Local storage, cold restart, language preference, rendered pixels and synthetic Bayer DNG decoding passed |
| Windows Release build | 0 errors, 0 warnings |
| Android build/lint | Build passed; lint 0 errors, 17 existing template/resource warnings |
| iOS native references/plugins | Static check passed; Xcode compilation remains outstanding |
| Runtime assets | 95 shared files match source, Windows package, phone web bundle, Android APK and iOS bundle; phone CSS also matches APK |

Counts combine broad regression runs with successful targeted corrections, counting duplicates once: 261 passed cases and 2 skips. Tests now wait for the painted-mask preview and stable canvas position; native touch calibration runs before opening the paint dialog. The task emulator's System UI not-responding dialog was dismissed before repeating native touch acceptance. Two cases affected by an ADB connection restart passed when rerun separately, followed by the successful native smoke. The Windows skip needs the Mac-saved artifact. WebKit multi-touch injection uses Chromium-only CDP and remains skipped.

The mask cases cover selections, independent opacity and visibility, mask painting/feathering, English/Chinese values, outer-dialog cancellation, reorder/removal, fresh owned filenames for layer copies/presets/actions, 16-bit TIFF pixels, source preservation, legacy-version snapshots, cold recovery and mask-aware history fingerprints. Scalar tests cover premultiplied transparency and constant-mask border feathering. New resources are checked for missing/unsafe/malformed references before native or portable saves.

Mac source includes per-filter resource preservation, validation, normalized numeric coverage sampling, eight-bit filter mixing, duplication and opacity/visibility/removal controls. Mac source/tests and the native iOS app have not been compiled with Xcode here. Native Mac mask painting, sixteen-bit native Mac editing, Smart Object/filter PSD serialization, editable-stack expanded blur bounds, 32-bit HDR and universal large-document performance remain outstanding.

Packages:

- `dist/windows/Compositor-Windows-0.7.0-x64.zip`: 9.61 MiB; 23.96 MiB unpacked. SHA-256 `0E070EF33F580C0F4ABF93F45F416CA86A1C4262266C8810FB318A4205C827EB`.
- `dist/mobile/Compositor-Android-0.7.0-debug.apk`: 14.51 MiB, debug signed. SHA-256 `B209CC98F947382A75506E11161598A2315FF47CBA38D3FCA7E83A7FC1062930`.

Hashes are also in `dist/SHA256-0.7.0.txt`. No repository was created or pushed and no physical Android device was changed. The task-owned emulator was stopped after acceptance.
