import Foundation
import CoreGraphics

nonisolated struct ImageSizeOptions: Sendable {
    var width: Int
    var height: Int
    var resolution: Double
    var sampling: LayerSampling = .high
}

nonisolated enum ImageResizeError: LocalizedError {
    case editableShear
    var errorDescription: String? {
        "Uneven resizing of a rotated editable layer would require shear. Use proportional resizing or rasterize that layer first."
    }
}

actor ImageResizer {
    static let shared = ImageResizer()

    func resize(_ snapshot: ProjectSnapshot, to options: ImageSizeOptions) throws -> ProjectSnapshot {
        guard (1...DocumentLimits.maxSide).contains(options.width), (1...DocumentLimits.maxSide).contains(options.height),
              options.resolution.isFinite, (1...9600).contains(options.resolution) else { throw ProjectError.tooLarge }
        let old = snapshot.manifest
        var manifest = ProjectManifest(resolution: options.resolution, documentID: old.documentID,
            width: options.width, height: options.height, activeLayerID: old.activeLayerID, layers: [],
            guides: old.guides, hdrView: old.hdrView, hdrWorkingSpace: old.hdrWorkingSpace)
        if old.width == options.width && old.height == options.height {
            manifest.layers = old.layers
            return ProjectSnapshot(manifest: manifest, images: snapshot.images, masks: snapshot.masks, filterSources: snapshot.filterSources, filterMasks: snapshot.filterMasks, hdrSources: snapshot.hdrSources, exrSources: snapshot.exrSources)
        }
        guard options.width * options.height <= DocumentLimits.maxSurfacePixels else { throw ProjectError.tooLarge }
        let sx = CGFloat(options.width) / CGFloat(old.width)
        let sy = CGFloat(options.height) / CGFloat(old.height)
        manifest.guides = old.guides?.map { $0.scaled(x: sx, y: sy) }
        var images: [UUID: ImportedImage] = [:]
        var masks: [UUID: ImportedImage] = [:]
        var usedPixels = 0, usedMaskPixels = 0
        for layer in old.layers {
            try Task.checkCancellation()
            if layer.text != nil || layer.shape != nil || layer.vectorPath != nil || layer.filterSourceFile != nil || layer.hdrSourceFile != nil || layer.smartObject != nil {
                let scale = CGAffineTransform(scaleX: sx, y: sy)
                func scaled(_ original: LayerTransform) throws -> LayerTransform {
                    let map = original.unitToDocument.concatenating(scale)
                    let lengths = hypot(map.a, map.b) * hypot(map.c, map.d)
                    guard abs(map.a * map.c + map.b * map.d) <= lengths * 1e-8 else { throw ImageResizeError.editableShear }
                    var result = original.placing(map)
                    result.sampling = options.sampling
                    guard result.isValid else { throw ProjectError.tooLarge }
                    return result
                }
                var record = layer
                record.transform = try scaled(layer.transform)
                record.maskPlacement = try layer.maskPlacement.map { try scaled($0) }
                if var object = record.smartObject { object.baseTransform = try scaled(object.baseTransform); record.smartObject = object }
                if let source = snapshot.images[layer.id] {
                    usedPixels += source.image.width * source.image.height
                    guard usedPixels <= DocumentLimits.documentPixelBudget else { throw ProjectError.tooLarge }
                    images[layer.id] = source
                }
                if let mask = snapshot.masks[layer.id] {
                    usedMaskPixels += mask.image.width * mask.image.height
                    guard usedMaskPixels <= DocumentLimits.documentPixelBudget else { throw ProjectError.tooLarge }
                    masks[layer.id] = mask
                }
                manifest.layers.append(record)
                continue
            }
            // Rasterize each transformed layer independently. Nonuniform scaling of a
            // rotated rectangle can introduce shear, which width/height/angle cannot represent.
            let corners = [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0), CGPoint(x: 1, y: 1), CGPoint(x: 0, y: 1)]
                .map { layer.transform.point($0) }.map { CGPoint(x: $0.x * sx, y: $0.y * sy) }
            let left = floor(corners.map(\.x).min()!), top = floor(corners.map(\.y).min()!)
            let width = Int(ceil(corners.map(\.x).max()!) - left)
            let height = Int(ceil(corners.map(\.y).max()!) - top)
            let transform = LayerTransform(origin: CGPoint(x: left, y: top),
                size: CGSize(width: width, height: height), sampling: options.sampling)
            guard transform.isValid else { throw ProjectError.tooLarge }
            if layer.imageFile != nil {
                guard (1...DocumentLimits.maxSide).contains(width), (1...DocumentLimits.maxSide).contains(height),
                      width * height <= DocumentLimits.documentPixelBudget - usedPixels else { throw ProjectError.tooLarge }
                usedPixels += width * height
                guard let source = snapshot.images[layer.id] else { throw ProjectError.missingImage }
                let asset = try autoreleasepool {
                    guard let context = CGContext(data: nil, width: width, height: height,
                        bitsPerComponent: 8, bytesPerRow: width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw ExportError.render }
                    context.translateBy(x: 0, y: CGFloat(height))
                    context.scaleBy(x: 1, y: -1)
                    context.translateBy(x: -left, y: -top)
                    context.scaleBy(x: sx, y: sy)
                    var sourceTransform = layer.transform
                    sourceTransform.sampling = options.sampling
                    LayerRenderer.draw(source.image, transform: sourceTransform, center: sourceTransform.center, in: context)
                    guard let image = context.makeImage() else { throw ExportError.render }
                    let factor = min(1, 96 / CGFloat(max(width, height)))
                    let tw = max(1, Int(CGFloat(width) * factor)), th = max(1, Int(CGFloat(height) * factor))
                    guard let thumb = CGContext(data: nil, width: tw, height: th, bitsPerComponent: 8,
                        bytesPerRow: tw * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { throw ExportError.render }
                    thumb.interpolationQuality = .high
                    thumb.draw(image, in: CGRect(x: 0, y: 0, width: tw, height: th))
                    guard let thumbnail = thumb.makeImage() else { throw ExportError.render }
                    return ImportedImage(image: image, thumbnail: thumbnail, name: source.name)
                }
                images[layer.id] = asset
            }
            if layer.maskFile != nil {
                guard let source = snapshot.masks[layer.id] else { throw ProjectError.missingImage }
                // Uniform masks are resolution independent; avoid allocating a full canvas for reveal/hide-all.
                // A mask on its own placement keeps its pixels; the placement scales with the canvas.
                if (source.image.width == 1 && source.image.height == 1) || layer.maskPlacement != nil { masks[layer.id] = source }
                else {
                    guard (1...DocumentLimits.maxSide).contains(width), (1...DocumentLimits.maxSide).contains(height),
                          width * height <= DocumentLimits.documentPixelBudget - usedMaskPixels else { throw ProjectError.tooLarge }
                    usedMaskPixels += width * height
                    guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: width, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { throw ExportError.render }
                    context.translateBy(x: 0, y: CGFloat(height))
                    context.scaleBy(x: 1, y: -1)
                    context.translateBy(x: -left, y: -top)
                    context.scaleBy(x: sx, y: sy)
                    var sourceTransform = layer.transform
                    sourceTransform.sampling = options.sampling
                    LayerRenderer.drawCoverage(source.image, transform: sourceTransform, in: context)
                    guard let image = context.makeImage() else { throw ExportError.render }
                    masks[layer.id] = try LayerMask.asset(from: image)
                }
            }
            var record = layer
            record.transform = transform
            record.maskPlacement = layer.maskPlacement.map { $0.placing($0.unitToDocument.concatenating(CGAffineTransform(scaleX: sx, y: sy))) }
            record.vectorMask = layer.maskPlacement == nil ? layer.vectorMask?.carried(from: layer.transform, to: transform, scaleX: sx, scaleY: sy) : layer.vectorMask
            manifest.layers.append(record)
        }
        return ProjectSnapshot(manifest: manifest, images: images, masks: masks, filterSources: snapshot.filterSources,
            filterMasks: snapshot.filterMasks, hdrSources: snapshot.hdrSources, exrSources: snapshot.exrSources)
    }
}

extension EditorSession {
    func applyImageSize(_ snapshot: ProjectSnapshot) {
        applyDocumentSize(snapshot, actionName: "Image Size")
    }

    func applyDocumentSize(_ snapshot: ProjectSnapshot, actionName: String) {
        guard document?.id == snapshot.manifest.documentID else { return }
        beginEdit(actionName)
        document = snapshot.makeCanvasDocument()
        activeLayerID = snapshot.manifest.activeLayerID
        endEdit()
        viewport.fit(documentSize: document!.size)
    }
}
