# Image extensions and MCP

## Image plugin API 1

Install a local JSON package through Extensions → Install image plugin. A package contains `manifest` and `source`:

```json
{
  "manifest": { "apiVersion": 1, "id": "example.invert", "name": "Invert red" },
  "source": "function transform(image, settings) { for (let i = 0; i < image.data.length; i += 4) image.data[i] = 255 - image.data[i]; return image; }"
}
```

`transform` receives `{ width, height, data: Uint8ClampedArray }` and JSON settings. It returns the same-sized image; a resolved Promise is accepted. Output must contain exactly width × height × 4 RGBA bytes. Plugins run inside a separate QuickJS WebAssembly interpreter with no DOM, network, filesystem, native bridge or IndexedDB bindings. The runtime limits memory to 256 MiB, stack to 512 KiB, execution to five seconds and pending jobs to 10,000. A host worker enforces a 15-second startup/total timeout and cancellation. This is an image-processing API; it does not grant UI/native application code extensions.

Applying to a raster layer honors its selection and creates one undo step. Protected channel/HDR/smart-object sources require their own source-preserving editor or explicit rasterization. Installations live in the local library and are not published or synced automatically.

## External filters

Extensions → Export to external filter writes the selected layer as PNG through a native save/share dialog. Process that file in another application, then use Import external filter result. The layer ID, document revision and dimensions must still match; results apply in one undo step and honor the active selection. This explicit file exchange works without launching arbitrary programs or supplying application credentials.

## MCP

Start the local stdio MCP service with Node 24+:

```sh
node desktop/mcp/server.mjs /absolute/path/to/projects
```

Configure an MCP client with this command, arguments and project workspace. The service supports initialize, ping, tools/list and tools/call using newline-delimited JSON-RPC. It exposes `compositor_inspect`, `compositor_update_layer` and `compositor_adjust`. All project paths must resolve inside the configured workspace. Writes use the existing validated, atomic .comp writer. The editor's external-change watcher can then reload the modified project.

The adjustment tool protects the original raster as an editable filter source; it currently accepts unmasked ordinary 8-bit raster inputs. Use the interactive editor for protected or high-precision content. The MCP service does not execute shell commands, connect to other computers or read unrelated files.
