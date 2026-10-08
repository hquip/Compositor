import Foundation
import CoreGraphics

nonisolated struct StoredSmartObject: Codable, Equatable, Sendable {
    var id: UUID
    var width: Int
    var height: Int
    var baseTransform: LayerTransform
    var isValid: Bool { width > 0 && height > 0 && width <= 30_000 && height <= 30_000 && width * height <= 200_000_000 && baseTransform.isValid }
}
nonisolated struct HDRPreview: Codable, Equatable, Sendable {
    var exposure: Double
    var toneMap: String
    var displayMode: String? = nil
    var isValid: Bool { exposure.isFinite && (-20...20).contains(exposure) && ["Reinhard", "Clip"].contains(toneMap) && (displayMode == nil || ["Auto", "HDR", "SDR"].contains(displayMode!)) }
}
nonisolated enum HDRColorSpace {
    static let names = ["Linear sRGB", "Linear Rec.2020", "Linear P3-D65", "ACEScg", "ACES2065-1"]
    static func description(_ name: String) -> String { "Compositor \(name == "Linear sRGB" ? "linear sRGB" : name) float32\0" }
}
nonisolated struct StoredEXRView: Codable, Equatable, Sendable {
    var part: Int
    var group: String
    var levelX: Int
    var levelY: Int
    var depthRange: [Double]? = nil
    var encoding: String? = nil
    var isValid: Bool { (encoding == nil || (HDRColorSpace.names + ["File color metadata"]).contains(encoding!)) && (0..<64).contains(part) && group.utf8.count <= 255 && group.unicodeScalars.allSatisfy { $0.value >= 32 } && (0...30).contains(levelX) && (0...30).contains(levelY) && (depthRange == nil || depthRange!.count == 2 && depthRange!.allSatisfy { $0.isFinite && abs($0) <= 1e12 } && depthRange![0] <= depthRange![1]) }
}
nonisolated struct LayerHDRSource: Equatable, @unchecked Sendable {
    var data: Data
    var filters: [StoredLayerFilter]
    var masks: [UUID: ImportedImage] = [:]
    var exrData: Data? = nil
    var exrView: StoredEXRView? = nil
    static func == (lhs: Self, rhs: Self) -> Bool {
        lhs.data == rhs.data && lhs.filters == rhs.filters && lhs.exrData == rhs.exrData && lhs.exrView == rhs.exrView && Set(lhs.masks.keys) == Set(rhs.masks.keys)
            && lhs.masks.allSatisfy { rhs.masks[$0.key]?.image === $0.value.image }
    }
}
extension ProjectSnapshot {
    nonisolated func hdrState(for record: ProjectLayerRecord) -> LayerHDRSource? {
        guard let data = hdrSources[record.id], let filters = record.filters else { return nil }
        let masks = Dictionary(uniqueKeysWithValues: filters.compactMap { entry -> (UUID, ImportedImage)? in guard let name = entry.maskFile, let image = filterMasks[name] else { return nil }; return (entry.id, image) })
        return LayerHDRSource(data: data, filters: filters, masks: masks, exrData: exrSources[record.id], exrView: record.exrView)
    }
}
