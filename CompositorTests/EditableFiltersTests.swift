import AppKit
import Testing
@testable import Compositor

@MainActor
struct EditableFiltersTests {
    @Test func sourcesAndParametersSurviveSavingReopeningAndCopying() async throws {
        let context = try #require(CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        context.setFillColor(red: 1, green: 0, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 8, height: 8))
        let image = try #require(context.makeImage()), source = ImportedImage(image: image, thumbnail: image, name: "Original")
        let entries = [StoredLayerFilter(id: UUID(), enabled: true, adjustment: LayerAdjustment(kind: .invert))]
        let rendered = try await EditableFilterWorker.shared.render(source, filters: entries)
        var layer = ImageLayer(asset: rendered, origin: .zero)
        layer.editableFilters = LayerFilterState(source: source, rendered: rendered.image, entries: entries)
        let session = EditorSession()
        session.document = CanvasDocument(width: 16, height: 16, layers: [layer])
        session.activeLayerID = layer.id
        let before = try #require(session.projectSnapshot())
        #expect(before.manifest.version == ProjectManifest.current)
        #expect(before.filterSources[layer.id]?.image === image)
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("CompositorFilters-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: path) }
        try await ProjectStore.shared.save(before, to: path)
        let restored = try await ProjectStore.shared.load(from: path)
        #expect(restored.manifest.layers[0].filters == entries)
        #expect(restored.filterSources[layer.id]?.image.width == 8)
        session.installProject(restored, from: path)
        session.duplicateLayers([layer.id])
        #expect(session.document?.layers.count == 2)
        #expect(session.activeLayer?.liveFilters?.entries == entries)
        let copied = try #require(session.projectSnapshot())
        #expect(copied.filterSources.count == 2)
        #expect(copied.manifest.layers[0].filterSourceFile != copied.manifest.layers[1].filterSourceFile)
    }

    @Test func pixelReplacementBakesFiltersWithoutChangingTheRetainedOriginal() throws {
        let context = try #require(CGContext(data: nil, width: 2, height: 2, bitsPerComponent: 8, bytesPerRow: 8,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let image = try #require(context.makeImage()), source = ImportedImage(image: image, thumbnail: image, name: "Original")
        var layer = ImageLayer(asset: source, origin: .zero)
        layer.editableFilters = LayerFilterState(source: source, rendered: image, entries: [StoredLayerFilter(id: UUID(), enabled: true, adjustment: LayerAdjustment(kind: .invert))])
        #expect(layer.liveFilters != nil)
        context.setFillColor(red: 0, green: 1, blue: 0, alpha: 1)
        context.fill(CGRect(x: 0, y: 0, width: 2, height: 2))
        let replacement = try #require(context.makeImage())
        layer.asset = ImportedImage(image: replacement, thumbnail: replacement, name: "Painted")
        #expect(layer.liveFilters == nil)
        #expect(layer.editableFilters?.source.image === image)
    }
}
