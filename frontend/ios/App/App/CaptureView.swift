import SwiftUI
import PhotosUI
import AVFoundation
import UniformTypeIdentifiers

private enum Ink {
    static let text = Color(red: 0.086, green: 0.086, blue: 0.102)
    static let soft = Color(red: 0.42, green: 0.42, blue: 0.46)
    static let ground = Color(red: 0.953, green: 0.953, blue: 0.961)
    static let signal = Color(red: 1.0, green: 0.322, blue: 0.153)
}

struct CaptureView: View {
    @ObservedObject var model: CaptureModel
    @ObservedObject private var recorder: CaptureRecorder
    @State private var picking = false
    @State private var shooting = false
    @State private var choosingSource = false
    @State private var pickForMedia = false
    @State private var levels: [Float] = Array(repeating: 0, count: 32)
    @FocusState private var typing: Bool

    init(model: CaptureModel) {
        self.model = model
        self.recorder = model.recorder
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            thread
            footer
        }
        .background(Color.white.ignoresSafeArea())
        .sheet(isPresented: $picking, onDismiss: { if model.step == .recording { model.pickingWhileRecording(false) } }) {
            MediaPicker { files in deliver(files) }
                .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $shooting, onDismiss: { if model.step == .recording { model.pickingWhileRecording(false) } }) {
            CameraPicker { file in deliver([file]) }
                .ignoresSafeArea()
        }
        .confirmationDialog("", isPresented: $choosingSource, titleVisibility: .hidden) {
            Button(model.t("Photo library")) { open(camera: false) }
            if UIImagePickerController.isSourceTypeAvailable(.camera) {
                Button(model.t("Take photo")) { open(camera: true) }
            }
            Button(model.t("Cancel"), role: .cancel) {
                pickForMedia = false
                if model.step == .recording { model.pickingWhileRecording(false) }
            }
        }
        .onReceive(recorder.$level) { level in
            levels.append(level)
            if levels.count > 32 { levels.removeFirst(levels.count - 32) }
        }
    }

    // MARK: - header

    private var header: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle().fill(Ink.signal.opacity(0.10)).frame(width: 52, height: 52)
                Circle().fill(Ink.signal).frame(width: 18, height: 18)
                    .scaleEffect(model.step == .recording ? 1 + CGFloat(recorder.level) * 0.6 : 1)
                    .animation(.easeOut(duration: 0.12), value: recorder.level)
            }
            Text(model.t("Capture"))
                .font(.system(size: 28, weight: .heavy))
                .foregroundColor(Ink.text)
            Spacer()
            Button(action: model.close) {
                Image(systemName: "xmark")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundColor(Ink.text)
                    .frame(width: 44, height: 44)
                    .background(Circle().fill(Ink.ground))
            }
            .accessibilityLabel(model.t("Close capture"))
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }

    // MARK: - the conversation

    private var thread: some View {
        ScrollViewReader { scroller in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(model.lines) { line in
                        lineView(line).transition(.move(edge: .bottom).combined(with: .opacity))
                    }
                    if model.step == .recording { liveTurn }
                    if model.typing { TypingDots() }
                    else if model.busy { thinking }
                    Color.clear.frame(height: 1).id("end")
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 8)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: model.lines.count) { _ in scrollDown(scroller) }
            .onChange(of: model.typing) { _ in scrollDown(scroller) }
            .onChange(of: recorder.liveText) { _ in scrollDown(scroller, animated: false) }
        }
    }

    private func scrollDown(_ scroller: ScrollViewProxy, animated: Bool = true) {
        if animated { withAnimation(.easeOut(duration: 0.25)) { scroller.scrollTo("end", anchor: .bottom) } }
        else { scroller.scrollTo("end", anchor: .bottom) }
    }

    @ViewBuilder
    private func lineView(_ line: CaptureLine) -> some View {
        switch line.from {
        case .bauhly:
            Text(line.text)
                .font(.system(size: 18))
                .foregroundColor(Ink.text)
                .lineSpacing(4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        case .studio:
            VStack(alignment: .trailing, spacing: 6) {
                if !line.media.isEmpty { MediaGrid(media: line.media) }
                if !line.text.isEmpty {
                    Text(line.text)
                        .font(.system(size: 17))
                        .foregroundColor(Ink.text)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 11)
                        .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Ink.ground))
                }
            }
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.leading, 48)
        }
    }

    private var liveTurn: some View {
        VStack(alignment: .trailing, spacing: 6) {
            if !model.staged.isEmpty { MediaGrid(media: model.staged) }
            Text(recorder.liveText.isEmpty ? model.t("Listening…") : recorder.liveText)
                .font(.system(size: 17))
                .foregroundColor(recorder.liveText.isEmpty ? Ink.soft : Ink.text)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(RoundedRectangle(cornerRadius: 20, style: .continuous).fill(Ink.ground))
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
        .padding(.leading, 48)
    }

    private var thinking: some View {
        HStack(spacing: 8) {
            ProgressView().scaleEffect(0.8)
            Text(model.t("Thinking…")).font(.system(size: 15)).foregroundColor(Ink.soft)
        }
    }

    // MARK: - the foot

    @ViewBuilder
    private var footer: some View {
        VStack(spacing: 10) {
            switch model.step {
            case .compose, .clarify:
                if model.step == .clarify {
                    chips { Chip(model.t("Skip this question"), style: .quiet) { model.skip() } }
                }
                composer
            case .recording:
                recordingBar
            case .media:
                chips {
                    Chip(model.t("Upload a photo"), icon: "photo.on.rectangle", style: .primary) {
                        pickForMedia = true
                        choosingSource = true
                    }
                    Chip(model.t("Generate visuals"), icon: "sparkles") { model.noMedia(generate: true) }
                    Chip(model.t("Nothing right now"), style: .quiet) { model.noMedia(generate: false) }
                }
            case .saveFailed:
                chips { Chip(model.t("Try again"), style: .primary) { model.save() } }
            case .done:
                chips {
                    Chip(model.t("Generate plan"), icon: "sparkles", style: .primary) { model.generatePlan() }
                    Chip(model.t("Save and close")) { model.close() }
                }
            case .wait:
                EmptyView()
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .animation(.easeOut(duration: 0.2), value: model.step)
    }

    private func chips<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        Wrap(spacing: 8) { content() }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !model.staged.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(model.staged) { item in
                            ZStack(alignment: .topTrailing) {
                                Thumb(media: item, size: 64)
                                Button {
                                    model.staged.removeAll { $0.id == item.id }
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 20))
                                        .symbolRenderingMode(.palette)
                                        .foregroundStyle(.white, Ink.text.opacity(0.75))
                                }
                                .offset(x: 6, y: -6)
                            }
                        }
                    }
                    .padding(.top, 6)
                    .padding(.horizontal, 4)
                }
            }
            TextField(
                model.t(model.step == .clarify ? "Answer in your own words…" : "Say it however it comes out…"),
                text: $model.draft,
                axis: .vertical
            )
            .font(.system(size: 17))
            .lineLimit(1...6)
            .focused($typing)
            .padding(.horizontal, 6)
            .padding(.top, 6)
            if model.polishing {
                Text(model.t("Cleaning the words up…"))
                    .font(.system(size: 13))
                    .foregroundColor(Ink.soft)
                    .padding(.horizontal, 6)
            }
            HStack(spacing: 10) {
                RoundButton(icon: "plus") {
                    pickForMedia = false
                    choosingSource = true
                }
                .accessibilityLabel(model.t("Add a photo"))
                Spacer()
                RoundButton(icon: "mic") {
                    typing = false
                    model.record()
                }
                .accessibilityLabel(model.t("Record a voice note"))
                Button {
                    typing = false
                    model.send()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 40, height: 40)
                        .background(Circle().fill(model.canSend ? Ink.text : Ink.soft.opacity(0.4)))
                }
                .disabled(!model.canSend)
                .accessibilityLabel(model.t("Send"))
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color.white)
                .shadow(color: .black.opacity(0.08), radius: 16, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .stroke(Color.black.opacity(0.06), lineWidth: 1)
        )
    }

    private var recordingBar: some View {
        HStack(spacing: 12) {
            Waveform(levels: levels)
                .frame(width: 72, height: 28)
            Text(timeOf(recorder.elapsed))
                .font(.system(size: 15, weight: .semibold).monospacedDigit())
                .foregroundColor(.white)
            Spacer()
            Button {
                model.pickingWhileRecording(true)
                pickForMedia = false
                choosingSource = true
            } label: {
                Text(model.t("Add a photo"))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(Capsule().fill(Color.white.opacity(0.14)))
            }
            Button(action: model.stopRecording) {
                RoundedRectangle(cornerRadius: 4).fill(Ink.text)
                    .frame(width: 16, height: 16)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(Color.white))
            }
            .accessibilityLabel(model.t("Stop recording"))
        }
        .padding(.leading, 18)
        .padding(.trailing, 8)
        .frame(height: 64)
        .background(Capsule().fill(Ink.text))
    }

    private func timeOf(_ t: TimeInterval) -> String {
        let s = Int(t)
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    // MARK: - photos

    private func open(camera: Bool) {
        if model.step == .recording { model.pickingWhileRecording(true) }
        if camera { shooting = true } else { picking = true }
    }

    private func deliver(_ files: [CaptureMedia]) {
        guard !files.isEmpty else { return }
        if pickForMedia {
            pickForMedia = false
            model.mediaPicked(files)
        } else {
            model.staged += files
        }
    }
}

// MARK: - pieces

private struct Chip: View {
    enum Style { case normal, primary, quiet }
    let title: String
    var icon: String?
    var style: Style = .normal
    let action: () -> Void

    init(_ title: String, icon: String? = nil, style: Style = .normal, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.style = style
        self.action = action
    }

    var body: some View {
        Button(action: { Haptic.tap(); action() }) {
            HStack(spacing: 6) {
                if let icon { Image(systemName: icon).font(.system(size: 14, weight: .semibold)) }
                Text(title).font(.system(size: 16, weight: .semibold))
            }
            .foregroundColor(style == .primary ? .white : Ink.text)
            .padding(.horizontal, 18)
            .frame(height: 46)
            .background(Capsule().fill(style == .primary ? Ink.text : (style == .quiet ? Color.clear : Ink.ground)))
            .overlay(Capsule().stroke(style == .quiet ? Color.black.opacity(0.12) : Color.clear, lineWidth: 1))
        }
    }
}

/// Chips laid out left to right, wrapping onto the next line when they run out of room.
private struct Wrap: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(subviews, width: proposal.width ?? .infinity)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(subviews, width: bounds.width) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row { var items: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(_ subviews: Subviews, width: CGFloat) -> [Row] {
        var rows = [Row()]
        for (index, view) in subviews.enumerated() {
            let size = view.sizeThatFits(.unspecified)
            if !rows[rows.count - 1].items.isEmpty && rows[rows.count - 1].width + spacing + size.width > width {
                rows.append(Row())
            }
            var row = rows[rows.count - 1]
            row.width += (row.items.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.items.append(index)
            rows[rows.count - 1] = row
        }
        return rows
    }
}

private struct RoundButton: View {
    let icon: String
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(Ink.text)
                .frame(width: 40, height: 40)
                .background(Circle().fill(Ink.ground))
        }
    }
}

private struct Thumb: View {
    let media: CaptureMedia
    let size: CGFloat
    var body: some View {
        Image(uiImage: media.thumb)
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(alignment: .bottomLeading) {
                if media.isVideo {
                    Image(systemName: "play.fill")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.white)
                        .padding(6)
                }
            }
    }
}

private struct MediaGrid: View {
    let media: [CaptureMedia]
    var body: some View {
        let size: CGFloat = media.count == 1 ? 180 : 96
        LazyVGrid(columns: Array(repeating: GridItem(.fixed(size), spacing: 6), count: min(media.count, media.count == 1 ? 1 : 2)),
                  alignment: .trailing, spacing: 6) {
            ForEach(media) { Thumb(media: $0, size: size) }
        }
    }
}

private struct Waveform: View {
    let levels: [Float]
    var body: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(levels.suffix(18).enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(Color(red: 0.83, green: 0.9, blue: 0.16))
                    .frame(width: 2, height: max(3, CGFloat(level) * 28))
            }
        }
        .animation(.linear(duration: 0.1), value: levels)
    }
}

private struct TypingDots: View {
    @State private var on = false
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle().fill(Ink.soft).frame(width: 7, height: 7)
                    .opacity(on ? 1 : 0.3)
                    .animation(.easeInOut(duration: 0.5).repeatForever().delay(Double(i) * 0.15), value: on)
            }
        }
        .onAppear { on = true }
    }
}

// MARK: - pickers

/// Photos and clips from the library, made upload-ready: photos as JPEG
/// (no HEIC), long side at most 2048px; clips as they are.
struct MediaPicker: UIViewControllerRepresentable {
    let onPick: ([CaptureMedia]) -> Void

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = 10
        config.filter = .any(of: [.images, .videos])
        config.preferredAssetRepresentationMode = .compatible
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: PHPickerViewController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(onPick: onPick) }

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPick: ([CaptureMedia]) -> Void
        init(onPick: @escaping ([CaptureMedia]) -> Void) { self.onPick = onPick }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard !results.isEmpty else { return }
            Task {
                var out: [CaptureMedia] = []
                for result in results {
                    if let item = await MediaPrep.load(result.itemProvider) { out.append(item) }
                }
                await MainActor.run { onPick(out) }
            }
        }
    }
}

struct CameraPicker: UIViewControllerRepresentable {
    let onShot: (CaptureMedia) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ controller: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage, let item = MediaPrep.photo(image) { parent.onShot(item) }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { parent.dismiss() }
    }
}

enum MediaPrep {
    static func load(_ provider: NSItemProvider) async -> CaptureMedia? {
        if provider.hasItemConformingToTypeIdentifier(UTType.movie.identifier) {
            return await withCheckedContinuation { done in
                provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
                    guard let url, let data = try? Data(contentsOf: url) else { return done.resume(returning: nil) }
                    let type = url.pathExtension.lowercased() == "mp4" ? "video/mp4" : "video/quicktime"
                    done.resume(returning: CaptureMedia(thumb: frame(of: url), data: data, contentType: type))
                }
            }
        }
        guard provider.canLoadObject(ofClass: UIImage.self) else { return nil }
        return await withCheckedContinuation { done in
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                done.resume(returning: (object as? UIImage).flatMap { photo($0) })
            }
        }
    }

    static func photo(_ image: UIImage) -> CaptureMedia? {
        let full = scaled(image, longSide: 2048)
        guard let data = full.jpegData(compressionQuality: 0.85) else { return nil }
        return CaptureMedia(thumb: scaled(image, longSide: 360), data: data, contentType: "image/jpeg")
    }

    private static func scaled(_ image: UIImage, longSide: CGFloat) -> UIImage {
        let size = image.size
        let k = min(1, longSide / max(size.width, size.height))
        let target = CGSize(width: (size.width * k).rounded(), height: (size.height * k).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        return UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }

    private static func frame(of url: URL) -> UIImage {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.maximumSize = CGSize(width: 360, height: 360)
        if let cg = try? generator.copyCGImage(at: .zero, actualTime: nil) { return UIImage(cgImage: cg) }
        return UIImage(systemName: "video") ?? UIImage()
    }
}
