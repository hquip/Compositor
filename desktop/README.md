# Compositor for Windows — 0.10.0 preview

Preview 0.10.0 adds PIZ/tiled/multipart OpenEXR, retained Deep originals with depth-range previews and original-file export, configurable linear HDR working spaces and extended WebGPU HDR display with SDR fallback. New saves use format 16. See [OpenEXR and HDR](../docs/openexr.md).

Preview 0.9.0 adds OpenEXR HALF/FLOAT import/export, channel-group selection, offset windows and linear color conversion for sRGB, Rec.2020, P3-D65 and ACES spaces. See [OpenEXR workflows](../docs/openexr.md) for supported compression, alpha handling and limits.

Preview 0.8.0 adds embedded raster smart objects, shared source replacement/content tabs, compatible placed-object PSD delivery and a bounded linear float32 HDR TIFF/filter/composite pipeline. See [smart objects and HDR](../docs/smart-hdr.md) for supported formats, operations and limits.

Preview 0.7.0 adds independent filter masks and opacity, selection/paint mask controls, source-preserving sixteen-bit mixing and mask-aware presets/actions/recovery. See [filter masks](../docs/filter-masks.md).

Preview 0.6.0 adds editable Bézier paths, compound contours, vector-backed masks and phone path controls. New saves use format 16. See [vector workflows](../docs/vector-workflows.md) for controls, cache behavior and remaining native/platform limits.

The Windows client uses .NET Framework 4.8, the shared Microsoft Edge WebView2 Runtime, and a local Canvas editor. Original Compositor C pixel kernels run as WebAssembly. Editing and subject detection run locally. The original Swift macOS application remains in `Compositor/`; Android and iOS hosts share this editor through [`mobile/`](../mobile/README.md).

## Run and language

Preview 0.5.0 adds editable filter stacks, mask refinement, layered PSD/PSB export, 16-bit sources, ICC color conversion/soft proofing, RGB/CMYK TIFF output, pen controls, font substitution, presets, actions, snapshots and batch export. See [professional-workflows.md](../docs/professional-workflows.md) for operation details and limits. Recovery and floating selections remain available.

Extract `dist/windows/Compositor-Windows-0.10.0-x64.zip` and run `Compositor-0.10.0/Compositor.exe`. Keep the DLLs, `renderer`, and `third-party` directories together. Windows 10 1903 or later / Windows 11 x64, .NET Framework 4.8, and WebView2 are required. Node and Xcode are development dependencies only.

Use the language selector at the top right to switch between **English** and **简体中文**. It updates editor controls, menus, dialogs, tooltips, accessible labels, and the Windows menu bar, and remembers the preference. Names, user text, and serialized format values remain unchanged. Diagnostic messages from external libraries can still be English. The original Mac interface is not localized by this change.

The portable program is approximately 24 MiB unpacked / 10 MiB zipped, excluding shared runtimes and the WebView2 cache. The offline subject model and inference runtime account for most of the increase over the original basic prototype. This preview is unsigned.

## Implemented editing features

- Layer groups, multiple selection, reorder/nesting, duplicates, merges, clipping, masks and mask editing, visibility, opacity, and 24 blend modes.
- Twelve adjustment kinds; stroke, drop/inner shadows, color overlay, and inner/outer glows; Camera Raw controls and original C kernels.
- Brush/eraser, marquee/ellipse/lasso/polygon/wand/object selection, selection expansion/contraction/feathering, clone/heal/blur/smudge/liquify, gradient, shapes, inline text, and content-aware fill.
- Transform handles, perspective distortion, canvas/image resizing, crop, trim, tabs, rulers/guides/grid, configurable shortcuts, clipboard, and external project reload.
- PNG/JPEG/WebP/BMP, TIFF, OpenEXR, SVG, HEIC, camera RAW, and 8-bit RGB PSD/PSB imports. Photoshop conversion reports appear before import. JPEG export has a quality preview; PNG/JPEG exports include document resolution.

These are implemented features, not a claim of complete Mac parity. See the remaining acceptance work in [`docs/windows-migration.md`](../docs/windows-migration.md). Font rendering, Core Graphics/Metal effects, and Apple Vision subject selection use different Windows backends. Complex Photoshop content and large documents require more coverage.

The shared editor includes pending gradient endpoints/settings with apply/cancel, selection outlines and pixel movement/duplication, clipping-source deletion choices and linked-mask warping, and Unicode-aware text layout with editable paragraph boxes. [Editing behavior and verification](../docs/editing-parity.md) describe the precise boundaries, including that committed gradients are saved as pixels, as on Mac.

## Project compatibility

The reader accepts `.comp` versions 1–16 and writes the version 16 schema. A project is a directory containing `manifest.json` and `images/`. Copy the whole directory when moving between Mac and Windows. Mobile shares a ZIP containing that same directory; extract it before opening in a desktop client.

Saving validates assets, writes a staged sibling directory, and installs it with a recoverable rename. Windows cannot atomically replace a nonempty directory, so concurrent readers may briefly see the target missing. Own-save generation checks avoid external-reload races; unsaved external changes prompt before replacing edits.

Windows limits are 30,000 pixels per side and 200 million canvas pixels. The combined resource budget scales with memory, up to 800 million pixels. Undo retains up to 100 entries / 256 MiB of estimated retained resources. Large full-resolution previews can still block the interface.

## Build and verify

Install Node 24+, .NET SDK 10, and LLVM with `clang` and `wasm-ld` on PATH:

```powershell
cd desktop
npm ci --ignore-scripts
npm run build:win
npm test
npm run test:ui
npm run dist:win
```

The build compiles the original C kernels, bundles pinned dependencies, checks required license files and the subject model SHA-256, then builds the native host. Node dependencies and test fixtures are excluded from the portable application.

Local validation includes pixel, format, high-precision color, native store, archive, and UI regression checks. The UI suite includes shared editing-parity cases and an actual native save/close/reopen of gradients and styled Unicode text. The Mac-to-Windows return test is conditional on an actual Mac-generated artifact and is skipped locally.

`.github/workflows/verify-windows.yml` prepares Windows fixtures and a reference render, calls the original Mac test suite, then opens the Mac-saved project in the packaged Windows editor. Pixel-difference metrics and Mac renders are retained. **These workflows have not run; no repository or code has been pushed.**
