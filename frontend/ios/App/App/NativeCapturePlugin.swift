import UIKit
import SwiftUI
import Capacitor

/// The app's root: Capacitor's web view, plus the app's own native plugins.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativeCapturePlugin())
    }
}

/// `NativeCapture` — the Capture conversation as a native SwiftUI screen.
///
/// JS opens it with the API base, the session token and the UI's translated
/// lines (`open`). The screen talks to the API itself (uploads, transcription,
/// the Capture conversation agent) and asks JS to do the parts whose rules live
/// in the web app — filing the capture, saving an answer, starting the plan —
/// through `request` events that JS answers with `reply`. `open` resolves when
/// the screen closes: `{ result: 'closed' | 'plan' }`.
@objc(NativeCapturePlugin)
public class NativeCapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeCapturePlugin"
    public let jsName = "NativeCapture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reply", returnType: CAPPluginReturnPromise),
    ]

    private var openCall: CAPPluginCall?
    private var waiting: [String: CheckedContinuation<[String: Any], Error>] = [:]
    private weak var host: UIViewController?

    @objc func open(_ call: CAPPluginCall) {
        let config = CaptureConfig(
            apiBase: call.getString("apiBase") ?? "",
            token: call.getString("token") ?? "",
            locale: call.getString("locale") ?? "en",
            keywords: (call.getArray("keywords") as? [String]) ?? [],
            sttLanguages: (call.getArray("sttLanguages") as? [String]) ?? ["en"],
            strings: (call.getObject("strings") as? [String: String]) ?? [:]
        )
        DispatchQueue.main.async {
            guard self.openCall == nil, let root = self.bridge?.viewController else {
                call.reject("Capture is already open")
                return
            }
            self.openCall = call
            let model = CaptureModel(config: config, bridge: self)
            model.onClose = { [weak self] result in self?.close(result) }
            let screen = UIHostingController(rootView: CaptureView(model: model))
            screen.modalPresentationStyle = .fullScreen
            self.host = screen
            root.present(screen, animated: true)
        }
    }

    @objc func reply(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        let ok = call.getBool("ok") ?? false
        let data = call.getObject("data") ?? [:]
        let message = call.getString("error") ?? "Request failed"
        DispatchQueue.main.async {
            guard let waiter = self.waiting.removeValue(forKey: id) else { return }
            if ok {
                waiter.resume(returning: data)
            } else {
                waiter.resume(throwing: NSError(domain: "NativeCapture", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
            }
        }
        call.resolve()
    }

    /// Asks the web app to do `kind` with `payload`, and waits for its reply.
    @MainActor
    func request(_ kind: String, _ payload: [String: Any]) async throws -> [String: Any] {
        let id = UUID().uuidString
        return try await withCheckedThrowingContinuation { waiter in
            waiting[id] = waiter
            notifyListeners("request", data: ["id": id, "kind": kind, "payload": payload])
        }
    }

    @MainActor
    private func close(_ result: String) {
        let finish = { [weak self] in
            guard let self else { return }
            self.openCall?.resolve(["result": result])
            self.openCall = nil
            self.waiting.values.forEach {
                $0.resume(throwing: NSError(domain: "NativeCapture", code: 2, userInfo: [NSLocalizedDescriptionKey: "Closed"]))
            }
            self.waiting.removeAll()
        }
        if let host {
            host.dismiss(animated: true, completion: finish)
        } else {
            finish()
        }
    }
}
