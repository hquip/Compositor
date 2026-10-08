import Foundation

nonisolated enum HDRSourceStore {
    static func inspect(_ data: Data, wide: Bool = false) throws -> Int {
        try data.withUnsafeBytes { raw in
            func require(_ value: Bool) throws { if !value { throw ProjectError.invalid } }
            func u16(_ at: Int) throws -> Int { try require(at >= 0 && at + 2 <= raw.count); return Int(raw[at]) | Int(raw[at + 1]) << 8 }
            func u32(_ at: Int) throws -> Int { try require(at >= 0 && at + 4 <= raw.count); return Int(raw[at]) | Int(raw[at + 1]) << 8 | Int(raw[at + 2]) << 16 | Int(raw[at + 3]) << 24 }
            try require(raw.count >= 8 && raw.count <= 512 * 1024 * 1024 && raw[0] == 73 && raw[1] == 73)
            try require(try u16(2) == 42)
            let start = try u32(4), count = try u16(start), end = start + 2 + count * 12
            try require(start >= 8 && count <= 1000 && end + 4 <= raw.count)
            try require(try u32(end) == 0)
            var tags: [Int: [Int]] = [:], description: String?
            for i in 0..<count {
                let at = start + 2 + i * 12, id = try u16(at), type = try u16(at + 2), length = try u32(at + 4)
                let size = [1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1][type] ?? 0
                try require(size > 0 && length <= 16_000_000)
                let offset = try (length * size <= 4 ? at + 8 : u32(at + 8))
                try require(offset >= 0 && offset + length * size <= raw.count)
                if type == 3 || type == 4 { try require(tags[id] == nil); tags[id] = try (0..<length).map { type == 3 ? try u16(offset + $0 * 2) : try u32(offset + $0 * 4) } }
                if id == 270 { try require(type == 2); description = String(bytes: raw[offset..<(offset + length)], encoding: .utf8) }
            }
            func scalar(_ id: Int) throws -> Int { guard let values = tags[id], values.count == 1 else { throw ProjectError.invalid }; return values[0] }
            let width = try scalar(256), height = try scalar(257), pixels = width * height
            try require(width > 0 && height > 0 && width <= 30_000 && height <= 30_000 && pixels <= 16_000_000)
            try require(try scalar(259) == 1 && scalar(262) == 2 && scalar(277) == 4 && scalar(278) == height && scalar(284) == 1 && scalar(338) == 2)
            let spaces = wide ? HDRColorSpace.names : ["Linear sRGB"]
            try require(spaces.contains { description == HDRColorSpace.description($0) } && tags[258] == [32, 32, 32, 32] && tags[339] == [3, 3, 3, 3])
            let offset = try scalar(273), length = try scalar(279)
            try require(offset >= end + 4 && length == pixels * 16 && offset + length <= raw.count)
            for i in 0..<(pixels * 4) { let value = Float(bitPattern: UInt32(try u32(offset + i * 4))); try require(value.isFinite && (i % 4 == 3 ? (0...1).contains(value) : abs(value) <= 1_000_000)) }
            return pixels * 4
        }
    }
}
