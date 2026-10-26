import UIKit
import SwiftUI

struct CaptureConfig {
    let apiBase: String
    let token: String
    let locale: String
    let keywords: [String]
    let sttLanguages: [String]
    let strings: [String: String]
}

/// A photo or clip picked for the capture, before and after upload.
struct CaptureMedia: Identifiable {
    let id = UUID()
    let thumb: UIImage
    let data: Data
    let contentType: String
    var isVideo: Bool { contentType.hasPrefix("video") }
    var key: String?
}

struct CaptureLine: Identifiable {
    enum From { case bauhly, studio }
    let id = UUID()
    let from: From
    let text: String
    var media: [CaptureMedia] = []
}

/// The Capture conversation, as the web app's CaptureChat runs it for a plain
/// capture (deferQuestions): the studio says or shows something, the Capture
/// conversation agent reads it, a missing photo is asked for, the capture is
/// filed under "No project" without being interviewed, and the one question
/// the agent would ask is kept for `Generate plan`.
@MainActor
final class CaptureModel: ObservableObject {
    enum Step: Equatable { case wait, compose, recording, media, saveFailed, done, clarify }

    @Published var lines: [CaptureLine] = []
    @Published var typing = false
    @Published var step: Step = .wait
    @Published var draft = ""
    @Published var staged: [CaptureMedia] = []
    @Published var busy = false
    @Published var polishing = false
    @Published var micDenied = false
    let recorder = CaptureRecorder()
    var onClose: (String) -> Void = { _ in }

    private let config: CaptureConfig
    private weak var bridge: NativeCapturePlugin?

    // what is being captured — the same fields the web app's `cap` ref holds
    private var kind = "note"
    private var text = ""
    private var attachments: [[String: Any]] = []
    private var understanding: [String: Any]?
    private var understandings: [[String: Any]] = []
    private var summary = ""
    private var title = ""
    private var turns: [[String: String]] = []
    private var asked = ""
    private var held: [String] = []
    private var planning = false
    private var saved: (projectId: String, captureId: String)?
    private var autoDraft = ""
    private var recordingFor: Step = .compose

    init(config: CaptureConfig, bridge: NativeCapturePlugin) {
        self.config = config
        self.bridge = bridge
        say("What would you like to capture today? Maybe something that happened at work, an idea, or something you noticed.") { [weak self] in
            self?.step = .compose
        }
    }

    func t(_ english: String) -> String { config.strings[english] ?? english }

    var canSend: Bool {
        (!draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !staged.isEmpty)
            && !busy && !(polishing && draft == autoDraft)
    }

    // MARK: - the conversation

    /// Bauhly's line, after a short "typing" beat so it reads as said.
    private func say(_ english: String, raw: Bool = false, then: (() -> Void)? = nil) {
        typing = true
        Task {
            try? await Task.sleep(nanoseconds: 520_000_000)
            typing = false
            withAnimation(.easeOut(duration: 0.22)) {
                lines.append(CaptureLine(from: .bauhly, text: raw ? english : t(english)))
            }
            try? await Task.sleep(nanoseconds: 260_000_000)
            then?()
        }
    }

    private func studioSays(_ words: String, media: [CaptureMedia] = []) {
        withAnimation(.easeOut(duration: 0.22)) {
            lines.append(CaptureLine(from: .studio, text: words, media: media))
        }
    }

    func send() {
        let words = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        let files = staged
        guard canSend else { return }
        draft = ""
        staged = []
        autoDraft = ""
        polishing = false
        Haptic.tap()
        studioSays(words, media: files)
        let at = step
        step = .wait
        busy = true
        Task {
            do {
                let added = try await upload(files)
                attachments += added
                if files.contains(where: { $0.isVideo }) { kind = "video" }
                else if words.isEmpty && kind != "video" { kind = "photo" }
                var extra: [String: String]?
                if at == .clarify, !words.isEmpty {
                    text = [text, words].filter { !$0.isEmpty }.joined(separator: "\n\n")
                    extra = ["role": "user", "text": words]
                } else if !words.isEmpty {
                    text = words
                    turns = [["role": "user", "text": words]]
                } else if turns.isEmpty {
                    turns = [["role": "user", "text": "Uploaded a file"]]
                }
                understood(await understand(extra: extra))
            } catch {
                busy = false
                say("That upload didn't go through — want to try again?") { self.step = at }
            }
        }
    }

    private func understood(_ result: [String: Any]) {
        if let u = result["understanding"] as? [String: Any] { understanding = u }
        if let list = result["captures"] as? [[String: Any]], !list.isEmpty {
            understandings = list
            understanding = list[0]
        }
        if let s = result["conversationSummary"] as? String, !s.isEmpty { summary = s }
        if let s = result["conversationTitle"] as? String, !s.isEmpty { title = s }

        let askedSoFar = turns.filter { $0["role"] == "assistant" }.count
        let followUp = askedSoFar >= 4 ? "" : (Self.question(in: result, asked: askedSoFar) ?? Self.gapQuestion(text, alreadyAsked: asked))
        if !followUp.isEmpty && !planning {
            // a new capture keeps its question for Generate plan
            held = [followUp]
            continueToFile()
            return
        }
        if followUp.isEmpty && planning {
            planAnswered()
            return
        }
        if !followUp.isEmpty {
            asked = followUp
            turns.append(["role": "assistant", "text": followUp])
            busy = false
            say(followUp, raw: true) { self.step = .clarify }
            return
        }
        continueToFile()
    }

    private func continueToFile() {
        let choice = (understanding?["visualAssetChoice"] as? String ?? "").lowercased()
        if attachments.isEmpty && choice != "generate" && choice != "none" {
            busy = false
            say("Do you have a photo or clip of this, or would you rather generate visuals later?") { [weak self] in
                self?.step = .media
            }
            return
        }
        save()
    }

    /// `Media` step answers: photos picked, Generate visuals, or Nothing right now.
    func mediaPicked(_ files: [CaptureMedia]) {
        guard !files.isEmpty else { return }
        studioSays("", media: files)
        step = .wait
        busy = true
        Task {
            do {
                attachments += try await upload(files)
                // as the web: a clip makes it a video capture; photos keep the note a note
                if files.contains(where: { $0.isVideo }) { kind = "video" }
                choose("provided")
            } catch {
                busy = false
                say("That upload didn't go through — want to try again?") { self.step = .media }
            }
        }
    }

    func noMedia(generate: Bool) {
        studioSays(t(generate ? "Generate visuals" : "Nothing right now"))
        step = .wait
        choose(generate ? "generate" : "none")
    }

    private func choose(_ choice: String) {
        func apply(_ u: [String: Any]?) -> [String: Any]? {
            guard var u else { return nil }
            if (u["visualAssetChoice"] as? String ?? "").isEmpty { u["visualAssetChoice"] = choice }
            return u
        }
        understanding = apply(understanding)
        understandings = understandings.compactMap { apply($0) }
        save()
    }

    /// Filed by the web app (same rules as the web capture: "No project").
    func save() {
        step = .wait
        busy = true
        Task {
            do {
                let made = try await bridge?.request("save", payload()) ?? [:]
                saved = (made["projectId"] as? String ?? "", made["captureId"] as? String ?? "")
                busy = false
                Haptic.success()
                say("Saved. It is ready for your next plan.") { self.step = .done }
            } catch {
                busy = false
                say("Something went wrong saving that — try again in a moment?") { self.step = .saveFailed }
            }
        }
    }

    func generatePlan() {
        studioSays(t("Generate plan"))
        step = .wait
        guard let ask = held.first, let saved, !saved.captureId.isEmpty else { handOff(); return }
        planning = true
        held = []
        asked = ask
        turns.append(["role": "assistant", "text": ask])
        say(ask, raw: true) { self.step = .clarify }
    }

    func skip() {
        studioSays(t("Skip this question"))
        step = .wait
        handOff()
    }

    private func planAnswered() {
        Task {
            if let saved {
                var body = payload()
                body["projectId"] = saved.projectId
                body["captureId"] = saved.captureId
                _ = try? await bridge?.request("answer", body)
            }
            busy = false
            handOff()
        }
    }

    private func handOff() {
        planning = false
        say("Generating your plan…") {
            Task {
                _ = try? await self.bridge?.request("plan", [:])
                self.onClose("plan")
            }
        }
    }

    func close() {
        if step == .recording { _ = recorder.stop() }
        onClose("closed")
    }

    private func payload() -> [String: Any] {
        var body: [String: Any] = [
            "type": kind,
            "text": text,
            "attachments": attachments,
            "understandings": understandings.isEmpty ? (understanding.map { [$0] } ?? []) : understandings,
            "conversationSummary": summary,
            "conversationTitle": title,
            "conversationTurns": turns,
            "held": held,
        ]
        if let understanding { body["understanding"] = understanding }
        return body
    }

    // MARK: - voice

    func record() {
        Task {
            guard await CaptureRecorder.askPermission() else {
                micDenied = true
                say("I can't reach the microphone — let's write it instead.")
                return
            }
            do {
                recordingFor = step == .clarify ? .clarify : .compose
                try recorder.start(languages: config.sttLanguages)
                Haptic.tap()
                step = .recording
            } catch {
                say("I can't reach the microphone — let's write it instead.")
            }
        }
    }

    func stopRecording() {
        let take = recorder.stop()
        Haptic.tap()
        step = recordingFor
        let live = take.text
        draft = [draft, live].filter { !$0.isEmpty }.joined(separator: draft.isEmpty ? "" : " ")
        autoDraft = draft
        guard let url = take.url, let audio = try? Data(contentsOf: url), !audio.isEmpty else {
            if live.isEmpty { say("I couldn't quite catch that — write it in, or record again.") }
            return
        }
        polishing = true
        if !live.isEmpty {
            say(Self.hasGap(live) ? "I missed a word in there — fill it in if you can, then send." : "Check I got this right:")
        }
        let before = draft.dropLast(live.count)
        Task {
            defer { polishing = false; try? FileManager.default.removeItem(at: url) }
            let heard = (try? await transcribe(audio, hint: live)) ?? ""
            guard !heard.isEmpty else {
                if live.isEmpty { say("I couldn't quite catch that — write it in, or record again.") }
                return
            }
            // the cleaner words replace the live ones — unless the studio already edited them
            if draft == autoDraft {
                draft = String(before) + heard
                autoDraft = draft
            }
            if live.isEmpty { say("Check I got this right:") }
        }
    }

    func pickingWhileRecording(_ picking: Bool) {
        if picking { recorder.pause() } else { recorder.resume() }
    }

    // MARK: - API

    private func call(_ path: String, json: [String: Any]) async throws -> [String: Any] {
        var req = URLRequest(url: try endpoint(path))
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        authorize(&req)
        req.httpBody = try JSONSerialization.data(withJSONObject: json)
        return try await send(req)
    }

    private func endpoint(_ path: String) throws -> URL {
        let base = config.apiBase.hasSuffix("/") ? String(config.apiBase.dropLast()) : config.apiBase
        guard let url = URL(string: base + path) else { throw URLError(.badURL) }
        return url
    }

    private func authorize(_ req: inout URLRequest) {
        req.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        req.setValue(config.locale, forHTTPHeaderField: "x-app-locale")
        req.timeoutInterval = 120
    }

    private func send(_ req: URLRequest) async throws -> [String: Any] {
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
    }

    private func understand(extra: [String: String]? = nil) async -> [String: Any] {
        if let extra { turns.append(extra) }
        let body: [String: Any] = [
            "text": text,
            "attachments": attachments.map { ["type": $0["type"] ?? "image", "key": $0["key"] ?? ""] },
            "projectName": "",
            "turns": turns,
        ]
        return (try? await call("/projects/captures/understand", json: body))
            ?? ["action": "ready"]
    }

    private func transcribe(_ audio: Data, hint: String) async throws -> String {
        var req = URLRequest(url: try endpoint("/projects/captures/transcribe"))
        req.httpMethod = "POST"
        req.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        authorize(&req)
        func header(_ s: String) -> String { s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "" }
        if !hint.isEmpty { req.setValue(header(String(hint.prefix(1500))), forHTTPHeaderField: "X-Transcript-Hint") }
        if !config.keywords.isEmpty {
            req.setValue(header(config.keywords.prefix(24).joined(separator: ",")), forHTTPHeaderField: "X-Transcript-Keywords")
        }
        req.setValue(header(config.sttLanguages.prefix(8).joined(separator: ",")), forHTTPHeaderField: "X-Transcript-Languages")
        req.httpBody = audio
        let result = try await send(req)
        return (result["text"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Presigned PUTs straight to S3, as the web app's uploadFiles does.
    private func upload(_ files: [CaptureMedia]) async throws -> [[String: Any]] {
        guard !files.isEmpty else { return [] }
        let signed = try await call("/projects/uploads/sign", json: [
            "files": files.map { ["contentType": $0.contentType] },
        ])
        guard let slots = signed["uploads"] as? [[String: Any]], slots.count == files.count else {
            throw URLError(.badServerResponse)
        }
        try await withThrowingTaskGroup(of: Void.self) { group in
            for (file, slot) in zip(files, slots) {
                guard let target = (slot["uploadUrl"] as? String).flatMap(URL.init(string:)) else {
                    throw URLError(.badURL)
                }
                var put = URLRequest(url: target)
                put.httpMethod = "PUT"
                put.setValue(file.contentType, forHTTPHeaderField: "Content-Type")
                if let cache = slot["cacheControl"] as? String { put.setValue(cache, forHTTPHeaderField: "Cache-Control") }
                put.timeoutInterval = 300
                let request = put
                let body = file.data
                group.addTask {
                    let (_, response) = try await URLSession.shared.upload(for: request, from: body)
                    guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                        throw URLError(.badServerResponse)
                    }
                }
            }
            try await group.waitForAll()
        }
        return zip(files, slots).map { file, slot in
            ["type": file.isVideo ? "video" : "image", "key": slot["key"] as? String ?? ""]
        }
    }

    // MARK: - the agent's answer, read as the web app reads it

    private static func question(in result: [String: Any], asked: Int) -> String? {
        if asked >= 4 { return nil }
        let first = (result["questions"] as? [String])?.first
        let q = ((result["question"] as? String) ?? first ?? (result["message"] as? String) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return nil }
        let ready = (result["action"] as? String) == "ready"
        let needs = (result["needsClarification"] as? Bool) == true
        let status = (result["status"] as? String ?? "").lowercased()
        if ready && !needs && status != "needs_clarification" { return nil }
        return q
    }

    private static func hasGap(_ text: String) -> Bool {
        text.range(of: #"\[(?:unclear|inaudible|unintelligible|\?+)\]|\(\s*(?:unclear|inaudible|\?+)\s*\)"#,
                   options: [.regularExpression, .caseInsensitive]) != nil
    }

    private static func gapQuestion(_ text: String, alreadyAsked: String) -> String {
        alreadyAsked.isEmpty && hasGap(text) ? "I missed a word in what you said — what was it?" : ""
    }
}

enum Haptic {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
}
