import SwiftUI

/// The Crop tool's header. A view of its own because dragging the crop frame changes `cropRect` on
/// every mouse move: read here, only this bar re-renders, not the whole editor and its Layers panel.
struct CropControls: View {
    @Bindable var session: EditorSession

    var body: some View {
        HStack(spacing: 14) {
            Text("Crop").font(ToolHeaderStyle.titleFont)
            Picker("Ratio", selection: $session.cropRatioChoice) {
                ForEach(["Free", "Original", "1:1", "4:3", "3:4", "16:9", "9:16", "9:20", "Custom"], id: \.self) { Text($0) }
            }.frame(width: 170)
                .onChange(of: session.cropRatioChoice) { _, _ in session.changeCropRatio() }
            if session.cropRatioChoice == "Custom" {
                TextField("Ratio width", value: $session.cropCustomWidth, format: .number).frame(width: 55)
                    .onChange(of: session.cropCustomWidth) { _, _ in session.changeCropRatio() }
                Text(":")
                TextField("Ratio height", value: $session.cropCustomHeight, format: .number).frame(width: 55)
                    .onChange(of: session.cropCustomHeight) { _, _ in session.changeCropRatio() }
            }
            if let rect = session.cropRect {
                Text("\(Int(rect.width)) × \(Int(rect.height)) px").monospacedDigit()
            }
            Button("Cancel") { session.cancelCrop() }.disabled(session.cropRect == nil)
            Button("Apply Crop") { Task { await session.commitCrop() } }
                .disabled(session.cropRect == nil || (session.cropRatioChoice == "Custom" && session.cropRatio == nil))
            Spacer()
        }.padding(.horizontal, 18).toolHeaderBar().disabled(session.showsBusy || session.document == nil)
    }
}
