import AppKit
import Testing
@testable import Compositor

@MainActor
struct FilterMaskTests {
    @Test func blackFilterMaskKeepsOriginalPixelsAndSurvivesProjectCopies() async throws {
        let context = try #require(CGContext(data: nil, width: 4, height: 2, bitsPerComponent: 8, bytesPerRow: 16,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue))
        context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1); context.fill(CGRect(x: 0, y: 0, width: 4, height: 2))
        let image = try #require(context.makeImage()), source = ImportedImage(image: image, thumbnail: image, name: "Original"), mask = try #require(LayerMask.solid(revealing: false))
        var layer = ImageLayer(asset: source, origin: .zero)
        let id = UUID(), name = "\(layer.id.uuidString).\(id.uuidString).filter-mask.png"
        let entry = StoredLayerFilter(id: id, enabled: true, adjustment: LayerAdjustment(kind: .invert), maskFile: name, maskEnabled: true, opacity: 1)
        let result = try EditableFilterRenderer.render(image, filters: [entry], masks: [id: mask.asset])
        context.clear(CGRect(x: 0, y: 0, width: 4, height: 2)); context.draw(result, in: CGRect(x: 0, y: 0, width: 4, height: 2))
        let pixels = try #require(context.data?.assumingMemoryBound(to: UInt8.self))
        #expect(pixels[0] == 255 && pixels[1] == 0 && pixels[2] == 0 && pixels[3] == 255)
        layer.editableFilters = LayerFilterState(source: source, rendered: image, entries: [entry], masks: [id: mask.asset])
        let session = EditorSession(); session.document = CanvasDocument(width: 8, height: 8, layers: [layer]); session.activeLayerID = layer.id
        let snapshot = try #require(session.projectSnapshot()), url = FileManager.default.temporaryDirectory.appendingPathComponent("FilterMask-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(snapshot, to: url); let loaded = try await ProjectStore.shared.load(from: url)
        #expect(loaded.filterMasks.count == 1)
        session.installProject(loaded, from: url); session.duplicateLayers([layer.id])
        let copy = try #require(session.projectSnapshot())
        #expect(copy.filterMasks.count == 2)
        #expect(copy.manifest.layers[0].filters?[0].maskFile != copy.manifest.layers[1].filters?[0].maskFile)
    }
}
