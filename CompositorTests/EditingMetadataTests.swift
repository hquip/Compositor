import AppKit
import Testing
import UniformTypeIdentifiers
@testable import Compositor

@MainActor struct EditingMetadataTests {
    private func session() throws -> EditorSession {
        let context = try BrushRaster.context(width: 8, height: 4, mask: false)
        context.setFillColor(CGColor(red: 0.3, green: 0.5, blue: 0.7, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 8, height: 4))
        let image = try #require(context.makeImage()), asset = ImportedImage(image: image, thumbnail: image, name: "Source")
        var text = ImageLayer(asset: asset, origin: CGPoint(x: 4, y: 4))
        text.text = LayerText.loaded(LayerTextStyle(content: "Editable 中文"), image: image)
        text.effects = LayerEffects(stroke: StrokeEffect(size: 2))
        var shape = ImageLayer(asset: asset, origin: CGPoint(x: 14, y: 4))
        shape.shape = LayerShape.loaded(LayerShapeStyle(kind: .rectangle, red: 1, green: 0, blue: 0, cornerRadius: 0), image: image)
        shape.effects = LayerEffects(shadow: ShadowEffect(distance: 2, blur: 1))
        var filtered = ImageLayer(asset: asset, origin: CGPoint(x: 4, y: 10))
        filtered.editableFilters = LayerFilterState(source: asset, rendered: image,
            entries: [StoredLayerFilter(id: UUID(), enabled: false, adjustment: LayerAdjustment(kind: .exposure))])
        let session = EditorSession()
        session.document = CanvasDocument(width: 32, height: 16, layers: [text, shape, filtered])
        session.activeLayerID = text.id
        session.history.reset()
        return session
    }

    private func expectEditable(_ session: EditorSession, matching original: CanvasDocument) throws {
        let layers = try #require(session.document?.layers)
        #expect(layers[0].liveText?.style == original.layers[0].liveText?.style)
        #expect(layers[1].liveShape?.style == original.layers[1].liveShape?.style)
        #expect(layers[2].liveFilters?.entries == original.layers[2].liveFilters?.entries)
        #expect(layers[2].liveFilters?.source.image === original.layers[2].liveFilters?.source.image)
        #expect(layers[0].effects == original.layers[0].effects)
        #expect(layers[1].effects == original.layers[1].effects)
    }

    @Test func canvasResizeAndCropRetainEditableContentAndUndo() async throws {
        for options in [CanvasSizeOptions(width: 48, height: 32),
                        CanvasSizeOptions(width: 24, height: 12, contentOffset: CGPoint(x: -2, y: -2))] {
            let session = try session(), original = try #require(session.document)
            let result = try await CanvasResizer.shared.resize(try #require(session.projectSnapshot()), to: options)
            session.applyDocumentSize(result, actionName: "Canvas Size")
            try expectEditable(session, matching: original)
            session.undo(); #expect(session.document == original)
            session.redo(); try expectEditable(session, matching: original)
        }
    }

    @Test func proportionalImageResizeRetainsSourcesAndRotatedText() async throws {
        let session = try session()
        session.document?.layers[0].transform.rotation = 30
        let original = try #require(session.document)
        let result = try await ImageResizer.shared.resize(try #require(session.projectSnapshot()),
            to: ImageSizeOptions(width: 64, height: 32, resolution: 300))
        session.applyImageSize(result)
        try expectEditable(session, matching: original)
        #expect(abs(try #require(session.document?.layers[0].transform.rotation) - 30) < 1e-8)
        #expect(session.document?.layers[0].asset?.image === original.layers[0].asset?.image)
        session.undo(); #expect(session.document == original)
        session.redo(); try expectEditable(session, matching: original)
    }

    @Test func unevenResizeRefusesEditableShearWithoutChangingTheDocument() async throws {
        let session = try session()
        session.document?.layers[0].transform.rotation = 30
        let original = try #require(session.document)
        do {
            _ = try await ImageResizer.shared.resize(try #require(session.projectSnapshot()),
                to: ImageSizeOptions(width: 64, height: 16, resolution: 72))
            Issue.record("A rotated editable layer cannot represent nonuniform shear")
        } catch ImageResizeError.editableShear { }
        #expect(session.document == original)
        #expect(session.history.undoCount == 0)
    }

    @Test func pixelAdjustmentsPreserveLayerEffects() async throws {
        let session = try session()
        // These are destructive pixel edits; text becomes pixels, and the effects stay separate.
        let effects = try #require(session.activeLayer?.effects)
        session.beginHueSaturation(); session.updateHueSaturation(HueSaturationSettings(hue: 15), preview: true)
        await session.hueSaturationTask?.value; await session.commitHueSaturation()
        #expect(session.activeLayer?.effects == effects)
        session.beginLevels(); var levels = LevelsSettings(); levels.current.gamma = 1.3
        session.updateLevels(levels, preview: true); await session.commitLevels()
        #expect(session.activeLayer?.effects == effects)
        await session.invertPixels(); #expect(session.activeLayer?.effects == effects)
    }

    @Test func trimAndFloatingSelectionPreserveLayerEffects() async throws {
        let session = try session(), original = try #require(session.document)
        let snapshot = try #require(session.projectSnapshot())
        let trimmedResult = try await ImageTrim.trim(snapshot, options: TrimOptions())
        let trimmed = try #require(trimmedResult)
        session.applyDocumentSize(trimmed, actionName: "Trim")
        try expectEditable(session, matching: original)
        session.undo(); #expect(session.document == original)
        session.document?.selection = DocumentSelection(path: CGPath(rect: CGRect(x: 4, y: 4, width: 4, height: 4), transform: nil))
        session.beginTransform()
        var draft = try #require(session.transformEdit?.draft)
        draft.origin.x += 8
        session.previewTransform(draft); session.commitTransform()
        #expect(session.activeLayer?.effects == original.layers[0].effects)
    }

    @Test func canvasAndImageResizePreserveHDRAndEXRBytes() async throws {
        let session = try session()
        let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures")
        let bytes = try Data(contentsOf: fixtures.appendingPathComponent("HDR-ACEScg.tif")), exr = try Data(contentsOf: fixtures.appendingPathComponent("Deep-tiled.exr"))
        let id = try #require(session.document?.layers[2].id)
        session.document?.layers[2].editableFilters = nil
        let context = try BrushRaster.context(width: 2, height: 2, mask: false), cache = try #require(context.makeImage())
        session.document?.layers[2].asset = ImportedImage(image: cache, thumbnail: cache, name: "HDR")
        session.document?.layers[2].hdrSource = LayerHDRSource(data: bytes,
            filters: [StoredLayerFilter(id: UUID(), enabled: false, adjustment: LayerAdjustment(kind: .exposure))],
            exrData: exr, exrView: StoredEXRView(part: 0, group: "", levelX: 0, levelY: 0))
        session.document?.hdrView = HDRPreview(exposure: 1, toneMap: "Reinhard", displayMode: "Auto")
        session.document?.hdrWorkingSpace = "ACEScg"
        let source = try #require(session.projectSnapshot())
        let enlarged = try await CanvasResizer.shared.resize(source, to: CanvasSizeOptions(width: 48, height: 32))
        session.applyDocumentSize(enlarged, actionName: "Canvas Size")
        #expect(session.projectSnapshot()?.exrSources[id] == exr)
        #expect(session.document?.hdrWorkingSpace == "ACEScg")
        let scaled = try await ImageResizer.shared.resize(source, to: ImageSizeOptions(width: 64, height: 32, resolution: 72))
        session.applyImageSize(scaled)
        #expect(session.projectSnapshot()?.hdrSources[id] == bytes)
        #expect(session.projectSnapshot()?.exrSources[id] == exr)
        #expect(session.document?.hdrView == source.manifest.hdrView)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Resized-\(UUID()).comp")
        defer { try? FileManager.default.removeItem(at: url) }
        try await ProjectStore.shared.save(try #require(session.projectSnapshot()), to: url)
        let reopened = try await ProjectStore.shared.load(from: url)
        #expect(reopened.hdrSources[id] == bytes)
        #expect(reopened.exrSources[id] == exr)
    }

    @Test func clipboardCreatesAnotherTabAtImageDimensions() async throws {
        let workspace = ProjectWorkspace(), oldTab = workspace.current
        oldTab.session.createDocument(width: 20, height: 10, emptyLayer: true)
        let original = oldTab.session.document, pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        let fixture = try ImageImportTests().fixture(.png)
        defer { try? FileManager.default.removeItem(at: fixture) }
        pasteboard.setData(try Data(contentsOf: fixture), forType: .png)
        await oldTab.controller.newFromClipboard(pasteboard)
        #expect(workspace.tabs.count == 2)
        #expect(workspace.current.session.document?.width == 64)
        #expect(workspace.current.session.document?.height == 32)
        #expect(workspace.current.session.activeLayer?.asset?.image.width == 64)
        #expect(oldTab.session.document == original)
    }
}
