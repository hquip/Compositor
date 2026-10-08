# Compositor · 跨平台预览版

免费开源的图像合成与照片编辑器。本仓库在 [Robbie Tilton 的 Compositor](https://github.com/robbietilton/Compositor) 基础上增加 Windows、Android/iOS 共享编辑器、英文/简体中文切换、智能对象和 OpenEXR/HDR 工作流，保留原作者署名和 [MIT 许可证](LICENSE)。

**当前版本：0.10.0 Preview，项目格式：16。** 这是一份跨平台开发预览版，完整 Mac/Photoshop 行为对齐仍在验收。

[预览版下载](https://github.com/hquip/Compositor/releases/tag/v0.10.0) · [构建与测试](https://github.com/hquip/Compositor/actions) · [功能与限制](docs/windows-migration.md) · [本地验收报告](docs/verification-0.10.0.md)

| 平台 | 当前状态 | 使用说明 |
| --- | --- | --- |
| Windows | 可运行的 x64 便携预览版，需 .NET Framework 4.8 与 WebView2 | [Windows 文档](desktop/README.md) |
| Android | 可安装的 Debug APK，使用本地 WebView 编辑器 | [手机端文档](mobile/README.md) |
| iOS | 原生项目和共享编辑器已接入，原生构建/设备验收通过 CI 继续验证 | [iOS 构建说明](mobile/README.md) |
| macOS | 保留 SwiftUI/AppKit 原版，增加新项目格式和保护源的保存兼容；原生 HDR 显示尚未接入 | [原版 Mac 说明](docs/original-macos-readme.md) |

Windows/Android 构建尚未签名用于正式发行；Android APK 为 Debug 签名。下载 ZIP 后保持 DLL、`renderer` 和 `third-party` 目录在一起。界面右上角可切换 English / 简体中文。

## 本轮功能

- 图层、分组、蒙版、剪贴蒙版、选区、绘画/修复、变换、文字、路径、渐变、动作/预设及恢复。
- 可编辑滤镜与独立滤镜蒙版、16 位源图、ICC 转换/软打样、RGB/CMYK TIFF、PSD/PSB 输出。
- 嵌入式栅格智能对象、共享内容替换、内容编辑页及兼容对象的 Photoshop 交付。
- PIZ、ZIP/ZIPS、分块、多部分 EXR；Deep 样本保留、按深度合成预览与原文件无损导出。
- 可选线性 sRGB、Rec.2020、P3、ACES HDR 工作空间；支持的设备可启用扩展 HDR 显示，不支持的设备回退 SDR。

详细边界见 [OpenEXR/HDR](docs/openexr.md)、[智能对象](docs/smart-hdr.md)、[专业工作流](docs/professional-workflows.md)。Deep 二维编辑不会改写每个深度样本；复杂 Photoshop 内容、原生 Mac 渲染和真实 HDR 屏幕效果仍需进一步验收。

## 构建

Windows 开发环境：Node 24+、.NET SDK 10、LLVM（`clang`/`wasm-ld`）。

```powershell
cd desktop
npm ci --ignore-scripts
npm run build:win
npm test
npm run test:ui
npm run dist:win
```

Android/iOS：另在 `mobile/` 运行 `npm ci --ignore-scripts`、`npm run build` 与 `npx cap sync`。Android 使用 JDK 21 / Android SDK 36；iOS 和原版 Mac 使用 macOS / Xcode 26。操作系统、签名和验收要求见各平台文档。

仓库包含运行所需的模型、许可证和带校验值的 OpenEXR WASM 预编译文件；常规构建不需要下载 Emscripten。重编 EXR 的源码版本和工具链见 [build-exr.ps1](desktop/scripts/build-exr.ps1) 与 [runtime.json](desktop/native/exr/runtime.json)。依赖缓存、测试日志、工具链、签名密钥及本机配置不在源码仓库中。

## English

Compositor is a free, local image editor. This repository extends the upstream macOS application with Windows and Android/iOS clients, English/Simplified Chinese UI, protected raster objects, professional color/export tools and bounded EXR/HDR workflows. Version 0.10.0 is a development preview. See the platform documentation and verification report for tested behavior and remaining limits. Upstream authorship and third-party licenses are preserved.
