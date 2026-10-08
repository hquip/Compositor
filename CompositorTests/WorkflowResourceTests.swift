import AppKit
import Testing
@testable import Compositor

@MainActor struct WorkflowResourceTests {
    @Test func lookupAndMixedTextResourcesSurviveOpeningGeometryAndSaving() async throws {
        let context = try BrushRaster.context(width: 4, height: 4, mask: false)
        context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: 4, height: 4))
        let image = try #require(context.makeImage()), session = EditorSession(), file = UUID().uuidString + ".resource.bin"
        let lookup = Data("LUT_1D_SIZE 2\n1 1 1\n0 0 0".utf8)
        var pixels = ImageLayer(asset: ImportedImage(image: image, thumbnail: image, name: "Pixels"), origin: .zero)
        pixels.fillOpacity = 0.5
        var style = LayerTextStyle(content: "Small BIG", fontSize: 18)
        style.sizeRuns = [LayerTextSizeRun(location: 6, length: 3, fontSize: 40)]
        let textImage = try EditorSession.textImage(style)
        var text = ImageLayer(asset: ImportedImage(image: textImage, thumbnail: textImage, name: "Text"), origin: .zero)
        text.text = LayerText.loaded(style, image: textImage)
        var lut = ImageLayer(name: "Lookup", blankSize: CGSize(width: 20, height: 20))
        lut.workflow = ["type": .string("lut"), "file": .string(file)]
        session.document = CanvasDocument(width: 20, height: 20, layers: [pixels, text, lut])
        session.document?.resources = [WorkflowResource(file: file, kind: "lookup")]
        session.document?.workflowSources[file] = lookup
        session.activeLayerID = pixels.id
        let snapshot = try #require(session.projectSnapshot()), url = FileManager.default.temporaryDirectory.appendingPathComponent("Workflow-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(snapshot, to: url)
        let reopened = try await ProjectStore.shared.load(from: url)
        #expect(reopened.manifest.version == 17); #expect(reopened.workflowSources[file] == lookup)
        session.installProject(reopened, from: url)
        #expect(session.document?.layers[0].fillOpacity == 0.5)
        #expect(session.document?.layers[1].liveText?.style.sizeRuns == style.sizeRuns)
        #expect(session.document?.layers[2].adjustment?.workflowLookup != nil)
        let resized = try await CanvasResizer.shared.resize(try #require(session.projectSnapshot()), to: CanvasSizeOptions(width: 30, height: 30))
        session.applyDocumentSize(resized, actionName: "Canvas Size")
        let saved = try #require(session.projectSnapshot())
        #expect(saved.workflowSources[file] == lookup)
        #expect(saved.manifest.layers[2].adjustment == nil)
        #expect(saved.manifest.layers[2].workflow == lut.workflow)
        try await ProjectStore.shared.save(saved, to: url)
    }

    @Test func lookupUsesStraightColorsAndRetainsPremultipliedAlpha() throws {
        let table = try WorkflowLookup.parse(Data("LUT_1D_SIZE 2\n1 1 1\n0 0 0".utf8))
        #expect(table.color([0.25, 0.5, 0.75]) == [0.75, 0.5, 0.25])
        #expect(throws: ProjectError.self) { try WorkflowLookup.parse(Data("LUT_3D_SIZE 2\n0 0 0".utf8)) }
    }

    @Test func mixedTextSizeAttributesAndReplacementKeepUneditedRanges() throws {
        var style = LayerTextStyle(content: "ABCD", fontSize: 20)
        style.sizeRuns = [LayerTextSizeRun(location: 1, length: 2, fontSize: 40)]
        let string = EditorSession.attributedText(style)
        #expect((string.attribute(.font, at: 1, effectiveRange: nil) as? NSFont)?.pointSize == 40)
        style.replaceCharacters(in: NSRange(location: 1, length: 0), withLength: 1)
        style.content = "A!BCD"
        #expect(style.sizeRuns == [LayerTextSizeRun(location: 2, length: 2, fontSize: 40)])
        #expect(style.isValid)
    }
}
