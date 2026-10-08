# Complete feature implementation and acceptance

Requested scope: professional color, Photoshop interoperability, LUTs/presets, Dodge/Burn, channels/fill/live filters, perspective crop, OpenRaster/artboards, extensions/external filters/MCP, collage, themes/update notes, Linux and older macOS.

The starting point is commit `fd36406`, with successful native Mac, Windows round-trip and Android/iOS build verification. This document tracks new work separately from that accepted baseline.

| Area | Required behavior | Status |
| --- | --- | --- |
| CMYK/Lab | Create/convert/edit documents with authoritative color channels and embedded ICC; preserve numerical samples, provide RGB display previews and explicit profile handling | Pending |
| PSD/PSB | 8/16/32-bit RGB/CMYK/Lab; layers/masks/profile/precision; preserve original Photoshop records and embedded content; exercise edited and unchanged round-trips | Pending |
| LUT/presets | Validate .cube, editable masked lookup layers, local adjustment-layer presets, saved resources and undo | Pending |
| Dodge/Burn | Brush modes with Shadows/Midtones/Highlights and exposure; alpha, selections, smoothing, pressure and atomic undo | Pending |
| Channels/Fill | Independent component inspection/editing/copy/paste; Fill affects content independently of layer effects and opacity | Pending |
| Live filters | Standalone masked filter layers, editable parameters and transforms, recomputation and persistence | Pending |
| Perspective crop | Four-point selection, rectification, bounds/degeneracy checks, preview/cancel/apply and undo | Pending |
| OpenRaster/artboards | Layered .ora import/export; PSD artboards create separate bounded documents with translated layer placement | Pending |
| Extensions | Versioned plugin API, local plugin execution, external-filter exchange and a functional MCP service | Pending |
| Collage | Templates, grid/custom placement, spacing/borders, editable layers and undo | Pending |
| Interface | System/Light/Dark with persisted choice, readable native/shared controls, release notes before update | Pending |
| Platforms | Linux desktop distribution and macOS 12+ compatible desktop builds; system/browser capability fallbacks; all existing Windows/phone workflows | Pending |

Saved schema changes require a version bump in all readers/writers and `docs/project-format.md`. New capabilities must include project reopen/undo checks, exported-file validation and relevant native/browser CI. Device resource limits remain explicit. An unsupported Photoshop structure retained as opaque data is not counted as editable native support.

An item becomes complete only when its required behavior and checks pass. Physical screen/stylus tests, application signing and deployment credentials are recorded separately from implemented features and build results.
