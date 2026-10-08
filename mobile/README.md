# Compositor for Android and iOS — 0.10.0 preview

Preview 0.10.0 adds PIZ/tiled/multipart OpenEXR, retained Deep originals with depth-range previews and original-file export, configurable linear HDR working spaces and extended WebGPU HDR display with SDR fallback. New saves use format 16. See [OpenEXR and HDR](../docs/openexr.md).

Preview 0.9.0 adds OpenEXR HALF/FLOAT import/export, channel-group selection, offset windows and linear color conversion for sRGB, Rec.2020, P3-D65 and ACES spaces. See [OpenEXR workflows](../docs/openexr.md) for supported compression, alpha handling and limits.

Preview 0.8.0 adds embedded raster smart objects, shared source replacement/content tabs, compatible placed-object PSD delivery and a bounded linear float32 HDR TIFF/filter/composite pipeline. See [smart objects and HDR](../docs/smart-hdr.md) for supported formats, operations and limits.

Preview 0.7.0 adds independent filter masks and opacity, selection/paint mask controls, source-preserving sixteen-bit mixing and mask-aware presets/actions/recovery. See [filter masks](../docs/filter-masks.md).

Preview 0.6.0 adds editable Bézier paths, compound contours, vector-backed masks and phone path controls. New saves use format 16. See [vector workflows](../docs/vector-workflows.md) for controls, cache behavior and remaining native/platform limits.

Both native projects are in this directory. Capacitor hosts the same local editor and `.comp` model as the Windows application, with phone/tablet layout, a collapsible inspector, touch painting, two-finger pan/zoom, native file selection, native storage, clipboard, and the system share sheet. No editing service or image upload is required.

The phone layout has a full-width canvas, a bottom dock for frequent tools, a complete tool sheet, and separate menu and layer/property sheets. Common buttons have 44-pixel touch targets. Brush size, hardness, opacity and smoothing are available in Settings. Sheets can be dismissed with their close button, Android Back, a backdrop tap, or a downward swipe from the heading. The layout responds to landscape orientation, safe areas, and the on-screen keyboard.

Clone Stamp has a source-picking button. Polygonal Lasso has a finish button, and selection tools offer replace/add/subtract/intersect without modifier keys. Move settings select resize, rotate or free-distort handles, with optional aspect locking; touch handles have larger hit areas.

The 0.3.0 shared editor adds editable pending gradients, selection-outline and pixel movement/duplication, clipping-source bake/unlink deletion, linked-mask perspective warping, and Unicode-aware point/paragraph text. The Selection drag control exposes outline/move/duplicate without a keyboard. See [editing-parity.md](../docs/editing-parity.md) for semantics and limitations.

The Android target is Android 7.0 or newer with an up-to-date System WebView. The iOS target is iOS 17 or newer; older WebKit versions lack APIs used by the shared editor.

Select **English** or **简体中文** at the top right. The setting survives restarting the app. Menus and editor dialogs share the Windows translation catalog; project content is not translated.

## Projects and exports

Preview 0.5.0 shares editable filter stacks, mask refinement, PSD/PSB export, 16-bit sources, ICC soft proofing and TIFF export, pen controls, font substitution, presets, actions, snapshots and batch export with Windows. See [professional-workflows.md](../docs/professional-workflows.md) for limits. Native iOS compilation and device acceptance remain outstanding.

**Save** stores a project on the device. **Open** shows the local library and can import a project ZIP. **File → Share project** shares a `.comp.zip` containing a version 15 `.comp` directory, including filter originals. Use updated clients to open it; versions 1–14 remain importable. To bring a desktop project to a phone, ZIP the entire `.comp` folder, then import it.

PNG/JPEG exports use the native share sheet and retain document resolution. TIFF is decoded locally rather than relying on browser support. iOS camera RAW has a Core Image decoder bridge; its native build and camera coverage still require Mac/iPhone verification.

Android RAW decoding has passed a native emulator test using a synthetic Bayer DNG. The decoder uses WebAssembly shared memory internally; absence of the JavaScript `SharedArrayBuffer` constructor alone does not establish that decoding is unsupported. Worker startup failures reject the operation instead of leaving the editor waiting indefinitely. Camera-specific coverage still requires real files and devices.

Mobile intentionally uses smaller resource limits: 8,192 pixels per side, 16 million canvas pixels, 48 million aggregate image/mask pixels, and 128 MiB project archives. Saves write a new archive before committing metadata and retain one preceding complete save. Failure to write a new save leaves the prior project available.

## Development

```sh
cd desktop
npm ci --ignore-scripts
cd ../mobile
npm ci --ignore-scripts
npm run build
npx cap sync
npm test
npx playwright install chromium webkit
npm run test:ui
```

Android needs JDK 21 and Android SDK 36:

```sh
cd android
./gradlew assembleDebug lintDebug
```

On Windows use `gradlew.bat`. The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. The local build also succeeds with an installed Gradle 9.3.1. For emulator acceptance, start an emulator and run `node scripts/test-android.mjs`; `COMPOSITOR_ANDROID_SERIAL` chooses its serial. The script refuses physical-device serials.

On a Mac with Xcode 26+, open `ios/App/App.xcodeproj` or build an unsigned simulator app:

```sh
xcodebuild build -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS Simulator' -configuration Debug \
  -derivedDataPath ios/DerivedData CODE_SIGNING_ALLOWED=NO
```

Installing on an iPhone requires your Apple signing team. No signing credentials or App Store submission are configured. The iOS native target has **not** been compiled on this Windows machine. WebKit browser tests exercise shared UI, not native iOS plugins.

## Acceptance status

Android APK compilation and lint completed; native emulator checks cover actual touch painting, filesystem persistence, cold restart, language preference and RAW decoding. Shared editing-parity cases also run inside the actual Android WebView with `npm run test:android`; its emulator serial is controlled by `COMPOSITOR_ANDROID_SERIAL`. Chromium/WebKit tests cover phone/landscape layouts, sheets, bilingual editing, file workflows and the shared editing cases. Multi-touch protocol injection runs in Chromium and is skipped in WebKit. Six archive/export checks cover version 11 round-trip, unsafe files, interrupted saves, text-range validation and resolution metadata.

Feature parity is still tracked in [`docs/windows-migration.md`](../docs/windows-migration.md). Native share sheets, physical devices, stylus behavior, camera-specific RAW support, and resource use need broader device testing. The mobile CI workflow is prepared locally and has not run or been pushed.
