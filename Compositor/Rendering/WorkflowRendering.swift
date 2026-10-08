import Foundation
import CoreGraphics

nonisolated struct WorkflowLookup: Codable, Equatable, Sendable {
    var size: Int
    var dimension: Int
    var minimum: [Double]
    var maximum: [Double]
    var values: [Float]

    static func parse(_ data: Data) throws -> WorkflowLookup {
        guard data.count <= 32 * 1024 * 1024, let text = String(data: data, encoding: .utf8) else { throw ProjectError.invalid }
        var size = 0, dimension = 0, minimum = [0.0, 0, 0], maximum = [1.0, 1, 1], values: [Float] = []
        for line in text.replacingOccurrences(of: "\u{FEFF}", with: "").split(whereSeparator: \.isNewline) {
            let words = String(line).components(separatedBy: "#").first?.split(whereSeparator: \.isWhitespace) ?? []
            guard let name = words.first else { continue }
            if name == "TITLE" { continue }
            if name == "LUT_3D_SIZE" || name == "LUT_1D_SIZE" {
                guard size == 0, words.count == 2, let n = Int(words[1]), n >= 2 else { throw ProjectError.invalid }
                dimension = name == "LUT_3D_SIZE" ? 3 : 1; size = n
                guard n <= (dimension == 3 ? 65 : 65536) else { throw ProjectError.tooLarge }
            } else if name == "DOMAIN_MIN" || name == "DOMAIN_MAX" {
                let row = words.dropFirst().compactMap { Double($0) }; guard row.count == 3, row.allSatisfy(\.isFinite) else { throw ProjectError.invalid }
                if name == "DOMAIN_MIN" { minimum = row } else { maximum = row }
            } else {
                let row = words.compactMap { Float($0) }; guard row.count == 3, row.allSatisfy({ $0.isFinite && abs($0) <= 1000000 }) else { throw ProjectError.invalid }
                values.append(contentsOf: row); guard values.count <= 65 * 65 * 65 * 3 else { throw ProjectError.tooLarge }
            }
        }
        guard size >= 2, values.count == (dimension == 3 ? size * size * size : size) * 3,
              (0..<3).allSatisfy({ minimum[$0] < maximum[$0] }) else { throw ProjectError.invalid }
        return WorkflowLookup(size: size, dimension: dimension, minimum: minimum, maximum: maximum, values: values)
    }
    func color(_ input: [Double]) -> [Double] {
        var coordinates = [Double](); coordinates.reserveCapacity(3)
        for c in 0..<3 { let normalized = (input[c] - minimum[c]) / (maximum[c] - minimum[c]); coordinates.append(max(0, min(1, normalized)) * Double(size - 1)) }
        if dimension == 1 {
            var result = [Double](); result.reserveCapacity(3)
            for c in 0..<3 { let low = Int(coordinates[c]); let high = min(size - 1, low + 1); let amount = coordinates[c] - Double(low); let value = Double(values[low * 3 + c]) * (1 - amount) + Double(values[high * 3 + c]) * amount; result.append(value) }
            return result
        }
        let low = coordinates.map { Int($0) }; let fractions = (0..<3).map { coordinates[$0] - Double(low[$0]) }; var result = [0.0, 0, 0]
        for b in 0...1 { for g in 0...1 { for r in 0...1 {
            let blue = min(size - 1, low[2] + b); let green = min(size - 1, low[1] + g); let red = min(size - 1, low[0] + r); let at = (blue * size + green) * size * 3 + red * 3
            let weight = (r == 1 ? fractions[0] : 1 - fractions[0]) * (g == 1 ? fractions[1] : 1 - fractions[1]) * (b == 1 ? fractions[2] : 1 - fractions[2])
            for c in 0..<3 { result[c] += Double(values[at + c]) * weight }
        } } }
        return result
    }
    func apply(_ image: CGImage) throws -> CGImage {
        let context = try BrushRaster.context(width: image.width, height: image.height, mask: false)
        context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        guard let pixels = context.data?.assumingMemoryBound(to: UInt8.self) else { throw ExportError.render }
        for y in 0..<image.height { for x in 0..<image.width {
            let at = y * context.bytesPerRow + x * 4, alpha = Double(pixels[at + 3]); if alpha == 0 { continue }
            let input = (0..<3).map { min(1, Double(pixels[at + $0]) / alpha) }, result = color(input)
            for c in 0..<3 { pixels[at + c] = UInt8(max(0, min(alpha, (result[c] * alpha).rounded()))) }
        } }
        guard let result = context.makeImage() else { throw ExportError.render }; return result
    }
}

nonisolated enum WorkflowRendering {
    static func adjustment(_ workflow: [String: WorkflowValue]?, resources: [String: Data]) -> LayerAdjustment? {
        guard let workflow, case .string(let type) = workflow["type"] else { return nil }
        if type == "lut", case .string(let file) = workflow["file"], let data = resources[file], let lookup = try? WorkflowLookup.parse(data) {
            var adjustment = LayerAdjustment(kind: .curves); adjustment.workflowLookup = lookup; return adjustment
        }
        if type == "live-filter", let settings = workflow["adjustment"], let data = try? JSONEncoder().encode(settings) { return try? JSONDecoder().decode(LayerAdjustment.self, from: data) }
        return nil
    }
    static func persistsAdjustment(_ workflow: [String: WorkflowValue]?) -> Bool {
        guard case .string(let type) = workflow?["type"] else { return true }; return type != "lut" && type != "live-filter"
    }
}
