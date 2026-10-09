# Complete feature implementation and acceptance

Requested scope: professional color, Photoshop interoperability, LUTs/presets, Dodge/Burn, channels/fill/live filters, perspective crop, OpenRaster/artboards, extensions/external filters/MCP, collage, themes/update notes, Linux and older macOS.

The starting point is commit `fd36406`, with successful native Mac, Windows round-trip and Android/iOS build verification. This document tracks new work separately from that accepted baseline.

| Area | Required behavior | Status |
| --- | --- | --- |
| CMYK/Lab | Shared editor has authoritative channel resources, ICC conversion, profile selection and RGB display caches. | Partial. Native Swift Mac preserves resources/caches but has no matching CMYK/Lab authoring interface. Painting is through the channel workflow; whole-document color-managed compositing and all editing tools are not complete. |
| PSD/PSB | Precision source import/export, retained originals, some text/smart content and artboard paths exist. Independent `psd-tools` checks cover generated 16/32-bit RGB PSD/PSB. | Partial. Precision composition rejects non-Normal blends, live adjustments, effects, clipping and folder masks. Arbitrary complex text/vector/smart objects do not support complete edited round-trips. Exporting the untouched retained source is a distinct operation. CMYK/Lab require broader independent file acceptance. |
| LUT/presets | Shared `.cube` resources, editable lookup layers, masks/opacity and local adjustment presets exist; native Swift has a lookup render fallback. | Shared core cases and native Swift lookup/resource tests passed CI. Presets need broader masked, grouped and resource-limit coverage. |
| Dodge/Burn | Shared brush modes include tonal ranges, exposure, alpha/selection handling and undo tests. | Shared core cases tested. The original Swift Mac brush does not have these modes; the separate compatible Mac app uses the shared editor. |
| Channels/Fill | Shared channel preview/edit/copy/paste and channel-paint paths exist; Fill is applied separately from effects. Native Swift adds Fill controls. | Partial cross-platform acceptance; native channel UI is absent and protected-source/tool combinations need more coverage. |
| Live filters | Shared workflow layers for adjustment types, Camera Raw, finishing and transforms exist. | Partial. Core layer persistence is present; broader filters, high-precision/HDR interaction and original Swift authoring/rendering are not fully covered. |
| Perspective crop | Shared four-point rectification has convexity checks, preview/cancel/apply and undo. | Partial. Current apply flattens the document; native Swift UI and source-preserving high-precision/layer behavior remain absent. |
| OpenRaster/artboards | Shared `.ora` and PSD artboard paths exist; Windows/mobile image pickers accept `.ora`, including grouped standard archives and export/reimport. | Partial. `.ora` standard-layer output skips live adjustments and has limited effects/clipping semantics; full editable data is a Compositor extension. Original Swift interoperability needs more integration. |
| Extensions | Shared QuickJS image API, explicit external PNG exchange and stdio MCP service exist. | Core plugin isolation and MCP inspect/update tested. This is a bounded image plugin API; full editor plugins, broader external-filter and adjustment-tool acceptance remain open. |
| Collage | Shared column grid, spacing, border, contain/cover placement exist. | Partial. Grid geometry tested; automatic template library, arbitrary layout and native Swift UI remain absent. |
| Interface | Shared and native theme choices, shared release-notes dialog and Sparkle release-note links exist. | Core theme tested; original Swift localization is incomplete and this does not provide deployed automatic updaters for Windows/mobile. |
| Platforms | Linux AppImage/deb and separate universal macOS-compatible host build in CI with minimum macOS 12 declaration and legacy WebKit fallbacks. | Build verified for compatible host. This does not lower the original Swift app's macOS 26 requirement or establish real macOS 12 runtime acceptance. Signing/device tests remain open. |

Saved schema changes require a version bump in all readers/writers and `docs/project-format.md`. New capabilities must include project reopen/undo checks, exported-file validation and relevant native/browser CI. Device resource limits remain explicit. An unsupported Photoshop structure retained as opaque data is not counted as editable native support.

An item becomes complete only when its required behavior and checks pass. Physical screen/stylus tests, application signing and deployment credentials are recorded separately from implemented features and build results.

## Status correction, 2026-10-09

The earlier status table overstated completed feature and native-platform coverage. The table above records implementation limits explicitly. A passing test on a generated sample is not proof of complete Photoshop compatibility or platform parity.

At commit `3efc7aa`, Windows CI [37813875391](https://github.com/hquip/Compositor/actions/runs/37813875391) failed one recovery-reload readiness assertion. That blocked its native Mac fixture and return-test jobs. Native Swift CI [37813877952](https://github.com/hquip/Compositor/actions/runs/37813877952) initially received no hosted runner; its retry passed on 2026-10-09. Commit `9c8d52e` fixed recovery readiness and retained every declared format-17 resource in recovery/history/fingerprints. Its [Windows/Mac return verification](https://github.com/hquip/Compositor/actions/runs/37884565655), [Android/iOS builds](https://github.com/hquip/Compositor/actions/runs/37884565253), and [Linux/compatible Mac builds](https://github.com/hquip/Compositor/actions/runs/37884565276) all passed. These results validate their covered cases, not complete Photoshop compatibility or native/shared feature parity.

## Channel and OpenRaster repairs, 2026-10-09

- Editing a duplicated channel layer now replaces shared resources independently, including ICC data referenced by sibling layers or retained originals. Unchanged resources keep their existing file and do not create redundant entries.
- Channel strokes reload current authoritative samples/profile after undo, redo or project reopen and match both layer and document IDs. Mask painting bypasses the channel-paint guard.
- Uniform one-pixel masks expand to a usable raster grid before brushing; channel samples remain unchanged. Expansion respects surface and document budgets.
- Changing a layer's channel profile saves the matching ICC bytes and display preview; precision composition converts between differing profiles even when both layers use RGB mode.
- Image resize scales authoritative channel layer placement while preserving source samples and cache resolution, matching protected-source resize behavior. It does not destructively resample channel data.
- Channel edits/color-mode changes that exceed the aggregate pixel budget roll back rather than leaving unsavable modified data.
- Windows/mobile ordinary image pickers recognize `.ora`; phone sharing uses `image/openraster`. Tests import a standard grouped archive without a Compositor extension, inspect layer placement/pixels, and export/reimport it.

This batch keeps project format 17. The remaining partial features in the table still apply, especially protected-source color conversion, whole-document color-managed editing, complex PSD structures and physical device acceptance.

Local validation passed: 83 desktop Node checks (two native OpenEXR environment skips), six mobile archive/export checks, 37 related Windows WebView2 checks and 68 phone Chromium/WebKit checks. After the precision ICC composition fix, eight targeted Windows and 16 phone checks passed, covering channel regressions, precision PSD/PSB round-trips and Lab edits. These targeted counts overlap the related suites.
