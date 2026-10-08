# Editing fixes and workflow enhancements

This change addresses upstream issue #180 and adds common workflows from #165, #168, #159 and #177. It keeps project format 16: the saved schema and resource names have not changed.

## Native Mac editing

Opening a project and applying canvas geometry now use the same document reconstruction. Canvas Size, Crop and Trim retain editable text, shapes, filter originals, vector metadata, effects, HDR settings and retained EXR resources. Hue/Saturation, Levels, Invert and floating-selection commits retain layer effects; destructive pixel edits still rasterize the affected text or shape.

Image Size retains the original content of editable and protected layers and scales their placement. Proportional scaling preserves rotated layers. Uneven scaling that would shear an editable layer is refused before any edit; use proportional resizing or explicitly rasterize the layer. Plain raster layers keep the existing resampling path. HDR and smart objects retain their original bytes and identity.

The Crop controls add 9:20 and custom ratios, with Apply/Cancel next to the dimensions. File → New from Clipboard creates a project at the image's pixel dimensions without replacing another tab.

## Windows, Android and iOS shared editor

- Filter mask/parameter edits finish before applying the stack. Late previews cannot cancel a full-resolution apply, and the committed settings/assets are captured together. Cancellation or failure leaves the dialog usable rather than stranding its disabled Apply button.
- **Export WebP** offers genuine lossless or quality-controlled lossy encoding and optional transparency. Encoding uses a local, cancelable libwebp WebAssembly worker, so it also works where canvas WebP encoding is unavailable. Limits are 16 MP and 16,383 pixels per side. This exports rendered SDR pixels, like ordinary PNG/JPEG; it does not export the original HDR radiance. WebP has no added document-resolution metadata in this implementation.
- **Tool settings → Crop ratio** adds 9:20 and Custom with independent ratio width/height. The crop frame keeps its ratio at canvas edges and during backward drags. Invalid custom values leave settings open.
- **File → New from Clipboard** validates and decodes the image before creating another tab. A missing or invalid image leaves the current project intact.
  Android's native bridge reads image content URIs and existing image data URLs only when requested, with file-size and pixel limits. iOS uses its native image pasteboard through Capacitor.
- **Select → Stroke selection** edits the active image layer with Inside/Center/Outside position, width, color, opacity, six blend modes and optional transparency preservation. Selection holes are honored, small sources can grow, and effects and the selection are retained. Applying creates one undo step; zero opacity is a no-op. Protected originals require explicit rasterization first. The coverage uses grayscale morphology, including square corner growth, rather than reproducing every Photoshop stroke edge rule.
- Shared controls, menus and errors have English/Simplified Chinese text. The New Canvas width receives focus and selects its existing value.

Native Mac has not gained the shared WebP exporter or selection-stroke interface in this change. Remaining issues such as full CMYK/Lab document editing, 16/32-bit Photoshop files, LUT layers, Dodge/Burn, RGBA channel editing, plugin/MCP APIs and Linux distribution remain separate work.

## Verification

`CompositorTests/EditingMetadataTests.swift` covers geometry edits, preserved layer effects, protected resources, undo/redo and refused shear. Shared Node tests cover crop constraints, stroke coverage/alpha, no-op behavior and WebP byte preservation. Browser cases run in Windows WebView2 and phone Chromium/WebKit, covering actual WebP encode/decode, stroke undo, clipboard tab isolation, validation and Chinese dialogs. Native Mac tests require Xcode.
