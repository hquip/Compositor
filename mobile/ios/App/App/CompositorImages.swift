import Capacitor
import CoreImage
import ImageIO
import UniformTypeIdentifiers

@objc(CompositorImages)
public class CompositorImages: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CompositorImages"
    public let jsName = "CompositorImages"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "developRaw", returnType: CAPPluginReturnPromise)]
    private let context = CIContext(options: [.workingColorSpace: CGColorSpace(name: CGColorSpace.sRGB)!])

    @objc func developRaw(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), encoded.count <= 180_000_000,
              let data = Data(base64Encoded: encoded) else { call.reject("Invalid RAW image."); return }
        let settings = call.getObject("settings")
        let requestedExtension = call.getString("extension") ?? "raw"
        let fileExtension = requestedExtension.range(of: "^[A-Za-z0-9]{1,8}$", options: .regularExpression) != nil ? requestedExtension : "raw"
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            autoreleasepool {
                let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(fileExtension)
                defer { try? FileManager.default.removeItem(at: file) }
                do {
                    try data.write(to: file, options: .atomic)
                    guard let filter = CIRAWFilter(imageURL: file) else { call.reject("This camera RAW format is not supported by iOS."); return }
                    let size = filter.nativeSize
                    guard size.width > 0, size.height > 0, size.width <= 8192, size.height <= 8192,
                          size.width * size.height <= 16_000_000 else { call.reject("This project exceeds the mobile memory budget."); return }
                    guard let settings else {
                        call.resolve(["temperature": filter.neutralTemperature, "tint": filter.neutralTint, "width": size.width, "height": size.height]); return
                    }
                    let number: (String, Double) -> Float = { key, fallback in Float((settings[key] as? NSNumber)?.doubleValue ?? fallback) }
                    filter.exposure = number("exposure", 0)
                    let camera = settings["cameraWhiteBalance"] as? Bool ?? true
                    filter.neutralTemperature = max(2000, min(50000, (camera ? filter.neutralTemperature : 6500) + number("temperature", 0) * 40))
                    filter.neutralTint = max(-150, min(150, (camera ? filter.neutralTint : 0) + number("tint", 0)))
                    filter.boostAmount = number("boost", 1)
                    guard let output = filter.outputImage,
                          let image = context.createCGImage(output, from: output.extent, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!) else { call.reject("RAW decoding did not return an image."); return }
                    let png = NSMutableData()
                    guard let destination = CGImageDestinationCreateWithData(png, UTType.png.identifier as CFString, 1, nil) else { call.reject("Could not encode the image."); return }
                    CGImageDestinationAddImage(destination, image, nil)
                    guard CGImageDestinationFinalize(destination) else { call.reject("Could not encode the image."); return }
                    call.resolve(["data": "data:image/png;base64," + (png as Data).base64EncodedString()])
                } catch { call.reject(error.localizedDescription) }
            }
        }
    }
}
