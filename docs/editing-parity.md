# Editing parity in preview 0.3.0

This update implements four gaps in the shared Windows/Android/iOS editor. The original Swift source is the behavioral reference. The `.comp` schema stays at version 11; no private gradient or text fields have been added to project files.

## Gradients

The reference is `Compositor/Document/Gradient.swift` and `CompositorTests/GradientTests.swift`.

- A gradient edits the active image or mask. Its preview is separate from stored pixels and history.
- Linear/radial shape, foreground-to-background/transparent, reversal, opacity, and colors remain editable while the gradient is pending. Drag its endpoints or draw a replacement line without accumulating previous previews.
- Apply/Enter commits one undo step. Cancel/Escape restores the original pixels. Undo cancels an uncommitted gradient.
- Save, layer/tool changes, and project-tab changes resolve the pending edit.
- Selection coverage and mask placement are honored, including uniform and folder masks.

As in the Mac reference, committing a gradient stores pixels. Reopening a saved project does **not** restore editable gradient parameters. Persisting those parameters would require a format extension and corresponding Mac support.

## Selections

The references are `SelectionEdits.swift`, `Selection.swift`, and the selection tests.

- Outlines trace actual selection coverage, including holes; they no longer always display the bounding rectangle.
- Drag inside a selection with a selection tool to move its outline. Move tool or Ctrl-drag moves selected pixels; Alt duplicates. The Selection drag control provides the same actions without a keyboard.
- Arrow keys nudge, Shift increases the step, and Ctrl moves pixels. Pixel movement expands the source grid when necessary while preserving its scale/rotation and growing implicit masks.
- Cancellation restores the selection and pixels. A completed move is one undo step.
- Basic pixel filters respect selection holes. Mask inversion affects mask coverage without altering the image. Delete inside a mask selection reveals it; the layer trash removes the targeted mask/layer.

Persistent free transform of a floating pixel selection is separate from dragging/nudging; broader transform parity remains under acceptance.

## Clipping and masks

The references are `LiveLayerMask.swift`, `LayerMerge.swift`, and mask transform tests.

- Deleting a live clipping source offers Bake and Delete, Remove Links and Delete, or Cancel. Multiple selected sources and descendants are handled together.
- Baking applies the source chain's coverage to dependent image pixels and retains the dependent layer's own mask and effects. As in the reference, retained effects are reevaluated from the baked pixels; they are not flattened into the bake.
- Merges render the selected subset, trim transparent margins, preserve the insertion location, and retarget remaining dependents to the merged layer. External parent/clipping references are detached from the subset, matching Mac merge behavior.
- Releasing a clipping layer also releases contiguous higher siblings that share its source. Reordering adopts or releases clipping relationships as the reference does.
- Linked masks follow resize, rotation, movement and perspective distortion. Unlinked masks keep their placement.

## Text

The reference is `TypeTool.swift`, including its 12-pixel padding, word wrapping, UTF-16 style ranges, and transformed text-anchor rules.

- Whole font/direction runs are shaped by the browser rather than rendering each character independently. Unicode bidi ordering, line breaking and grapheme boundaries preserve joined scripts, combining marks and emoji sequences.
- Color spans reuse the same glyph coverage, avoiding alpha seams through ligatures. Common Mac font face names map to corresponding browser families, weights and styles.
- Click creates point text; dragging creates a paragraph box. On-canvas move/resize controls, leading, tracking and alignment are editable. Point text retains the user's scale, rotation, flips and transformed anchor as it grows.
- Blank lines and font/color ranges survive editing. Replacing text rebases UTF-16 offsets. Oversized drafts remain editable after an error.
- Opening and applying unchanged text preserves its cached PNG, avoiding an unsolicited font substitution. Saving commits valid pending text; project readers reject invalid text ranges.

The font engine and installed fonts remain platform dependent. These changes improve editing behavior but do not establish pixel-identical Core Text/Canvas output.

## Verification and boundaries

`desktop/tests/parity-cases.mjs` is shared by the native Windows tests, Chromium/WebKit phone tests, and `mobile/native-tests/parity.spec.mjs` running the actual Android WebView. Tests inspect pixels, source/mask dimensions, undo/cancel behavior, text ranges, glyph coverage and UI controls. Windows also saves and actually closes/reopens a gradient plus styled Unicode text through its native project store.

The original macOS tests and Windows → Mac → Windows workflow have **not** run. iOS native code has not been compiled on this Windows machine. Publishing and CI execution remain on hold at the user's request. Other migration items remain in [windows-migration.md](windows-migration.md).
