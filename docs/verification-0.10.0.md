# Preview 0.10.0 local verification — 2026-10-08

This release extends the Windows/mobile shared editor with PIZ/tiled/multipart EXR, retained Deep originals and depth-range previews, configurable linear HDR working spaces and conditional extended HDR display. New saves use format 16. See [OpenEXR/HDR semantics](openexr.md) and [project format](project-format.md). The original Mac app's new transport/source preservation has not been compiled with Xcode.

| Check | Result |
| --- | --- |
| All unit/reference/native-store/archive/color/pixel tests | 75 passed; 0 skipped |
| Targeted Windows WebView2/native-file tests | 20 unique cases passed |
| Chromium/WebKit phone EXR/smart/HDR tests | 32 passed; 2 additional GPU tests skipped because no adapter was exposed |
| Actual Android API 36 WebView | 10 passed; 1 GPU test skipped because no adapter was exposed |
| Windows build | 0 warnings, 0 errors |
| Android build/lint | Build passed; 0 lint errors, 17 existing warnings |
| iOS project/plugin wiring | Static check passed; Xcode build not run |
| Runtime/package identity | 111 shared files matched Windows directory/ZIP, mobile web assets, Android assets/APK and iOS bundle |

**137 unique cases passed; 3 GPU-environment checks skipped.** Targeted reruns count once. This is affected-path acceptance, not a rerun of every historical editor test or a declaration of universal Photoshop/Mac compatibility.

The official OpenEXR 3.4.16 library generated PIZ, partial tiles, multipart and Deep scanline fixtures. A separate official C++ writer generated a Deep tiled fixture, whose per-channel samples were independently read using the native Python library. Tests validated sorting/Over composition, depth clipping, empty pixels and fractional alpha; source/sample limits; explicit part/level selection; wide-space source persistence; and reference/native/phone archive round trips. The native library also accepted WASM-produced PIZ tiled multipart exports.

Windows real file-dialog tests verified byte-identical original Deep export and visible-layer PIZ tiled multipart delivery. Working-space changes retained source pixels. Deep range changes preserved original EXR bytes and supported undo. Multipart layers shared one original resource, and deleting a part left the remaining source readable. Source replacement/duplication/cross-tab copying retain or release the EXR references consistently.

The Windows WebGPU test compiled the shipping HDR shader, rendered `[4, 2, 1, 1]` into an actual `rgba16float` target and read back red above one (about 1.825 after extended-sRGB encoding), proving that the rendering path did not quantize it to an SDR byte target. This test does not establish physical screen luminance. Native extended display also requires high-dynamic-range display reporting and an accepted extended canvas configuration. The tested phone browser engines/emulator lacked adapters for the additional shader test; real HDR phone/Mac browser brightness/headroom acceptance remains outstanding.

Android tests passed after dismissing a System UI ANR from emulator boot that had obscured the native editor frame. The application was restarted and the full selected native suite rerun. It passed PIZ/deep/multipart import, working-space changes, source reopening, language/SDR fallback, native save, force-stop/cold restart and native share output. Only `Compositor_Test_API36` / `emulator-5580` was used; no physical device was modified.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `dist/windows/Compositor-Windows-0.10.0-x64.zip` | 9.91 MiB; 24.82 MiB unpacked | `CE8BD61078BCC156AF8BD629F941362DBF5D1126A81E0024FA5716ECBAE4EED5` |
| `dist/mobile/Compositor-Android-0.10.0-debug.apk` | 14.93 MiB | `1F93018DD27CC8A251F044D19A4EDD4CB6306844308281C33BB719CD7CD1B24E` |

The Windows portable build is unsigned; Android is debug signed. Earlier artifacts were retained. The supplied EXR module uses OpenEXR 3.4.16 with Imath 3.2.2, libdeflate 1.25 and OpenJPH 0.31.0; source/toolchain pins and hashes are in `desktop/native/exr/runtime.json`, with the reproducible build wrapper in `desktop/scripts/build-exr.ps1`. Python/Node/Emscripten are development tools and are not shipped.

Native Mac source and new tests preserve wide-source descriptors, working/display settings and full EXR originals through save/load/duplication/canvas metadata changes. These remain uncompiled. The original SwiftUI Mac interface continues to display the existing PNG cache; it has not gained the shared WebGPU HDR renderer or complete native EXR controls. iOS native compilation/device acceptance also requires macOS/Xcode. No repository was pushed or published.
