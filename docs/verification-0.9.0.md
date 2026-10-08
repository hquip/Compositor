# Preview 0.9.0 local verification — 2026-10-08

This release adds the bounded [OpenEXR workflow](openexr.md) to Windows and the shared Android/iOS editor. It retains project format 15. The previous [0.8.0 report](verification-0.8.0.md) remains the full regression baseline; the checks below cover all unit tests and the affected UI/native paths. They do not establish universal EXR or Photoshop/Mac rendering parity.

## Results

| Check | Result |
| --- | --- |
| Unit/reference/native-store/archive/color/pixel tests | 68 passed, including 13 OpenEXR cases |
| Targeted Windows WebView2/native file tests | 12 passed: 5 EXR, 6 smart/HDR, 1 existing native HDR save/export |
| Chromium and WebKit phone tests | 22 passed: 11 per browser; final EXR cases repeated after the last runtime changes |
| Actual Android API 36 WebView | 5 passed: 4 shared EXR cases plus native save/cold restart/share export |
| Windows build | 0 warnings, 0 errors |
| Android debug build and lint | Build passed; lint has 0 errors and 17 existing warnings |
| iOS project/plugin wiring | Static check passed; Xcode build not run |
| Distribution identity | 105 shared runtime files matched Windows directory/ZIP, mobile web assets, Android assets/APK and iOS bundle |

**107 unique cases passed; 0 skipped in this task's selected checks.** Targeted reruns count once. The real file-picker test caught an import busy-state guard that initially skipped the HDR commit; the corrected ordinary Windows/phone import path passed. Native share acceptance uses a unique project/export name and Android API 36's resumed-activity field to avoid stale fixtures and ambiguous selections.

## Independent file acceptance

The official OpenEXR **3.4.4** Python wheel generated fixtures, installed only under `dist/tooling/openexr-reference` for development. The application decoder read HALF16/FLOAT32 files using None/ZIPS/ZIP, including partial final blocks, premultiplied fractional alpha, negative colors, highlights and negative/nonzero window origins. Grayscale Y and a named ACEScg pass with ignored depth/UINT IDs also passed.

The official decoder accepted all six precision/compression combinations emitted by the application and verified premultiplied samples and color metadata. Tests checked ACES white-point adaptation, preset color round trips, half rounding/subnormals/overflow, unknown/conflicting tags, zero-alpha emission rejection, corrupt offsets, truncated chunks, ZIP checksum failure and excess decompression output. Display preview settings did not change exported radiance or protected source assets.

The native Android test saved an imported EXR as a project using native storage, force-stopped/restarted the app, reopened the saved project and compared the canonical float source bytes. Native sharing wrote an EXR to app cache, opened the system share chooser and returned after dismissal; the written file's highlight and fractional alpha were decoded and checked. Only the task-owned `Compositor_Test_API36` / `emulator-5580` was used. No physical Android device was modified.

## Artifacts

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `dist/windows/Compositor-Windows-0.9.0-x64.zip` | 9.64 MiB; 24.05 MiB unpacked | `837EE9D37CA0AD201A016C63775512AC9D7D78C4D194087CECF2E55F91F74D27` |
| `dist/mobile/Compositor-Android-0.9.0-debug.apk` | 14.62 MiB | `FB2106D160021E50D9D70B333EE208F7C7E1DAC1DB5D1872C9A3006A85DF9A89` |

Windows is an unsigned portable build; Android is debug signed. Checksums are also in `dist/SHA256-0.9.0.txt`, and resource comparison details are in `dist/asset-verification-0.9.0.json`. Earlier release artifacts were retained. Nothing was pushed or published.

## Remaining boundaries

Internal HDR editing remains linear sRGB float32 and the interface remains an SDR preview. EXR import/export supports the documented linear input/output conversion; this is not native HDR monitor output or configurable OCIO/float ICC editing. Unsupported EXR compression, deep/tiled/multipart data, subsampling, arbitrary pass preservation and zero-alpha emission require conversion in another tool. Imports embed normalized canonical TIFF data, not the original EXR container.

The original Mac app still lacks these shared-editor EXR controls and uses its existing HDR PNG cache display. Mac source and native iOS builds/devices have not been verified with Xcode. Browser WebKit acceptance does not replace that native acceptance.
