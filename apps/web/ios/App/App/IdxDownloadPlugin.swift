import Capacitor
import UIKit
import WebKit

/**
 * `IdxDownload.open({ url })` — IDX's public Ringkasan Saham page, shown full screen inside the app, and the file
 * its Unduh button downloads handed back to the web layer as `{ fileName, mimeType, base64 }`.
 *
 * Nothing is fetched by the app: the owner opens the page and taps Unduh themselves, and the sheet only catches
 * the download WebKit would otherwise have dropped. Only idx.co.id pages open in it; any other link goes to the
 * system browser. The sheet's web view keeps no cookies or storage after it closes (a non-persistent store).
 *
 * Cancel rejects with the code `cancelled`, which the page treats as nothing having happened.
 */
@objc(IdxDownloadPlugin)
public class IdxDownloadPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "IdxDownloadPlugin"
    public let jsName = "IdxDownload"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "open", returnType: CAPPluginReturnPromise),
    ]

    private var showing = false

    static func isIdx(_ url: URL) -> Bool {
        guard let host = url.host?.lowercased() else { return false }
        return host == "idx.co.id" || host.hasSuffix(".idx.co.id")
    }

    @objc func open(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw), url.scheme == "https", Self.isIdx(url) else {
            call.reject("Only IDX's own pages open here.", "not_idx")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let host = self.bridge?.viewController else {
                call.reject("The app is not ready.", "unavailable")
                return
            }
            guard !self.showing else {
                call.reject("IDX is already open.", "busy")
                return
            }
            self.showing = true
            let browser = IdxBrowserController(url: url) { [weak self] outcome in
                self?.showing = false
                switch outcome {
                case let .caught(fileName, mimeType, data):
                    call.resolve(["fileName": fileName, "mimeType": mimeType, "base64": data.base64EncodedString()])
                case .cancelled:
                    call.reject("Cancelled", "cancelled")
                case let .failed(message):
                    call.reject(message, "download_failed")
                }
            }
            let sheet = UINavigationController(rootViewController: browser)
            sheet.modalPresentationStyle = .fullScreen
            host.present(sheet, animated: true)
        }
    }
}

enum IdxCatch {
    case caught(fileName: String, mimeType: String, data: Data)
    case cancelled
    case failed(String)
}

/** The sheet: a native bar (Cancel, the page's name) over a web view holding IDX's page. */
final class IdxBrowserController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let start: URL
    private let finish: (IdxCatch) -> Void
    private var finished = false
    private var webView: WKWebView!
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var progressObservation: NSKeyValueObservation?
    /** One temp folder per sheet, removed when the sheet closes whatever happened. */
    private let folder = FileManager.default.temporaryDirectory.appendingPathComponent("idx-\(UUID().uuidString)", isDirectory: true)
    private var destination: URL?
    private var mimeType = "application/octet-stream"

    init(url: URL, finish: @escaping (IdxCatch) -> Void) {
        self.start = url
        self.finish = finish
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground
        title = "IDX · Ringkasan Saham"
        navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .cancel, target: self, action: #selector(cancel))

        let configuration = WKWebViewConfiguration()
        // Nothing the page sets outlives the sheet.
        configuration.websiteDataStore = .nonPersistent()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        progress.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        view.addSubview(progress)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            progress.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            progress.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            progress.trailingAnchor.constraint(equalTo: view.trailingAnchor),
        ])
        progressObservation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] view, _ in
            guard let self else { return }
            self.progress.setProgress(Float(view.estimatedProgress), animated: true)
            self.progress.isHidden = view.estimatedProgress >= 1
        }
        webView.load(URLRequest(url: start))
    }

    @objc private func cancel() { close(.cancelled) }

    private func close(_ outcome: IdxCatch) {
        guard !finished else { return }
        finished = true
        progressObservation = nil
        webView.stopLoading()
        try? FileManager.default.removeItem(at: folder)
        dismiss(animated: true) { [finish] in finish(outcome) }
    }

    // MARK: Navigation — IDX's pages stay here, anything else goes to the system browser

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        let url = navigationAction.request.url
        let mainFrame = navigationAction.targetFrame?.isMainFrame ?? true
        if mainFrame, let url, let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https", !IdxDownloadPlugin.isIdx(url) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposition = (navigationResponse.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition")?.lowercased() ?? ""
        if navigationResponse.isForMainFrame, !navigationResponse.canShowMIMEType || disposition.hasPrefix("attachment") {
            decisionHandler(.download)
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    /** A link that asks for a new window (target=_blank, window.open) opens in this one, under the same rules. */
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if IdxDownloadPlugin.isIdx(url) || url.scheme == "blob" || url.scheme == "data" {
                webView.load(navigationAction.request)
            } else if url.scheme == "http" || url.scheme == "https" {
                UIApplication.shared.open(url)
            }
        }
        return nil
    }

    // MARK: The download — into a temp file, read, handed back, deleted

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        } catch {
            completionHandler(nil)
            return
        }
        let name = (suggestedFilename as NSString).lastPathComponent
        let target = folder.appendingPathComponent(name.isEmpty ? "ringkasan-saham.xlsx" : name)
        try? FileManager.default.removeItem(at: target)
        destination = target
        if let mime = response.mimeType { mimeType = mime }
        completionHandler(target)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let destination, let data = try? Data(contentsOf: destination) else {
            close(.failed("The downloaded file could not be read."))
            return
        }
        close(.caught(fileName: destination.lastPathComponent, mimeType: mimeType, data: data))
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        let alert = UIAlertController(title: "Download failed", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
