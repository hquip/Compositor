import Foundation

nonisolated struct LayerTextSizeRun: Codable, Equatable, Sendable {
    var location: Int
    var length: Int
    var fontSize: CGFloat
}
