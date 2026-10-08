# Professional workflows in preview 0.5.0

Current preview 0.7.0 adds independent filter masks/opacity and saves format 14; see [filter masks](filter-masks.md). Preview 0.6.0 added editable paths/masks. The version-12 workflows below remain supported; see [vector workflows](vector-workflows.md).

This update adds persistent filters, mask refinement, layered Photoshop export, photography/print color workflows, and editing/productivity controls. These implementations do not establish Photoshop equivalence. Windows/mobile behavior, macOS source changes, and Xcode/device acceptance are separate milestones.

## Editable filters and gradients

**Filters** adds the twelve existing adjustment kinds to an ordered, editable per-layer stack. The original PNG is embedded separately from the rendered cache. Add, edit, enable/disable, reorder, and remove filters; the final Apply is one undo step. Reopening a project preserves its parameters and original. Unchanged opening and applying preserve the cached appearance. Preview 0.5.0 filters operate on the whole image layer. Preview 0.7.0 adds independent masks and opacity to each filter.

**Layer → New gradient fill** creates a linear or radial grayscale source plus an editable Gradient Map. Its colors and reversal remain editable through the Filters panel after reopening. Layer transforms control placement, scale and rotation; it is a finite layer, not Photoshop's procedural infinite fill. The ordinary Gradient painting tool still commits pixels.

New saves use `.comp` **version 12**. Older readers intentionally reject them. Current readers retain support for versions 1–11. Source filenames, parameter ranges, masks, and resource budgets are validated in desktop/native/mobile stores. See [project-format.md](project-format.md).

The Mac source includes original-source persistence, filter duplication, an eight-bit filter editor, and source-preservation tests. High-precision sources remain embedded with their caches. Native high-precision filter editing is disabled there; source-preserving editing is available in the shared editor. Mac/Xcode verification has not run on this Windows host.

## Selection and mask refinement

**Select → Refine selection** and **Layer → Refine mask** provide image-guided edge refinement using the Mac GuidedMatte equations, smoothing, feathering, contrast and edge shift. Preview on black, white, a red overlay, or as coverage. Paint Keep/Remove corrections in the preview and output a selection or a layer mask. Processing runs in a cancelable worker and a completed edit creates one undo step. This is a guided matte workflow; it is not Adobe's trained Refine Hair implementation.

Clone/heal strokes can expand the source grid, retaining placement and cancellation/undo behavior. Clone can sample the merged document onto an empty layer. Destructive Gaussian and motion blur can expand their image bounds when there is no selection; mask and selected-region filtering stay within their relevant coverage. Editable filter stacks retain the source grid's extent.

## PSD and PSB delivery

**Image → Export PSD / Export PSB** writes eight-bit RGB documents with a composite preview, groups, transformed raster layers, masks, blend modes, compatible adjustment records and editable text metadata. Export conversion information appears before choosing the destination.

Shapes and filter stacks export their rendered pixels. Layer effects and the affected layer mask are baked together for the compatible raster result. Unsupported adjustment kinds and noncontiguous clipping references require choosing a flattened export. PSD text may be redrawn differently by Photoshop when edited, depending on fonts and its text engine. PSD/PSB output is not a lossless serialization of every Compositor or Photoshop feature; `.comp` remains the editable master. Photoshop itself has not been used for an acceptance run on this host.

## Photography precision and print color

**Image → Import high-precision image** preserves 16-bit PNG/TIFF samples and an embedded input ICC profile. Untagged images can be assigned one of the included RGB profiles. Eight-bit inputs can enter the same processing path, but this does not recover missing source detail. CMYK TIFFs with embedded profiles are converted to 16-bit ProPhoto RGB for editing.

The twelve editable filter kinds have a high-precision path. Sources remain embedded as 16-bit PNGs; the canvas uses an eight-bit sRGB display cache. RGB layer compositing and profile-aware TIFF delivery can retain the 16-bit data. High-precision sources require explicit rasterization before ordinary pixel painting; painting on a separate layer and editing masks/transforms preserve the original. Resizing filtered layers in the shared editor retains their sources.

**Color management and TIFF export** uses local LittleCMS, selectable rendering intent, black point compensation, an explicit RGB compositing space, and eight- or sixteen-bit TIFF output with embedded ICC and document resolution. Built-in profiles cover sRGB, Adobe RGB-compatible, Display P3 and ProPhoto RGB. Import a printer's ICC using **Load ICC profile**; Windows also lists locally installed profiles. CMYK separation composites transparency onto white paper. **Soft proof** previews the selected profile without changing pixels or exporting a file.

Current limits: high-precision source/composite operations are bounded to 16 megapixels per surface and a resource budget. Full 32-bit HDR editing and native CMYK-channel document editing are not implemented. Layer effects use the existing eight-bit renderer and require explicitly allowing that fallback for color-managed export. Normal PSD export is eight-bit; use TIFF for sixteen-bit RGB or CMYK delivery. A proof depends on the actual printer/profile/display and is not a print-quality guarantee.

## Fonts, pens and productivity

- **Substitute missing fonts** detects unavailable families, offers replacements, retains text content and range styling, and supports undo. Windows uses its installed-font list; browser/mobile detection uses font metrics. Unchanged text continues to use its cached image.
- **View → Pen and touch** configures pressure-driven size/opacity, pen tilt and palm rejection. Non-pen input keeps the ordinary brush behavior. Hardware-specific stylus behavior still needs physical-device coverage.
- Empty brush layers begin with a small raster region and grow with the stroke instead of allocating a full canvas immediately.
- **Save/apply filter preset** stores reusable filter stacks in the local library.
- **Record action / Run action** records supported filter, editable-stack, resize and flip operations. Playback is cancelable and commits as one undo step. It is not a recorder for every tool, menu or arbitrary script.
- **Batch export** packages current/all open projects at requested sizes into a ZIP. PNG, JPEG, sixteen-bit TIFF and original-size layered PSD are supported. Paths are sanitized, names deduplicated, cancellation honored, and memory/file counts bounded. It does not batch-import an entire external folder.
- **History and snapshots** navigates in-session edits and stores named snapshots. Recovery checkpoints additionally retain up to 20 past/future entries within a 16 MiB journal budget. Normal saves store a local undo journal; opening restores it only if the saved project fingerprint still matches. Storage failure may omit the journal while retaining the document save. These journals/snapshots are local application data, not part of portable `.comp` files.

## Remaining acceptance and capabilities

Original Mac rendering/round-trip tests, Xcode builds, native iOS tests, real stylus devices, Photoshop application acceptance, signing and updater deployment are outstanding. General vector/pen-path authoring, the full Photoshop text/Smart Object/filter ecosystem, generative AI, complete Camera Raw parity, multi-layer floating pixel selections and universal large-document performance are not completed by this release. See [windows-migration.md](windows-migration.md).

No repository was created or pushed, and no remote CI workflow was run.
