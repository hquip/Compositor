import AppKit
import SwiftUI

struct EditableFiltersSheet: View {
    @Bindable var session: EditorSession
    @Environment(\.dismiss) private var dismiss
    @State private var original: ImageLayer?
    @State private var entries: [StoredLayerFilter] = []
    @State private var kind: AdjustmentKind = .exposure
    @State private var message = ""
    @State private var processing = false
    @State private var task: Task<Void, Never>?
    @State private var preview: CGImage?
    private var source: ImportedImage? { original?.liveFilters?.source ?? original?.asset }
    private var highPrecision: Bool { original?.hdrSource != nil || original?.smartObject != nil || (source?.image.bitsPerComponent ?? 8) > 8 }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Editable filters").font(.title2)
            Text("Original pixels and filter settings stay with the project.").foregroundStyle(.secondary)
            if highPrecision {
                Text("This high-precision source is preserved. Use the shared Windows or mobile editor to change its high-precision filters.")
                    .font(.callout).fixedSize(horizontal: false, vertical: true)
                Button("Rasterize preview to 8 bit") {
                    guard let original, let index = session.document?.layers.firstIndex(where: { $0.id == original.id }) else { return }
                    session.beginEdit("Rasterize Filters")
                    session.document?.layers[index].editableFilters = nil
                    session.document?.layers[index].hdrSource = nil
                    session.document?.layers[index].smartObject = nil
                    session.endEdit(); dismiss()
                }
            }
            if let image = preview ?? original?.asset?.image { Image(decorative: image, scale: 1).resizable().scaledToFit().frame(maxHeight: 150) }
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                        DisclosureGroup {
                            controls(index)
                            HStack {
                                Text("Filter opacity")
                                Slider(value: Binding(get: { entries.indices.contains(index) ? entries[index].opacity ?? 1 : 1 }, set: { if entries.indices.contains(index) { entries[index].opacity = $0 } }), in: 0...1)
                            }
                            if entry.maskFile != nil {
                                Toggle("Mask enabled", isOn: Binding(get: { entries.indices.contains(index) && entries[index].maskEnabled != false }, set: { if entries.indices.contains(index) { entries[index].maskEnabled = $0 } }))
                                Button("Remove filter mask") { if entries.indices.contains(index) { entries[index].maskFile = nil; entries[index].maskEnabled = nil } }
                            }
                        } label: {
                            HStack {
                                Toggle(entry.adjustment.kind.rawValue, isOn: Binding(get: { entries.indices.contains(index) && entries[index].enabled }, set: { if entries.indices.contains(index) { entries[index].enabled = $0 } }))
                                Spacer()
                                Button("↑") { entries.swapAt(index, index - 1) }.disabled(index == 0)
                                Button("↓") { entries.swapAt(index, index + 1) }.disabled(index + 1 >= entries.count)
                                Button("Remove") { entries.remove(at: index) }
                            }
                        }
                    }
                }.padding(4)
            }.frame(maxHeight: 320).disabled(processing || highPrecision)
            HStack {
                Picker("Filter", selection: $kind) { ForEach(AdjustmentKind.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
                Button("Add filter") { entries.append(StoredLayerFilter(id: UUID(), enabled: true, adjustment: LayerAdjustment(kind: kind))) }
            }.disabled(processing || highPrecision || entries.count >= 32)
            if !message.isEmpty { Text(message).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true) }
            HStack {
                Button("Cancel") { task?.cancel(); dismiss() }.keyboardShortcut(.cancelAction)
                Spacer()
                Button("Preview") { render(commit: false) }.disabled(processing || highPrecision)
                Button("Apply") { render(commit: true) }.keyboardShortcut(.defaultAction).disabled(processing || highPrecision)
            }
        }.padding(20).frame(width: 550)
            .onAppear { original = session.activeLayer; entries = original?.liveFilters?.entries ?? [] }
            .onDisappear { task?.cancel() }
    }

    private func value(_ index: Int) -> LayerAdjustment { entries.indices.contains(index) ? entries[index].adjustment : LayerAdjustment(kind: .invert) }
    private func binding<T>(_ index: Int, _ key: WritableKeyPath<LayerAdjustment, T>) -> Binding<T> {
        Binding(get: { value(index)[keyPath: key] }, set: { if entries.indices.contains(index) { entries[index].adjustment[keyPath: key] = $0 } })
    }
    private func number(_ title: String, _ index: Int, _ key: WritableKeyPath<LayerAdjustment, Double>, _ range: ClosedRange<Double>) -> some View {
        HStack {
            Text(title).frame(width: 105, alignment: .leading)
            Slider(value: binding(index, key), in: range)
            TextField(title, value: binding(index, key), format: .number.precision(.fractionLength(2))).frame(width: 70).textFieldStyle(.roundedBorder)
        }
    }
    private func hue(_ index: Int, _ key: WritableKeyPath<HueSaturationSettings, Double>) -> Binding<Double> {
        Binding(get: { value(index).resolvedHSV[keyPath: key] }, set: { new in guard entries.indices.contains(index) else { return }; var settings = value(index).resolvedHSV; settings[keyPath: key] = new; entries[index].adjustment.hsvSettings = settings })
    }
    private func hsv<T>(_ index: Int, _ key: WritableKeyPath<HueSaturationSettings, T>) -> Binding<T> {
        Binding(get: { value(index).resolvedHSV[keyPath: key] }, set: { new in guard entries.indices.contains(index) else { return }; var settings = value(index).resolvedHSV; settings[keyPath: key] = new; entries[index].adjustment.hsvSettings = settings })
    }
    @ViewBuilder private func controls(_ index: Int) -> some View {
        let adjustment = value(index)
        switch adjustment.kind {
        case .hsv:
            Picker("Color range", selection: hsv(index, \.range)) { ForEach(ColorRange.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
            Toggle("Colorize", isOn: hsv(index, \.colorize))
            Toggle("Invert selected range", isOn: hsv(index, \.invertRange))
            HStack { Text("Hue"); Slider(value: hue(index, \.hue), in: -180...180) }
            HStack { Text("Saturation"); Slider(value: hue(index, \.saturation), in: -100...100) }
            HStack { Text("Lightness"); Slider(value: hue(index, \.lightness), in: -100...100) }
        case .levels:
            Picker("Channel", selection: binding(index, \.levels.channel)) { ForEach(LevelsChannel.allCases, id: \.self) { Text($0.rawValue).tag($0) } }
            number("Input black", index, \.levels.current.black, 0...254)
            number("Input white", index, \.levels.current.white, 1...255)
            number("Gamma", index, \.levels.current.gamma, 0.1...9.99)
            number("Output black", index, \.levels.current.outputBlack, 0...255)
            number("Output white", index, \.levels.current.outputWhite, 0...255)
        case .curves:
            CurvesControls(settings: binding(index, \.curves))
        case .exposure:
            number("Exposure", index, \.exposure.exposure, -20...20)
            number("Offset", index, \.exposure.offset, -0.5...0.5)
            number("Gamma", index, \.exposure.gamma, 0.01...9.99)
        case .gradientMap:
            ColorPicker("Shadows", selection: color(index, \.gradientMap.shadows), supportsOpacity: false)
            ColorPicker("Highlights", selection: color(index, \.gradientMap.highlights), supportsOpacity: false)
            Toggle("Reverse", isOn: binding(index, \.gradientMap.reversed))
        case .blackWhite:
            number("Reds", index, \.blackWhite.reds, -200...300)
            number("Yellows", index, \.blackWhite.yellows, -200...300)
            number("Greens", index, \.blackWhite.greens, -200...300)
            number("Cyans", index, \.blackWhite.cyans, -200...300)
            number("Blues", index, \.blackWhite.blues, -200...300)
            number("Magentas", index, \.blackWhite.magentas, -200...300)
            Toggle("Tint", isOn: binding(index, \.blackWhite.tint))
            number("Tint hue", index, \.blackWhite.tintHue, 0...360)
            number("Tint saturation", index, \.blackWhite.tintSaturation, 0...100)
        case .colorBalance:
            number("Shadow C / R", index, \.colorBalance.shadowCyanRed, -100...100)
            number("Shadow M / G", index, \.colorBalance.shadowMagentaGreen, -100...100)
            number("Shadow Y / B", index, \.colorBalance.shadowYellowBlue, -100...100)
            number("Midtone C / R", index, \.colorBalance.midCyanRed, -100...100)
            number("Midtone M / G", index, \.colorBalance.midMagentaGreen, -100...100)
            number("Midtone Y / B", index, \.colorBalance.midYellowBlue, -100...100)
            number("Highlight C / R", index, \.colorBalance.highlightCyanRed, -100...100)
            number("Highlight M / G", index, \.colorBalance.highlightMagentaGreen, -100...100)
            number("Highlight Y / B", index, \.colorBalance.highlightYellowBlue, -100...100)
            Toggle("Preserve luminosity", isOn: binding(index, \.colorBalance.preserveLuminosity))
        case .grain:
            number("Amount", index, \.grain.amount, 0...100)
            number("Size", index, \.grain.size, 0.5...20)
            number("Roughness", index, \.grain.roughness, 0...100)
        case .gaussianBlur:
            number("Radius", index, \.gaussianRadius, 0.1...250)
        case .motionBlur:
            number("Angle", index, \.resolvedMotionAngle, -90...90)
            number("Distance", index, \.resolvedMotionDistance, 1...2000)
        case .addNoise:
            number("Amount", index, \.resolvedNoiseAmount, 0.1...400)
            Toggle("Gaussian", isOn: binding(index, \.resolvedNoiseGaussian))
            Toggle("Monochromatic", isOn: binding(index, \.resolvedNoiseMonochromatic))
            TextField("Seed", value: binding(index, \.resolvedNoiseSeed), format: .number)
        case .invert: Text("Invert RGB channels")
        }
    }
    private func color(_ index: Int, _ key: WritableKeyPath<LayerAdjustment, AdjustmentColor>) -> Binding<Color> {
        Binding(get: { let item = value(index)[keyPath: key]; return Color(.sRGB, red: item.red, green: item.green, blue: item.blue) }, set: { new in
            guard entries.indices.contains(index), let color = NSColor(new).usingColorSpace(.sRGB) else { return }
            entries[index].adjustment[keyPath: key] = AdjustmentColor(red: Double(color.redComponent), green: Double(color.greenComponent), blue: Double(color.blueComponent))
        })
    }
    private func render(commit: Bool) {
        guard let original, let source, !highPrecision else { return }
        guard entries.allSatisfy({ $0.adjustment.isValid }) else { message = "Check the filter parameter ranges."; return }
        if commit && entries == (original.liveFilters?.entries ?? []) { dismiss(); return }
        task?.cancel(); processing = true; message = "Processing…"
        let filters = entries
        task = Task {
            do {
                let result = try await EditableFilterWorker.shared.render(source, filters: filters, masks: original.liveFilters?.masks ?? [:])
                try Task.checkCancellation()
                if commit {
                    guard let index = session.document?.layers.firstIndex(where: { $0.id == original.id }), session.document?.layers[index].asset?.image === original.asset?.image, session.document?.layers[index].editableFilters == original.editableFilters else { message = "The layer changed. Reopen its filter editor."; processing = false; return }
                    session.beginEdit("Editable Filters")
                    session.document?.layers[index].asset = result
                    session.document?.layers[index].shape = nil
                    session.document?.layers[index].text = nil
                    session.document?.layers[index].editableFilters = filters.isEmpty ? nil : LayerFilterState(source: source, rendered: result.image, entries: filters, workingSpace: original.liveFilters?.workingSpace, masks: original.liveFilters?.masks ?? [:])
                    session.endEdit(); dismiss()
                } else { preview = result.image; message = "Preview ready" }
            } catch is CancellationError { } catch { message = error.localizedDescription }
            processing = false
        }
    }
}
