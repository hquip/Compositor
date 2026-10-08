# Preview 0.3.0 local verification

Verified locally on Windows, October 7, 2026. No repository was created or pushed, and no remote workflow ran.

| Check | Result |
| --- | --- |
| Windows .NET Release build | Passed, zero warnings/errors |
| Unit/native-store/kernel/text-range tests | 28 passed |
| UI suite against packaged Windows executable | 41 passed, 1 skipped |
| Chromium/WebKit phone UI suite | 43 passed, 1 skipped |
| Editing parity inside the actual Android WebView | 15 passed |
| Mobile archive/export validation | 6 passed |
| Android debug APK and lint | Build passed; lint: 0 errors, 17 template/resource warnings |
| iOS project references and plugin registration | Static check passed; not an Xcode build |
| Workflow YAML | Parsed locally; execution not performed |

The skipped Windows case requires the Mac-saved artifact. The skipped WebKit case requires Chromium's multi-touch injection protocol. Android native parity tests install only into a dedicated emulator, not a physical device.

Windows package: `dist/windows/Compositor-Windows-0.3.0-x64.zip` (about 9.36 MiB; program files about 23.25 MiB). Android package: `dist/mobile/Compositor-Android-0.3.0-debug.apk`.

The tests cover the specific behavior in [editing-parity.md](editing-parity.md), including gradient commit/cancel, selection movement/growth, clipping source deletion and merge semantics, linked-mask distortion, Unicode text shaping, paragraph editing, invalid-draft recovery and native save/close/reopen. They do not establish full application parity. Original Mac tests, cross-platform render comparison, iOS compilation/device testing, signing, and the other items in [windows-migration.md](windows-migration.md) remain outstanding.
