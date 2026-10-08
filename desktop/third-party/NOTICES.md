# Third-party components

The Windows application remains under the repository MIT license. Its third-party components retain their own licenses.

- **QuickJS-emscripten 0.32.0** — MIT, Jake Teton-Landis and QuickJS contributors. Used as a separate WebAssembly interpreter for image plugins, with memory/stack/CPU limits and no host IO bindings. Source: <https://github.com/justjake/quickjs-emscripten>. License in `QuickJS-emscripten-LICENSE.txt`.
- **Tauri 2** and dialog/clipboard plugins — MIT/Apache-2.0, Tauri contributors. The compatible Linux/macOS host uses the operating system WebView. Exact Rust dependencies are recorded in `src-tauri/Cargo.lock`; JavaScript dependencies in `package-lock.json`. Source: <https://github.com/tauri-apps/tauri>.
- **Graphemer 1.4.0** — MIT, Flmnt and contributors; Unicode grapheme segmentation fallback for older WebKit. Source: <https://github.com/flmnt/graphemer>. License in `Graphemer-LICENSE.txt`.

- **jSquash WebP 1.5.0** — Apache-2.0 JavaScript wrapper and libwebp WebAssembly codec derived from Squoosh; source: <https://github.com/jamsinclair/jSquash/tree/main/packages/webp>. Wrapper license in `jSquash-WebP-LICENSE.txt`; the codec's BSD license is in `libwebp-LICENSE.txt`.

- **OpenEXR 3.4.16** — BSD-3-Clause, Academy Software Foundation contributors; source: <https://github.com/AcademySoftwareFoundation/openexr/tree/v3.4.16>. The WebAssembly module is built from the official library with Compositor's memory-stream wrapper. License in `OpenEXR-LICENSE.txt`; source pin, toolchain and binary hashes in `desktop/native/exr/runtime.json`; rebuild with `desktop/scripts/build-exr.ps1`.
- **Imath 3.2.2** — BSD-3-Clause, OpenEXR math dependency; <https://github.com/AcademySoftwareFoundation/Imath/tree/v3.2.2>; license in `Imath-LICENSE.txt`.
- **libdeflate 1.25** — MIT, Eric Biggers; <https://github.com/ebiggers/libdeflate>; statically included in the EXR runtime; license in `Libdeflate-LICENSE.txt`.
- **OpenJPH 0.31.0** — BSD-2-Clause; <https://github.com/aous72/OpenJPH>; statically included by OpenEXR; license in `OpenJPH-LICENSE.txt`.

- **Microsoft Edge WebView2 SDK 1.0.4258.31** — Microsoft redistributable SDK; the shared runtime is installed separately. Source and terms: <https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.4258.31>.
- **ag-psd 31.0.2** — MIT, copyright Agamnentzar. Source: <https://github.com/Agamnentzar/ag-psd>. License included in `ag-psd-LICENSE.txt`.
- **pako** — MIT/Zlib, used by ag-psd. Source: <https://github.com/nodeca/pako>. The exact dependency version is recorded in `desktop/package-lock.json`.
- **libheif-js 1.23.5 / libheif** — LGPL-3.0. The unmodified, separately replaceable module is `renderer/vendor/libheif.mjs`. Source and build scripts: <https://github.com/catdad-experiments/libheif-js/tree/v1.23.5> and <https://github.com/strukturag/libheif>. License included in `libheif-LICENSE.txt`.
- **LibRaw-Wasm 1.6.0** — ISC wrapper; underlying LibRaw is available under LGPL-2.1 or CDDL-1.0. The application uses the LGPL option. Source/build scripts: <https://github.com/ybouane/LibRaw-Wasm/tree/v1.6.0> and <https://github.com/LibRaw/LibRaw>. Its JavaScript, worker and WASM files are separately replaceable in `renderer/vendor/libraw/`. LibRaw license included in `LibRaw-LICENSE.txt`. The compiled dependency also uses Little CMS, copyright Marti Maria, under the MIT license: <https://github.com/mm2/Little-CMS>.
- **ONNX Runtime Web 1.30.0** — MIT, Microsoft. Source: <https://github.com/microsoft/onnxruntime/tree/v1.30.0>. Runtime files are in `renderer/vendor/ort/`.
- **U²-Net-P** — Apache-2.0, Xuebin Qin and collaborators. Source: <https://github.com/xuebinqin/U-2-Net>. Model published by <https://github.com/danielgatis/rembg/releases/tag/v0.0.0>, mirrored at <https://huggingface.co/edgetools/u2netp>. The bundled model SHA-256 is `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`. License included in `U-2-Net-LICENSE.txt`.

U²-Net citation: Qin et al., “U²-Net: Going Deeper with Nested U-Structure for Salient Object Detection,” Pattern Recognition 106 (2020), 107404.

The HEIC image in `desktop/tests/fixtures/example.heic` is a development fixture from the libheif repository (v1.19.8, Git blob `829384037820e545467a4af49aa6414c2b0f2885`). It is not included in the application package.

The original Compositor C kernels are compiled unchanged from `Compositor/Rendering`. The small portability runtime and warp adapter are in `desktop/native`.

Text layout uses **bidi-js 1.1.0** by Jason Johnston (MIT, <https://github.com/lojjic/bidi-js>) and **linebreak 1.1.0** by Devon Govett (MIT, <https://github.com/foliojs/linebreak>). Their bundled dependencies are unicode-trie, tiny-inflate and base64-js, also under MIT licenses. License copies are included alongside these notices. These libraries determine Unicode ordering and break opportunities; glyph shaping and font rasterization use the local browser's font engine.

The mobile bundle additionally includes Capacitor 8.5.2 and its pinned official filesystem/share/clipboard/app plugins (MIT), fflate 0.8.3 (MIT), and UTIF.js 3.1.0 by Photopea (MIT), with its pako dependency. Their individual license files are copied into the mobile bundle's `third-party/` directory. Exact versions are recorded in `mobile/package-lock.json`.

LibRaw-Wasm declares the wrapper's ISC license in its published package metadata; the upstream package does not supply a separate wrapper LICENSE file. The original package metadata and README are included as `LibRaw-Wasm-package.json` and `LibRaw-Wasm-README.md`. No license text or copyright owner has been invented for that missing file.
# Color management additions

LittleCMS WebAssembly bindings: lcms-wasm 1.0.4, MIT, https://github.com/mattdesl/lcms-wasm. The bindings and compiled LittleCMS engine are shipped locally. The package's Node-only test dependencies are not included in application packages.

The desktop bundle also includes UTIF.js 3.1.0 (MIT) and fflate 0.8.3 (MIT) for high-precision TIFF import and local batch archives. See `UTIF-LICENSE.txt` and `fflate-LICENSE.txt`.

Compact ICC Profiles: sRGB-v2-magic, AdobeCompat-v2, DisplayP3-v4, ProPhoto-v4 from https://github.com/saucecontrol/Compact-ICC-Profiles, CC0. See `Compact-ICC-Profiles-LICENSE.txt`. These RGB profiles do not define a printing condition; users choose a printer-supplied CMYK profile for print conversion and proofing.
