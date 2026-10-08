import CoreGraphics
import Foundation

nonisolated enum EditableFilterError: LocalizedError {
    case highPrecisionResize
    var errorDescription: String? { "High-precision image resizing is available in the shared Windows and mobile editor. Rasterize its preview first to resize it as an 8-bit image here." }
}

nonisolated struct LayerFilterState: Equatable, @unchecked Sendable {
    let source: ImportedImage
    let rendered: CGImage
    var entries: [StoredLayerFilter]
    var workingSpace: String? = nil
    var masks: [UUID: ImportedImage] = [:]

    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.source.image === rhs.source.image && lhs.rendered === rhs.rendered && lhs.entries == rhs.entries && lhs.workingSpace == rhs.workingSpace
            && Set(lhs.masks.keys) == Set(rhs.masks.keys) && lhs.masks.allSatisfy { rhs.masks[$0.key]?.image === $0.value.image }
    }
}

extension ImageLayer {
    /// Pixel edits bake the displayed result. History still retains the earlier source and parameters.
    var liveFilters: LayerFilterState? {
        guard let filters = editableFilters, filters.rendered === asset?.image else { return nil }
        return filters
    }
}

nonisolated enum EditableFilterRenderer {
    static func render(_ source: CGImage, filters: [StoredLayerFilter], masks: [UUID: ImportedImage] = [:]) throws -> CGImage {
        var image = source
        for filter in filters where filter.enabled {
            try Task.checkCancellation()
            guard filter.adjustment.isValid else { throw ProjectError.invalid }
            let opacity = filter.opacity ?? 1
            guard opacity.isFinite, (0...1).contains(opacity) else { throw ProjectError.invalid }
            if opacity == 0 { continue }
            let adjusted = try filter.adjustment.apply(image)
            if filter.maskFile != nil || opacity != 1 {
                let mask = filter.maskEnabled == false ? nil : masks[filter.id]?.image
                if filter.maskFile != nil && filter.maskEnabled != false && mask == nil { throw ProjectError.missingImage }
                image = try mix(image, adjusted, mask: mask, opacity: opacity)
            } else { image = adjusted }
        }
        return image
    }

    private static func mix(_ before: CGImage, _ after: CGImage, mask: CGImage?, opacity: Double) throws -> CGImage {
        let width = before.width, height = before.height, rect = CGRect(x: 0, y: 0, width: width, height: height)
        guard after.width == width, after.height == height,
              let space = CGColorSpace(name: CGColorSpace.sRGB),
              let a = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
              let b = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: width * 4, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue),
              let first = a.data?.assumingMemoryBound(to: UInt8.self), let second = b.data?.assumingMemoryBound(to: UInt8.self) else { throw ProjectError.encode }
        a.draw(before, in: rect); b.draw(after, in: rect)
        var coverage: [UInt8] = []
        if let mask {
            guard LayerMask.isValid(mask), mask.bitsPerPixel == 8, let data = mask.dataProvider?.data,
                  CFDataGetLength(data) >= mask.bytesPerRow * mask.height, let values = CFDataGetBytePtr(data) else { throw ProjectError.invalid }
            // Coverage is numeric data; color-profile conversion must not change its gray values.
            coverage = Array(UnsafeBufferPointer(start: values, count: CFDataGetLength(data)))
        }
        for pixel in 0..<(width * height) {
            if pixel % 65536 == 0 { try Task.checkCancellation() }
            var value = 255.0
            if let mask {
                let x = max(0, min(Double(mask.width - 1), (Double(pixel % width) + 0.5) * Double(mask.width) / Double(width) - 0.5))
                let y = max(0, min(Double(mask.height - 1), (Double(pixel / width) + 0.5) * Double(mask.height) / Double(height) - 0.5))
                let x0 = Int(x), y0 = Int(y), x1 = min(mask.width - 1, x0 + 1), y1 = min(mask.height - 1, y0 + 1), fx = x - Double(x0), fy = y - Double(y0)
                value = (Double(coverage[y0 * mask.bytesPerRow + x0]) * (1 - fx) + Double(coverage[y0 * mask.bytesPerRow + x1]) * fx) * (1 - fy)
                    + (Double(coverage[y1 * mask.bytesPerRow + x0]) * (1 - fx) + Double(coverage[y1 * mask.bytesPerRow + x1]) * fx) * fy
            }
            let amount = opacity * value / 255
            for channel in 0..<4 { let i = pixel * 4 + channel; second[i] = UInt8(max(0, min(255, (Double(first[i]) * (1 - amount) + Double(second[i]) * amount).rounded()))) }
        }
        guard let result = b.makeImage() else { throw ProjectError.encode }; return result
    }
}

actor EditableFilterWorker {
    static let shared = EditableFilterWorker()
    func render(_ source: ImportedImage, filters: [StoredLayerFilter], masks: [UUID: ImportedImage] = [:]) throws -> ImportedImage {
        let image = try EditableFilterRenderer.render(source.image, filters: filters, masks: masks)
        return ImportedImage(image: image, thumbnail: try PixelAdjust.thumbnail(of: image), name: source.name)
    }
}

extension ProjectSnapshot {
    nonisolated func filterState(for record: ProjectLayerRecord) -> LayerFilterState? {
        guard let entries = record.filters, let source = filterSources[record.id], let rendered = images[record.id]?.image else { return nil }
        let masks = Dictionary(uniqueKeysWithValues: entries.compactMap { entry -> (UUID, ImportedImage)? in guard let name = entry.maskFile, let mask = filterMasks[name] else { return nil }; return (entry.id, mask) })
        return LayerFilterState(source: source, rendered: rendered, entries: entries, workingSpace: record.filterWorkingSpace, masks: masks)
    }
}
