# Preview 0.5.0 local verification

Verified on Windows across October 7–8, 2026. No GitHub repository was created or pushed, and no remote workflow ran. Counts below count each test once; full suites were supplemented by targeted native export, rollback, and phone-layout checks.

| Check | Result |
| --- | --- |
| Windows Release build / portable package | Passed, zero warnings/errors |
| Unit, native-store, archive, pixel, precision and pen tests | 43 passed |
| Packaged Windows UI/native-file coverage | 69 passed, 1 skipped |
| Chromium/WebKit phone UI coverage | 93 passed, 1 skipped |
| Actual Android WebView/emulator coverage | 41 passed |
| Final Android native smoke | Actual touch, local save, cold restart, language preference, rendered pixels and synthetic Bayer DNG decoding passed |
| Android APK / lint | Build passed; 0 lint errors, 17 template/resource warnings |
| iOS project references and native plugin wiring | Static check passed; no Xcode compilation |
| Workflow YAML | Parsed; not executed remotely |
| Packaged shared runtime resources | 88 files match source, Windows package, Android APK and iOS source bundle |

The Windows skip needs a Mac-saved project artifact. The WebKit skip needs Chromium's multi-touch injection protocol. Android testing uses only the task-owned `Compositor_Test_API36` emulator; the connected physical device was not installed or modified.

## New behavior exercised

- Editable filter ordering, toggling, removal, cancel, original-source preservation, project/archive round trips and native validation.
- Selection/mask edge refinement, expanded clone strokes, canceled-stroke restoration, blur expansion and undo.
- PSD/PSB layer/mask/group/text/composite encoding and actual Windows PSD file output.
- Genuine 16-bit sample round trips through PNG and TIFF, preserved least-significant bits, high-precision filters and compositing, ICC conversion, CMYK separation and soft proofing. CMYK conversion was tested with the locally installed `CoatedFOGRA39.icc`; that proprietary system profile is not shipped.
- Atomic native TIFF replacement retaining sixteen-bit samples and removing temporary exports.
- Font replacement, pressure-dependent stroke size, independent pen settings, action grouping and rollback, batch ZIP naming/project separation, recovery undo journals and fingerprint-checked saved history.
- Chinese filter, mask-refinement and color-proof dialogs on a phone viewport. Dialog controls scroll while headings and action buttons stay visible; relevant Chromium/WebKit and native Android cases were rechecked after the layout change.

The tests identified and corrected action-history aliasing, a mobile inspector modal blocking new commands, and intermittent chained-filter output caused by passing worker bitmap resources. Filter workers now transfer owned pixel buffers. The native Mac source includes format-12 persistence, eight-bit editable-filter controls, source-preservation tests, and high-precision safeguards, but those changes have not been compiled or executed with Xcode.

## Deliverables

- `dist/windows/Compositor-Windows-0.5.0-x64.zip`: about 9.60 MiB; program files about 23.92 MiB.
- `dist/mobile/Compositor-Android-0.5.0-debug.apk`: about 14.48 MiB.
- Phone UI captures: `dist/mobile/filters-0.5.0-zh.png`, `refine-mask-0.5.0-zh.png`, and `color-proof-0.5.0-zh.png`.

SHA-256:

- Windows ZIP: `F0D867D4150225E7C4C7619ADC47B95F1C0906FEB27ADCD883241D3BE36A8390`
- Android APK: `8C696988F2B43E09A6D09C4D24FD46CDF3C890F20675C5C928F01BE6793E5B3B`

## Material limits

New `.comp` saves use format 12 and require updated readers. Photography/print workflows support sixteen-bit sources and ICC-managed output, not full 32-bit HDR or native CMYK-channel editing. High-precision rendering is bounded to 16 megapixels and layer effects need an explicit eight-bit fallback. Photoshop itself, original Mac rendering/round trips, native iOS, real pen hardware, signing and updates remain unverified or unfinished. Full Photoshop vector/Smart Object/AI capabilities are not implemented. See [professional-workflows.md](professional-workflows.md) for exact behavior and [windows-migration.md](windows-migration.md) for acceptance scope.
