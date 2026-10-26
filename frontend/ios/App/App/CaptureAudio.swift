import AVFoundation
import Speech

/// The voice note: one take recorded to an AAC file (sent to the API's
/// transcription, which reads names and accents best) while Apple's speech
/// recogniser writes the words on screen as they are said — on the phone
/// itself when the language allows, so there is no wait and no 1-minute cap.
final class CaptureRecorder: ObservableObject {
    @Published private(set) var liveText = ""
    @Published private(set) var level: Float = 0
    @Published private(set) var elapsed: TimeInterval = 0
    @Published private(set) var isPaused = false

    private let engine = AVAudioEngine()
    private let lock = NSLock()
    private var file: AVAudioFile?
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var recognizer: SFSpeechRecognizer?
    private var heard = ""          // words from recognition passes already finished
    private var onDevice = true     // falls back to Apple's servers when the phone has no model
    private var failures = 0
    private var running = false
    private var timer: Timer?
    private var startedAt = Date()
    private var held: TimeInterval = 0
    private var pausedAt: Date?
    private(set) var fileURL: URL?

    /// Microphone is required; speech recognition only adds the live words.
    static func askPermission() async -> Bool {
        let mic: Bool = await withCheckedContinuation { done in
            AVAudioSession.sharedInstance().requestRecordPermission { done.resume(returning: $0) }
        }
        if SFSpeechRecognizer.authorizationStatus() == .notDetermined {
            _ = await withCheckedContinuation { (done: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
                SFSpeechRecognizer.requestAuthorization { done.resume(returning: $0) }
            }
        }
        return mic
    }

    func start(languages: [String]) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("capture-\(UUID().uuidString).m4a")
        let out = try AVAudioFile(
            forWriting: url,
            settings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC,
                AVSampleRateKey: format.sampleRate,
                AVNumberOfChannelsKey: format.channelCount,
                AVEncoderBitRateKey: 96_000,
            ],
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
        lock.lock(); file = out; lock.unlock()
        fileURL = url
        heard = ""
        onDevice = true
        failures = 0
        set { $0.liveText = ""; $0.level = 0; $0.elapsed = 0; $0.isPaused = false }

        recognizer = SFSpeechRecognizer(locale: Locale(identifier: Self.bcp47(languages.first ?? "en")))
        running = true
        startRecognition()

        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock()
            try? self.file?.write(from: buffer)
            self.request?.append(buffer)
            self.lock.unlock()
            let level = Self.levelOf(buffer)
            DispatchQueue.main.async { self.level = level }
        }
        engine.prepare()
        try engine.start()

        startedAt = Date()
        held = 0
        pausedAt = nil
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            guard let self, self.pausedAt == nil else { return }
            self.elapsed = Date().timeIntervalSince(self.startedAt) - self.held
        }
    }

    /// Hold the take (a photo is being picked): nothing said meanwhile is kept.
    func pause() {
        guard running, pausedAt == nil else { return }
        engine.pause()
        pausedAt = Date()
        set { $0.isPaused = true; $0.level = 0 }
    }

    func resume() {
        guard running, let since = pausedAt else { return }
        held += Date().timeIntervalSince(since)
        pausedAt = nil
        try? engine.start()
        lock.lock(); let listening = request != nil; lock.unlock()
        if !listening { startRecognition() }
        set { $0.isPaused = false }
    }

    /// Ends the take; returns the recording and the words heard live.
    func stop() -> (url: URL?, text: String) {
        guard running else { return (nil, liveText) }
        running = false
        timer?.invalidate()
        timer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        lock.lock()
        request?.endAudio()
        request = nil
        file = nil  // closes and finishes the m4a
        lock.unlock()
        task?.finish()
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        set { $0.level = 0; $0.isPaused = false }
        return (fileURL, liveText.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    // MARK: - live words

    private func startRecognition() {
        guard running, let recognizer, recognizer.isAvailable,
              SFSpeechRecognizer.authorizationStatus() == .authorized else { return }
        let next = SFSpeechAudioBufferRecognitionRequest()
        next.shouldReportPartialResults = true
        if onDevice && recognizer.supportsOnDeviceRecognition { next.requiresOnDeviceRecognition = true }
        if #available(iOS 16, *) { next.addsPunctuation = true }
        lock.lock(); request = next; lock.unlock()
        task = recognizer.recognitionTask(with: next) { [weak self] result, error in
            guard let self else { return }
            DispatchQueue.main.async {
                if let result {
                    self.failures = 0
                    self.liveText = Self.join(self.heard, result.bestTranscription.formattedString)
                }
                // a pass ends (pause in speech, server limit): keep its words, listen on.
                // A pass that fails straight away (no on-device model) is retried on
                // Apple's servers, and after three failures in a row the live words
                // stop — the recording itself carries on and is transcribed at the end.
                guard result?.isFinal == true || error != nil else { return }
                self.heard = self.liveText
                self.lock.lock(); self.request = nil; self.lock.unlock()
                self.task = nil
                var wait = 0.0
                if error != nil && result == nil {
                    self.failures += 1
                    self.onDevice = false
                    wait = 0.6
                }
                guard self.failures < 3 else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + wait) {
                    if self.running && self.pausedAt == nil && self.task == nil { self.startRecognition() }
                }
            }
        }
    }

    private func set(_ change: @escaping (CaptureRecorder) -> Void) {
        if Thread.isMainThread { change(self) } else { DispatchQueue.main.async { change(self) } }
    }

    private static func join(_ a: String, _ b: String) -> String {
        let left = a.trimmingCharacters(in: .whitespaces)
        let right = b.trimmingCharacters(in: .whitespaces)
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        return "\(left) \(right)"
    }

    private static func bcp47(_ id: String) -> String {
        switch id {
        case "es": return "es-ES"
        case "hi": return "hi-IN"
        default: return "en-US"
        }
    }

    private static func levelOf(_ buffer: AVAudioPCMBuffer) -> Float {
        guard let samples = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for i in 0..<Int(buffer.frameLength) { sum += samples[i] * samples[i] }
        let rms = sqrt(sum / Float(buffer.frameLength))
        let db = 20 * log10(max(rms, 0.000_01))
        return max(0, min(1, (db + 50) / 50))
    }
}
