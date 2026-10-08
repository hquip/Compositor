# Preview 0.4.0 local verification

Verified locally on Windows, October 7, 2026. No repository was created or pushed, and no remote workflow ran. Counts below are unique cases: full suites were followed by targeted reruns after fixes and adjustments for asynchronous previews/native restarts.

| Check | Result |
| --- | --- |
| Windows .NET Release build and portable package | Passed, zero warnings/errors |
| Unit/native-store/kernel/text-range tests | 28 passed |
| Mobile archive/export validation | 6 passed |
| UI coverage against the packaged Windows executable | 53 passed, 1 skipped |
| Chromium/WebKit phone UI coverage | 65 passed, 1 skipped; all 22 new enhancement cases rechecked |
| Shared editing coverage in the actual Android WebView | 27 passed, including native background/force-stop recovery |
| Android debug APK and lint | Build passed; lint: 0 errors, 17 template/resource warnings |
| Final Android native smoke check | Actual touch input, local save, cold restart, language preference, rendered pixels, and synthetic Bayer DNG decoding passed |
| iOS project references and plugin registration | Static check passed; not an Xcode build |

The Windows skip requires a Mac-saved round-trip artifact. The WebKit skip requires Chromium's multi-touch injection protocol. Android tests install only into the dedicated `Compositor_Test_API36` emulator, never a physical device.

New checks cover multiple unsaved tabs, stored selection holes, Unicode text/gradient/selection drafts after restart, failed checkpoint writes, successful-save cleanup, explicit-discard cleanup, one-step undo for floating transforms, source-bound growth, actual resize handles and nudging, distortion/cancel behavior, filter mask coverage, worker cancellation, and unchanged source assets during previews. The Windows native test terminates the host process, restarts with its existing profile, recovers pixels, and saves the recovered copy to a new `.comp` directory. The Android native test backgrounds the app and verifies a checkpoint before force-stopping and restarting it.

Filter comparisons use premultiplied RGB and an independent alpha comparison, with a maximum difference of 3/255 for the tested fixtures. Testing found a larger Android alpha difference between GPU and CPU Gaussian blur. Using software-backed blur surfaces on both threads resolved it; the Android filter case and Windows/Chromium/WebKit filter cases were rerun successfully. This local check does not establish Mac rendering equivalence.

Windows package: `dist/windows/Compositor-Windows-0.4.0-x64.zip` (about 9.37 MiB; program files about 23.29 MiB). Android package: `dist/mobile/Compositor-Android-0.4.0-debug.apk`.

Package SHA-256:

- Windows ZIP: `C0536BDBAF5DA79F6BB467F7E2CCA01D7F2B782C0AA3143D1151A4F1EEB70C21`
- Android APK (about 14.32 MiB): `464BE1944FBA31F2010EA14BDEE35BFF3ECC01EEEB514BC16B18B50AE9DC9858`

Original Mac tests, Windows → Mac → Windows rendering comparison, iOS compilation/device testing, publisher signing, and the remaining items in [windows-migration.md](windows-migration.md) are still outstanding. Recovery checkpoints and worker previews do not remove all large-document memory/encoding/compositing costs. See [reliability-0.4.0.md](reliability-0.4.0.md) for behavior and limits.
