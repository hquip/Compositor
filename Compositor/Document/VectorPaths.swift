import CoreGraphics
import Foundation

nonisolated struct VectorColor: Codable, Equatable, Sendable {
    var red: Double
    var green: Double
    var blue: Double
    var isValid: Bool { [red, green, blue].allSatisfy { $0.isFinite && (0...1).contains($0) } }
}

nonisolated struct VectorNode: Codable, Equatable, Sendable {
    var point: [Double]
    var incoming: [Double]? = nil
    var outgoing: [Double]? = nil
    var isValid: Bool {
        [point, incoming, outgoing].compactMap { $0 }.allSatisfy { $0.count == 2 && $0.allSatisfy { $0.isFinite && abs($0) <= 4 } }
    }
}

nonisolated struct VectorContour: Codable, Equatable, Sendable {
    var closed: Bool
    var nodes: [VectorNode]
}

nonisolated struct VectorPathStyle: Codable, Equatable, Sendable {
    var contours: [VectorContour]
    var fillRule: String
    var fill: VectorColor?
    var stroke: VectorColor?
    /// Fraction of the shorter side of the source box.
    var strokeWidth: Double

    func isValid(mask: Bool = false) -> Bool {
        guard ["evenodd", "nonzero"].contains(fillRule), (1...64).contains(contours.count),
              contours.reduce(0, { $0 + $1.nodes.count }) <= 4096,
              contours.allSatisfy({ $0.nodes.count >= ($0.closed ? 3 : 2) && (!mask || $0.closed) && $0.nodes.allSatisfy(\.isValid) }),
              fill?.isValid != false, stroke?.isValid != false, strokeWidth.isFinite, (0...1).contains(strokeWidth),
              fill != nil || stroke != nil && strokeWidth > 0 else { return false }
        return !mask || fill == VectorColor(red: 1, green: 1, blue: 1) && stroke == nil && strokeWidth == 0
    }

    func carried(from source: LayerTransform, to target: LayerTransform, scaleX: CGFloat, scaleY: CGFloat) -> Self {
        var result = self
        let inverse = target.unitToDocument.inverted()
        func point(_ value: [Double]) -> [Double] {
            let placed = source.point(CGPoint(x: value[0], y: value[1]))
            let local = CGPoint(x: placed.x * scaleX, y: placed.y * scaleY).applying(inverse)
            return [Double(local.x), Double(local.y)]
        }
        result.contours = contours.map { contour in
            VectorContour(closed: contour.closed, nodes: contour.nodes.map { node in
                VectorNode(point: point(node.point), incoming: node.incoming.map(point), outgoing: node.outgoing.map(point))
            })
        }
        result.strokeWidth *= Double(min(source.size.width * scaleX, source.size.height * scaleY) / min(target.size.width, target.size.height))
        return result
    }
}

/// The PNG remains the native display fallback. Pixel edits invalidate the geometry by image identity.
nonisolated struct LayerVectorPath: Equatable, @unchecked Sendable {
    var style: VectorPathStyle
    let image: CGImage
    static func == (lhs: Self, rhs: Self) -> Bool { lhs.style == rhs.style && lhs.image === rhs.image }
    static func loaded(_ style: VectorPathStyle?, image: CGImage?) -> Self? {
        guard let style, let image else { return nil }
        return Self(style: style, image: image)
    }
}

extension ImageLayer {
    var liveVectorPath: LayerVectorPath? { vectorPath?.image === asset?.image ? vectorPath : nil }
    var liveVectorMask: LayerVectorPath? { vectorMask?.image === mask?.asset.image ? vectorMask : nil }
}
