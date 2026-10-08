import AppKit
import Testing
@testable import Compositor

@MainActor
struct ProtectedSourceTests {
    @Test func wideHDRAndRetainedDeepSourceSurviveMacSaving() async throws {
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
        let hdr = try Data(contentsOf: fixtures.appendingPathComponent("HDR-ACEScg.tif")), deep = try Data(contentsOf: fixtures.appendingPathComponent("Deep-tiled.exr"))
        #expect(try HDRSourceStore.inspect(hdr, wide: true) == 16)
        try OpenEXRSourceStore.inspect(deep)
        let context = try #require(CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 8, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let image = try #require(context.makeImage()), asset = ImportedImage(image: image, thumbnail: image, name: "Deep")
        var layer = ImageLayer(asset: asset, origin: .zero)
        layer.hdrSource = LayerHDRSource(data: hdr, filters: [StoredLayerFilter(id: UUID(), enabled: false, adjustment: LayerAdjustment(kind: .exposure))], exrData: deep, exrView: StoredEXRView(part: 0, group: "", levelX: 0, levelY: 0, encoding: "File color metadata"))
        let session = EditorSession(); session.document = CanvasDocument(width: 2, height: 2, layers: [layer], hdrView: HDRPreview(exposure: 0, toneMap: "Reinhard", displayMode: "Auto"), hdrWorkingSpace: "ACEScg"); session.activeLayerID = layer.id
        let snapshot = try #require(session.projectSnapshot()), url = FileManager.default.temporaryDirectory.appendingPathComponent("Deep-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(snapshot, to: url); let loaded = try await ProjectStore.shared.load(from: url)
        #expect(loaded.manifest.version == ProjectManifest.current); #expect(loaded.manifest.hdrWorkingSpace == "ACEScg"); #expect(loaded.exrSources[layer.id] == deep); #expect(loaded.hdrSources[layer.id] == hdr)
        session.installProject(loaded, from: url); session.duplicateLayers([layer.id]); #expect(session.projectSnapshot()?.exrSources.count == 2)
    }
    @Test func rawHDRAndSmartIdentitySurviveSavingAndDuplication() async throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/HDR32.tif"), bytes = try Data(contentsOf: fixture)
        #expect(try HDRSourceStore.inspect(bytes) == 8)
        let context = try #require(CGContext(data: nil, width: 2, height: 1, bitsPerComponent: 8, bytesPerRow: 8, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let image = try #require(context.makeImage()), asset = ImportedImage(image: image, thumbnail: image, name: "HDR")
        var layer = ImageLayer(asset: asset, origin: .zero)
        layer.hdrSource = LayerHDRSource(data: bytes, filters: [StoredLayerFilter(id: UUID(), enabled: false, adjustment: LayerAdjustment(kind: .exposure))])
        layer.smartObject = StoredSmartObject(id: UUID(), width: 2, height: 1, baseTransform: layer.transform)
        let session = EditorSession(); session.document = CanvasDocument(width: 2, height: 1, layers: [layer], hdrView: HDRPreview(exposure: 0, toneMap: "Reinhard")); session.activeLayerID = layer.id
        let snapshot = try #require(session.projectSnapshot()), url = FileManager.default.temporaryDirectory.appendingPathComponent("HDR-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(snapshot, to: url); let loaded = try await ProjectStore.shared.load(from: url)
        #expect(loaded.hdrSources[layer.id] == bytes); session.installProject(loaded, from: url); session.duplicateLayers([layer.id])
        #expect(session.projectSnapshot()?.hdrSources.count == 2)
        #expect(session.activeLayer?.smartObject?.id == layer.smartObject?.id)
        #expect(!session.canPaint)
    }
}
