# Cross-platform migration acceptance

The Mac app is the behavioral reference. The Windows and mobile clients are **0.10.0 previews**, not a fully compatible release. Source implementation, local tests, and Mac/device verification are separate milestones. New saves use format 16 for protected raster objects and float32 HDR originals; versions 1–15 remain readable. See [smart objects and HDR](smart-hdr.md). See [filter masks](filter-masks.md). See [vector workflows](vector-workflows.md). The four editing areas addressed in 0.3.0 are detailed in [editing-parity.md](editing-parity.md); recovery, background filters, and floating selections are described in [reliability-0.4.0.md](reliability-0.4.0.md).

| Area | Implementation and local evidence | Remaining acceptance |
| --- | --- | --- |
| Windows host | WebView2/.NET build; portable package; native dialogs, clipboard and external reload | Signing, updater deployment, broader Windows devices |
| Pixel kernels | Nine original C files compiled to WASM; kernel tests | Full Core Graphics/Metal comparison on Mac |
| Adjustments/effects | Twelve adjustment types, six effects, Camera Raw controls; Windows edit/save tests | Full parameter and rendering parity; constrain crop and some preview controls |
| Layers/masks | Groups, nesting, clipping-source bake/unlink/delete, trimmed merges and reference retargeting, linked-mask distortion; shared regression coverage | Mac rendering verification, broader drag/PSD edge cases |
| Tools | Pending gradients, editable-color gradient fills, pixel movement/duplication/free transform, clone/heal source expansion, Unicode text, font substitution, pen pressure/tilt controls | Platform font differences, mask/multiple-layer floating transforms, physical stylus and native Mac rendering acceptance |
| Paths | Editable cubic anchors/handles, compound contours, fill/stroke, path selections and vector-backed masks, phone independent handles, draft recovery; format-13 round trips | Native Mac path authoring, simultaneous independent raster/vector masks, Boolean path operations, path text, SVG node import and lossless PSD vectors |
| Filters | Original C kernels, bounded previews, cancelable workers, coverage-aware mask filters, persistent per-layer filter stacks with independent masks/opacity and destructive blur-bound expansion | Editable-stack blur bounds, complete Camera Raw parity, general live compositing and large-document performance |
| Recovery | Draft checkpoints and bounded undo journals, fingerprint-checked saved-project history, named snapshots, preset/action library | Device background/low-storage coverage; retention limits and no guarantee for the last in-progress gesture |
| Files | PSD/PSB imports and compatible layered export, TIFF/SVG/HEIC/RAW import, batch ZIP export | Complex Photoshop text/vector/adjustment/Smart Object conversion, Photoshop application acceptance and oversized files |
| Color | 16-bit PNG/TIFF originals, high-precision filters/compositing, ICC transforms and soft proof, RGB/CMYK TIFF with embedded profile | 16-megapixel high-precision limit, explicit eight-bit effect fallback, bounded linear-sRGB float32 HDR with SDR previews and OpenEXR linear input/output color conversion; general float ICC/native CMYK document mode remain absent; Mac high-precision editing is not enabled |
| Subject selection | Bundled U²-Net-P and ONNX; local inference tested | Different model from Apple Vision; results are not pixel-identical |
| Localization | Shared English/Chinese UI and native Windows menus; saved preference tested | Third-party diagnostics and original Swift Mac UI are not fully localized |
| Android | Native APK and lint; emulator save/reopen/language/pixel/RAW checks; shared editor | Camera-specific RAW files, physical devices, stylus and system share coverage |
| iOS | Native Xcode project, storage/share plugins and Core Image RAW bridge; shared UI tested in WebKit | Xcode compilation, simulator/native plugin and iPhone tests, signing |
| Project round-trip | Windows fixture contains groups, mask, clipping, editable metadata, all adjustments/effects; mobile ZIP round-trip tested | Execute Windows → Mac → Windows CI and inspect reference renders |

## Reproducible compatibility check

`verify-windows.yml` builds/tests Windows, uploads the deterministic project and reference PNG, runs the original Mac tests via `verify.yml`, and reopens the Mac-saved artifact in the packaged Windows executable. `WindowsCompatibilityTests.swift` records the Mac render and numerical differences in `CrossPlatformResults`. The provisional limits (maximum premultiplied channel difference 20, mean 3) are investigation thresholds, not a declaration that all rendering is equivalent.

No Mac or remote CI result exists yet. Repository creation and pushing are on hold at the user's request. `verify-mobile.yml` is prepared for Android builds/browser tests and unsigned iOS simulator builds, but has not run.

Local unit/native/kernel coverage includes 28 tests, with 6 mobile archive/export tests. Editing regressions run through the shared parity suite on Windows, Chromium/WebKit phone layouts, and the actual Android WebView. Mac-artifact-dependent return tests and WebKit multi-touch injection are skipped when their required environment is unavailable. Passing local checks does not close the remaining rows above.

The current local results, including professional workflows, forced-restart recovery and background-filter checks, are recorded in [verification-0.8.0.md](verification-0.8.0.md).

OpenEXR 0.9.0 capabilities and format boundaries are described in [openexr.md](openexr.md). Targeted release acceptance is recorded in [verification-0.9.0.md](verification-0.9.0.md); the 0.8.0 report remains the preceding full regression baseline.

The 0.10.0 EXR/HDR extension uses format 16, retained originals, configurable linear working spaces and conditional extended HDR display. See [OpenEXR](openexr.md) and [verification-0.10.0.md](verification-0.10.0.md). Original SwiftUI Mac HDR rendering and native iOS/Xcode acceptance remain outstanding.
