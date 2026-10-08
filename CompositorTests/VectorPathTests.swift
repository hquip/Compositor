import AppKit
import Testing
@testable import Compositor

@MainActor
struct VectorPathTests {
    private var style: VectorPathStyle {
        VectorPathStyle(contours: [VectorContour(closed: true, nodes: [VectorNode(point: [0, 0]), VectorNode(point: [1, 0]), VectorNode(point: [1, 1]), VectorNode(point: [0, 1])])], fillRule: "evenodd", fill: VectorColor(red: 1, green: 1, blue: 1), stroke: nil, strokeWidth: 0)
    }

    @Test func vectorsSurviveNativeSavingOpeningAndDuplication() async throws {
        let context = try #require(CGContext(data: nil, width: 8, height: 8, bitsPerComponent: 8, bytesPerRow: 32,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
        let image = try #require(context.makeImage()), asset = ImportedImage(image: image, thumbnail: image, name: "Vector")
        var layer = ImageLayer(asset: asset, origin: .zero)
        layer.vectorPath = LayerVectorPath(style: style, image: image)
        layer.mask = try #require(LayerMask.solid(revealing: true))
        layer.vectorMask = LayerVectorPath(style: style, image: layer.mask!.asset.image)
        let session = EditorSession(); session.document = CanvasDocument(width: 16, height: 16, layers: [layer]); session.activeLayerID = layer.id
        let snapshot = try #require(session.projectSnapshot())
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Vector-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(snapshot, to: url)
        let loaded = try await ProjectStore.shared.load(from: url)
        session.installProject(loaded, from: url); session.duplicateLayers([layer.id])
        let copied = try #require(session.projectSnapshot())
        #expect(copied.manifest.layers.count == 2)
        #expect(copied.manifest.layers.allSatisfy { $0.vectorPath == style && $0.vectorMask == style })
    }

    @Test func invalidCoordinatesAndOpenMaskContoursAreRejected() {
        var value = style; value.contours[0].nodes[0].point = [.infinity, 0]
        #expect(!value.isValid())
        value = style; value.contours[0].closed = false
        #expect(value.isValid() && !value.isValid(mask: true))
    }
}
