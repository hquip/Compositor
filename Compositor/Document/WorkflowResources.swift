import Foundation

nonisolated enum WorkflowValue: Codable, Equatable, Sendable {
    case null, bool(Bool), number(Double), string(String), array([WorkflowValue]), object([String: WorkflowValue])
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let value = try? c.decode(Bool.self) { self = .bool(value) }
        else if let value = try? c.decode(Double.self) { self = .number(value) }
        else if let value = try? c.decode(String.self) { self = .string(value) }
        else if let value = try? c.decode([WorkflowValue].self) { self = .array(value) }
        else { self = .object(try c.decode([String: WorkflowValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self { case .null: try c.encodeNil(); case .bool(let v): try c.encode(v); case .number(let v): try c.encode(v); case .string(let v): try c.encode(v); case .array(let v): try c.encode(v); case .object(let v): try c.encode(v) }
    }
    func isValid(depth: Int = 0) -> Bool {
        guard depth <= 64 else { return false }
        switch self {
        case .null, .bool: return true
        case .number(let value): return value.isFinite
        case .string(let value): return value.utf16.count <= 1000000
        case .array(let values): return values.count <= 10000 && values.allSatisfy { $0.isValid(depth: depth + 1) }
        case .object(let values): return values.count <= 10000 && values.allSatisfy { !["__proto__", "constructor", "prototype"].contains($0.key) && $0.value.isValid(depth: depth + 1) }
        }
    }
}

nonisolated struct WorkflowResource: Codable, Equatable, Sendable {
    var file: String
    var kind: String
    var isValid: Bool { file.hasSuffix(".resource.bin") && UUID(uuidString: String(file.dropLast(13))) != nil && ["icc", "channels", "lookup", "photoshop", "plugin"].contains(kind) }
    func inspect(_ data: Data) throws -> Int {
        guard isValid, !data.isEmpty, data.count <= 512 * 1024 * 1024 else { throw ProjectError.invalid }
        let bytes = [UInt8](data)
        if kind == "icc" { guard data.count >= 132, data.count <= 16 * 1024 * 1024, String(bytes: bytes[36..<40], encoding: .ascii) == "acsp" else { throw ProjectError.invalid } }
        if kind == "photoshop" { guard data.count >= 26, String(bytes: bytes[0..<4], encoding: .ascii) == "8BPS" else { throw ProjectError.invalid } }
        if kind == "lookup" { _ = try WorkflowLookup.parse(data) }
        guard kind == "channels" else { return 0 }
        guard data.count >= 32, String(bytes: bytes[0..<8], encoding: .ascii) == "CCHN0001" else { throw ProjectError.invalid }
        func u32(_ at: Int) -> UInt32 { UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24 }
        let width = Int(u32(8)), height = Int(u32(12)), mode = Int(u32(16)), bits = Int(u32(20)), channels = Int(u32(24))
        guard (1...30000).contains(width), (1...30000).contains(height), width * height <= 16000000,
              mode <= 2, [8, 16, 32].contains(bits), channels == (mode == 1 ? 5 : 4), data.count == 32 + width * height * channels * bits / 8 else { throw ProjectError.invalid }
        if bits == 32 {
            for i in 0..<(width * height * channels) { let value = Float(bitPattern: u32(32 + i * 4)); guard value.isFinite, abs(value) <= 1000000, i % channels != channels - 1 || (0...1).contains(value) else { throw ProjectError.invalid } }
        }
        return width * height * channels * bits / 32
    }
}
