import Foundation

nonisolated enum OpenEXRSourceStore {
    static func inspect(_ data: Data) throws {
        try data.withUnsafeBytes { (bytes: UnsafeRawBufferPointer) in
            func require(_ value: Bool) throws { if !value { throw ProjectError.invalid } }
            func u32(_ at: Int) throws -> UInt32 { try require(at >= 0 && at + 4 <= bytes.count); return UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24 }
            try require(bytes.count >= 16 && bytes.count <= 256 * 1024 * 1024)
            let signature = try u32(0), flags = try u32(4)
            try require(signature == 20_000_630 && flags & 255 == 2 && flags & ~UInt32(0x1e02) == 0)
            let multipart = flags & 0x1000 != 0, maximum = flags & 0x400 != 0 ? 255 : 31
            var at = 8, parts = 0
            func string() throws -> String { let start = at; while at < bytes.count && bytes[at] != 0 { at += 1 }; try require(at < bytes.count && at - start <= maximum); guard let value = String(bytes: bytes[start..<at], encoding: .utf8) else { throw ProjectError.invalid }; at += 1; return value }
            repeat {
                try require(parts < 64); var names = Set<String>(), windows = Set<String>()
                while at < bytes.count && bytes[at] != 0 {
                    try require(at < 4 * 1024 * 1024 && names.count < 256)
                    let name = try string(), type = try string(), length = Int(try u32(at)); at += 4
                    try require(!type.isEmpty && names.insert(name).inserted && length <= 1024 * 1024 && at + length <= min(bytes.count, 4 * 1024 * 1024))
                    if name == "dataWindow" || name == "displayWindow" { try require(type == "box2i" && length == 16); let x = Int(Int32(bitPattern: try u32(at))), y = Int(Int32(bitPattern: try u32(at + 4))), width = Int(Int32(bitPattern: try u32(at + 8))) - x + 1, height = Int(Int32(bitPattern: try u32(at + 12))) - y + 1; try require(width > 0 && height > 0 && width <= 30_000 && height <= 30_000 && width * height <= 16_000_000); windows.insert(name) }
                    at += length
                }
                try require(at < bytes.count && windows.count == 2 && names.contains("channels")); at += 1; parts += 1
            } while multipart && at < bytes.count && bytes[at] != 0
            if multipart { try require(at < bytes.count && bytes[at] == 0); at += 1 }; try require(at + 8 <= bytes.count)
        }
    }
}
