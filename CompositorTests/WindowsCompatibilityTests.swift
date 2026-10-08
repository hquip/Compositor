import Foundation
import Testing
import CoreGraphics
import ImageIO
@testable import Compositor

@MainActor
struct WindowsCompatibilityTests {
    @Test func windowsProjectLoadsRendersAndRoundTrips() async throws {
        let fixture = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("Fixtures/WindowsRoundTrip.comp", isDirectory: true)
        let snapshot = try await ProjectStore.shared.load(from: fixture)
        #expect(snapshot.manifest.version >= 11 && ProjectManifest.supported.contains(snapshot.manifest.version))
        #expect(snapshot.manifest.layers.filter { $0.adjustment != nil }.count == 12)
        #expect(snapshot.manifest.layers.contains { $0.text?.fontRuns != nil })
        #expect(snapshot.manifest.layers.contains { $0.effects?.innerGlow != nil })
        #expect(snapshot.masks.count == 1)
        let raster = try await ImageExporter.shared.render(snapshot)
        #expect(raster.image.width == snapshot.manifest.width)
        #expect(raster.image.height == snapshot.manifest.height)
        let output = fixture.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("CrossPlatformResults", isDirectory: true)
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let saved = output.appendingPathComponent("MacRoundTrip.comp", isDirectory: true)
        try await ProjectStore.shared.save(snapshot, to: saved)
        let reopened = try await ProjectStore.shared.load(from: saved)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        #expect(try encoder.encode(snapshot.manifest) == encoder.encode(reopened.manifest))
        let destination = try #require(CGImageDestinationCreateWithURL(output.appendingPathComponent("MacRoundTrip-preview.png") as CFURL, "public.png" as CFString, 1, nil))
        CGImageDestinationAddImage(destination, raster.image, nil)
        #expect(CGImageDestinationFinalize(destination))
        let previewURL = fixture.deletingLastPathComponent().appendingPathComponent("WindowsRoundTrip-preview.png")
        let source = try #require(CGImageSourceCreateWithURL(previewURL as CFURL, nil))
        let expected = try #require(CGImageSourceCreateImageAtIndex(source, 0, nil))
        try #require(expected.width == raster.image.width && expected.height == raster.image.height)
        func pixels(_ image: CGImage) throws -> [UInt8] {
            var result = [UInt8](repeating: 0, count: image.width * image.height * 4)
            try result.withUnsafeMutableBytes { bytes in
                let context = try #require(CGContext(data: bytes.baseAddress, width: image.width, height: image.height,
                    bitsPerComponent: 8, bytesPerRow: image.width * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue))
                context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
            }
            return result
        }
        let actualPixels = try pixels(raster.image), expectedPixels = try pixels(expected)
        let differences = zip(actualPixels, expectedPixels).map { abs(Int($0) - Int($1)) }
        let maximum = differences.max() ?? 0
        let mean = Double(differences.reduce(0, +)) / Double(differences.count)
        let metrics: [String: Double] = ["maximumChannelDifference": Double(maximum), "meanChannelDifference": mean]
        try encoder.encode(metrics).write(to: output.appendingPathComponent("render-difference.json"))
        // Distinct raster backends can round edges differently. Larger deviations need investigation.
        #expect(maximum <= 20)
        #expect(mean <= 3)
    }
}
