import Foundation

extension ProjectSnapshot {
    @MainActor func makeCanvasDocument() -> CanvasDocument {
        let m = manifest
        return CanvasDocument(id: m.documentID, width: m.width, height: m.height,
            layers: m.layers.map {
                ImageLayer(id: $0.id, asset: images[$0.id], name: $0.name,
                    isVisible: $0.isVisible, transform: $0.transform, parentID: $0.parentID, isGroup: $0.isGroup == true,
                    opacity: $0.opacity ?? 1, blendMode: $0.blendMode ?? .normal, mask: mask(for: $0),
                    maskSourceID: $0.maskSourceID, adjustment: $0.adjustment,
                    shape: LayerShape.loaded($0.shape, image: images[$0.id]?.image), effects: $0.effects,
                    text: LayerText.loaded($0.text, image: images[$0.id]?.image), editableFilters: filterState(for: $0),
                    vectorPath: LayerVectorPath.loaded($0.vectorPath, image: images[$0.id]?.image),
                    vectorMask: LayerVectorPath.loaded($0.vectorMask, image: masks[$0.id]?.image),
                    hdrSource: hdrState(for: $0), smartObject: $0.smartObject)
            }, resolution: m.resolution ?? 72, guides: m.guides ?? [], hdrView: m.hdrView, hdrWorkingSpace: m.hdrWorkingSpace)
    }
}

extension EditorSession {
    func projectSnapshot() -> ProjectSnapshot? {
        guard let document else { return nil }
        var images: [UUID: ImportedImage] = [:]
        var masks: [UUID: ImportedImage] = [:]
        var filterSources: [UUID: ImportedImage] = [:]
        var filterMasks: [String: ImportedImage] = [:]
        var hdrSources: [UUID: Data] = [:]
        var exrSources: [UUID: Data] = [:]
        let layers = document.layers.map { layer in
            if let asset = layer.asset { images[layer.id] = asset }
            if let mask = layer.mask { masks[layer.id] = mask.asset }
            if let filters = layer.liveFilters { filterSources[layer.id] = filters.source }
            if let hdr = layer.hdrSource { hdrSources[layer.id] = hdr.data; exrSources[layer.id] = hdr.exrData }
            let entries = (layer.hdrSource?.filters ?? layer.liveFilters?.entries)?.map { entry -> StoredLayerFilter in
                var copy = entry
                if let asset = layer.hdrSource?.masks[entry.id] ?? layer.liveFilters?.masks[entry.id], entry.maskFile != nil { copy.maskFile = "\(layer.id.uuidString).\(entry.id.uuidString).filter-mask.png"; filterMasks[copy.maskFile!] = asset }
                return copy
            }
            return ProjectLayerRecord(id: layer.id, name: layer.name, isVisible: layer.isVisible,
                transform: layer.transform, imageFile: layer.asset == nil ? nil : "\(layer.id.uuidString).png", parentID: layer.parentID, isGroup: layer.isGroup, opacity: layer.opacity, blendMode: layer.blendMode, maskFile: layer.mask == nil ? nil : "\(layer.id.uuidString).mask.png", maskEnabled: layer.mask?.isEnabled, maskSourceID: layer.maskSourceID, adjustment: layer.adjustment, maskPlacement: layer.mask?.placement, maskLinked: layer.mask?.isLinked, shape: layer.liveShape?.style, effects: layer.effects, text: layer.liveText?.style,
                filterSourceFile: layer.liveFilters == nil ? nil : "\(layer.id.uuidString).source.png", filters: entries, filterWorkingSpace: layer.liveFilters?.workingSpace, vectorPath: layer.liveVectorPath?.style, vectorMask: layer.liveVectorMask?.style, hdrSourceFile: layer.hdrSource == nil ? nil : "\(layer.id.uuidString).hdr-source.tif", exrSourceFile: layer.hdrSource?.exrData == nil ? nil : "\(layer.id.uuidString).exr-source.exr", exrView: layer.hdrSource?.exrView, smartObject: layer.smartObject)
        }
        return ProjectSnapshot(manifest: ProjectManifest(resolution: document.resolution, documentID: document.id, width: document.width,
            height: document.height, activeLayerID: activeLayerID, layers: layers,
            guides: document.guides.isEmpty ? nil : document.guides, hdrView: document.hdrView, hdrWorkingSpace: document.hdrWorkingSpace), images: images, masks: masks, filterSources: filterSources, filterMasks: filterMasks, hdrSources: hdrSources, exrSources: exrSources)
    }

    /// Called only after the entire package has successfully validated and loaded.
    func installProject(_ snapshot: ProjectSnapshot, from url: URL) {
        collapsedGroupIDs = []
        isMaskSelected = false
        cancelCrop()
        guideDrag = nil
        transformEdit = nil
        document = snapshot.makeCanvasDocument()
        activeLayerID = snapshot.manifest.activeLayerID
        projectURL = url
        renamingLayerID = nil
        history.reset()
        viewport.fit(documentSize: document!.size)
    }

    /// Replaces the document with what its package holds now, after something else wrote it. Unlike `installProject`
    /// it keeps the viewport, the collapsed folders and the selection where those layers still exist, so the
    /// reload is invisible beyond the change itself. Undo history is session-only and starts over, as after an open.
    func reloadProject(_ snapshot: ProjectSnapshot) {
        guard let url = projectURL else { return }
        let viewport = self.viewport
        let collapsed = collapsedGroupIDs
        let active = activeLayerID
        let selected = selectedLayerIDs
        installProject(snapshot, from: url)
        self.viewport = viewport
        let ids = Set(snapshot.manifest.layers.map(\.id))
        collapsedGroupIDs = collapsed.intersection(ids)
        if let active, ids.contains(active) {
            activeLayerID = active
            selectedLayerIDs = selected.intersection(ids).union([active])
        }
    }

    func clearProject() {
        collapsedGroupIDs = []
        isMaskSelected = false
        cancelCrop()
        transformEdit = nil
        guideDrag = nil
        document = nil
        activeLayerID = nil
        renamingLayerID = nil
        projectURL = nil
        history.reset()
    }

    func createNewProject(width: Int, height: Int) {
        guard !isProjectBusy, !isImporting, (1...DocumentLimits.maxSide).contains(width), (1...DocumentLimits.maxSide).contains(height) else { return }
        clearProject()
        createDocument(width: width, height: height, emptyLayer: true)
    }
}
