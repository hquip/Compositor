# Recovery and editing in preview 0.4.0

The shared Windows, Android, and iOS editor adds recovery drafts, background destructive filters, and floating pixel selection transforms. These are local features. No account, upload, or repository is required. The original Swift app has not been changed by this update.

## Recovery drafts

- Dirty documents are checkpointed after 1.2 seconds without a change, with a five-second periodic check, before commands, and on page/background lifecycle notifications. Every open project tab has its own checkpoint, including unnamed projects.
- The checkpoint includes the latest committed project and selection coverage. Pending text, gradient, and floating-selection parameters are retained separately, so recovery resumes those edits without prematurely committing them. Undo history is not persisted.
- Recovery uses an independent IndexedDB database in the application's WebView profile. Metadata and pixels are replaced in a single transaction. Unused image assets are excluded. Storage failures retain the previous checkpoint and show a prompt to save manually; drafts are never silently evicted by the app.
- **View → Recover unsaved projects** lists available drafts. A status-bar button also appears after restarting with drafts. Recovering opens an unsaved copy, and the first manual save chooses its destination. Original project files are not overwritten by autosave.
- A successful manual save removes a matching clean checkpoint. Later edits remain recoverable. Explicitly closing/discarding a project removes its checkpoint. Deleting a draft in the recovery list requires confirming that specific deletion.
- Autosave is a checkpoint, not a guarantee against losing the latest keystroke or an in-progress brush stroke. Active pointer gestures and modal previews are excluded from checkpoint capture. A system force-stop can interrupt a background notification; periodic checkpoints remain the fallback. Clearing application data or its WebView profile also clears drafts.

Internal recovery record version 1 is separate from the public `.comp` format. `.comp` remains version 11; no gradient, floating-selection, or recovery-only fields are written into project manifests.

## Background filters

Destructive Image adjustment filters, Camera Raw, and finishing filters use a module worker. Preview images are bounded to a 1024-pixel longest side, and radius/detail parameters are scaled when applicable. New previews supersede old requests. Apply processes the original image dimensions; Cancel terminates the worker and leaves pixels and history unchanged. Only a completed Apply creates an undo step.

Masks are converted from coverage to grayscale before filtering and back afterward. Selection clipping uses the mask placement when editing a mask. Previews use separate render data instead of changing persisted image assets.

The worker uses OffscreenCanvas where available. A small pixel-surface implementation handles the filter operations in engines that lack it. Glyph dithering receives a glyph atlas rendered with the UI engine's fonts. Native Canvas blur uses software-backed surfaces in both contexts, avoiding the different GPU/CPU alpha results observed in Android tests. Missing Canvas filter support falls back to a three-pass box approximation of Gaussian blur; this is not a claim of identical Core Image/Metal blur output. [WebKit documents native 2D OffscreenCanvas support](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/), but the Windows-hosted WebKit test runtime does not expose it, so both processing paths are exercised locally.

Layer adjustment/effect compositing, image encoding, history snapshots, subject selection, and full-resolution selection warps still have their own performance costs. This update does not implement tiled document rendering, expanded blur bounds, or complete Camera Raw parity.

## Floating pixel selections

Use **Select → Transform selected pixels** (Ctrl+T), or transform a copy. The selected pixels can be moved, resized, rotated, or distorted repeatedly while the original project pixels remain intact. Corner handles resize; the rotation handle rotates; the mode control exposes rotation and free distortion on phones. Shift constrains scaling/rotation; arrow keys nudge, with Shift for larger steps.

Apply/Enter commits a single undo step; Cancel/Escape or Undo restores the original state. Pointer cancellation restores the previous valid preview. Save, project/tool/layer switches, and other editing commands resolve a pending transform. Invalid/crossed quadrilaterals and canvas/pixel-budget overflow cannot be committed.

Selection holes and soft coverage are transformed with the pixels. Source grids grow as necessary while retaining the layer's scale/rotation, and implicit layer masks grow with the source grid. Repeated previews sample the original lifted pixels, avoiding cumulative resampling. This operates on the active image layer; independent mask-pixel floating transforms and multi-layer floating selections are not provided.

Mac round-trip/render verification and native iOS compilation/device acceptance remain outstanding. See [windows-migration.md](windows-migration.md).
