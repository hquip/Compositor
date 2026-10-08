# Complete feature implementation and acceptance

Requested scope: professional color, Photoshop interoperability, LUTs/presets, Dodge/Burn, channels/fill/live filters, perspective crop, OpenRaster/artboards, extensions/external filters/MCP, collage, themes/update notes, Linux and older macOS.

The starting point is commit `fd36406`, with successful native Mac, Windows round-trip and Android/iOS build verification. This document tracks new work separately from that accepted baseline.

| Area | Required behavior | Status |
| --- | --- | --- |
| CMYK/Lab | Shared editor has authoritative RGB/CMYK/Lab channel resources, ICC conversion, profile selection and RGB previews. | Implemented shared; native Mac editor uses shared resources for display/export and needs device acceptance. |
| PSD/PSB | 8/16/32-bit RGB/CMYK/Lab import/export paths retain original Photoshop records, precision channels, profiles, artboards and smart source data; independent `psd-tools` checks pass for generated 16/32-bit PSD/PSB. | Implemented for covered structures; Photoshop-specific effects and arbitrary third-party descriptors remain retained/flattened where no native equivalent exists. |
| LUT/presets | Validated `.cube` resources, editable lookup layers, masks/opacity, local adjustment presets and undo. | Implemented |
| Dodge/Burn | Brush modes with tonal range, exposure, alpha/selection handling, pen response and atomic undo. | Implemented shared; native Mac uses the shared behavior after platform integration testing. |
| Channels/Fill | Independent channel preview/edit/copy/paste and separate Fill opacity that is applied before effects. | Implemented |
| Live filters | Standalone live adjustment, Camera Raw, finishing and transform layers with saved workflow metadata. | Implemented shared; native Mac renderer has a fallback for lookup workflows and broader native live-layer UI remains limited. |
| Perspective crop | Four-point rectification with convexity checks, preview/cancel/apply and undo. | Implemented |
| OpenRaster/artboards | Layered `.ora` read/write; PSD artboards become separate bounded projects with translated layers and masks. | Implemented covered structures |
| Extensions | QuickJS sandboxed image plugin API, external PNG filter exchange and stdio MCP service. | Implemented with explicit API/resource limits |
| Collage | Editable template grid with columns, spacing, borders and contain/cover placement. | Implemented |
| Interface | System/Light/Dark persisted themes, Chinese strings and release-notes dialog linked to a verified GitHub release. | Implemented shared; Sparkle appcast now includes release-notes links. |
| Platforms | Tauri-compatible Linux AppImage/deb and universal macOS compatible host targeting macOS 12; legacy WebKit fallbacks. | Implemented in CI; signing and physical-device acceptance remain deployment work. |

Saved schema changes require a version bump in all readers/writers and `docs/project-format.md`. New capabilities must include project reopen/undo checks, exported-file validation and relevant native/browser CI. Device resource limits remain explicit. An unsupported Photoshop structure retained as opaque data is not counted as editable native support.

An item becomes complete only when its required behavior and checks pass. Physical screen/stylus tests, application signing and deployment credentials are recorded separately from implemented features and build results.
