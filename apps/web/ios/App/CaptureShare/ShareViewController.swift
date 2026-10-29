import UIKit
import UniformTypeIdentifiers

/// The share sheet's door: one image comes in, is read on the phone, and waits in the App Group.
///
/// There is nothing to compose and nothing to confirm — sharing the image was already the owner's decision — so
/// the picture is read and stored as soon as the sheet opens. Once it is stored the app is opened on Review
/// (`cicis://review`), where the drain that runs on opening turns it into the draft the owner came to check — or,
/// when the one picture is a statement page (`readsAsStatement`, decided in the app, as it is for "Choose from
/// Photos"), hands the owner on to the card picker instead.
///
/// Two or more images are one statement's screenshots (statement-check S2): each is read on the phone, only its
/// text lines are written to `captures/statement-<batchId>/` — no picture is kept — and the app is opened on
/// `cicis://statement/<batchId>`, where the owner says which card it is.
///
/// Plain text (a bank message long-pressed in an app that has no notification trigger, such as WhatsApp Business) is
/// written as a notification capture under the fixed app label "Shared text", so the reader and the drain treat it
/// like any other notification. The app is not opened; a short "Saved to review" note shows and the sheet closes.
/// A share that holds an image is only ever read as an image, so a picture with a caption is never written twice.
final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let providers = imageProviders()
        if providers.count >= 2 {
            saveStatementBatch(providers)
        } else if let provider = providers.first {
            saveImage(provider)
        } else if let text = textShare() {
            saveText(text)
        } else {
            finish()
        }
    }

    /// The label every shared text is filed under: the capture source's key in Settings → Capture sources.
    static let sharedTextApp = "Shared text"

    /// The text parts of the share, or nil when there are none. Only reached when the share holds no image.
    private func textShare() -> TextShare? {
        let items = (extensionContext?.inputItems ?? []).compactMap { $0 as? NSExtensionItem }
        let providers = items.flatMap { $0.attachments ?? [] }
            .filter { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }
        let attributed = items.compactMap { $0.attributedContentText?.string }
        if providers.isEmpty && attributed.isEmpty { return nil }
        return TextShare(providers: providers, fallback: attributed.joined(separator: "\n"))
    }

    struct TextShare {
        let providers: [NSItemProvider]
        let fallback: String
    }

    /// Writes the shared text as a notification capture; empty text writes nothing.
    private func saveText(_ share: TextShare) {
        Task {
            var parts: [String] = []
            for provider in share.providers {
                if let text = await Self.text(of: provider) { parts.append(text) }
            }
            var text = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { text = share.fallback.trimmingCharacters(in: .whitespacesAndNewlines) }
            guard !text.isEmpty else {
                self.finish()
                return
            }
            let capture = RawCapture(
                id: UUID().uuidString,
                kind: "notification",
                capturedAt: CaptureClock.stamp(),
                app: Self.sharedTextApp,
                title: nil,
                body: text,
                lines: [],
                imageFile: nil
            )
            let stored = (try? HoldingArea.write(capture: capture)) != nil
            self.confirm(stored ? "Saved to review" : "Could not save")
        }
    }

    private static func text(of provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { continuation in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { item, _ in
                switch item {
                case let string as String: continuation.resume(returning: string)
                case let attributed as NSAttributedString: continuation.resume(returning: attributed.string)
                case let data as Data: continuation.resume(returning: String(data: data, encoding: .utf8))
                default: continuation.resume(returning: nil)
                }
            }
        }
    }

    /// A short note over the sheet, then the sheet closes. The app is not opened.
    private func confirm(_ message: String) {
        DispatchQueue.main.async {
            let label = UILabel()
            label.text = message
            label.font = .preferredFont(forTextStyle: .headline)
            label.textColor = .white
            label.textAlignment = .center
            label.backgroundColor = UIColor.black.withAlphaComponent(0.8)
            label.layer.cornerRadius = 14
            label.clipsToBounds = true
            label.translatesAutoresizingMaskIntoConstraints = false
            self.view.addSubview(label)
            NSLayoutConstraint.activate([
                label.centerXAnchor.constraint(equalTo: self.view.centerXAnchor),
                label.centerYAnchor.constraint(equalTo: self.view.centerYAnchor),
                label.widthAnchor.constraint(equalToConstant: 200),
                label.heightAnchor.constraint(equalToConstant: 56),
            ])
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { self.finish() }
        }
    }

    /// Every image in the share, in the order it was shared.
    private func imageProviders() -> [NSItemProvider] {
        let items = (extensionContext?.inputItems ?? []).compactMap { $0 as? NSExtensionItem }
        return items.flatMap { $0.attachments ?? [] }
            .filter { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) }
    }

    /// Reads each screenshot in turn — one picture in memory at a time — and writes their lines as one batch.
    private func saveStatementBatch(_ providers: [NSItemProvider]) {
        Task {
            var images: [[CaptureLine]] = []
            for provider in providers {
                images.append(await Self.lines(of: provider))
            }
            let batchId = UUID().uuidString
            let stored = (try? HoldingArea.writeStatementBatch(id: batchId, images: images)) != nil
            self.finish(opening: stored ? URL(string: "cicis://statement/\(batchId)") : nil)
        }
    }

    /// The text of one shared picture, read on the phone; nothing when it cannot be opened or read.
    private static func lines(of provider: NSItemProvider) async -> [CaptureLine] {
        let data: Data? = await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
        guard let data, let shared = UIImage(data: data), let cgImage = TextRecognizer.upright(shared).cgImage else {
            return []
        }
        return (try? await TextRecognizer.recognize(image: cgImage)) ?? []
    }

    private func saveImage(_ provider: NSItemProvider) {
        provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, _ in
            guard let self, let data, let shared = UIImage(data: data) else {
                self?.finish()
                return
            }
            let picture = TextRecognizer.upright(shared)
            guard let cgImage = picture.cgImage else {
                self.finish()
                return
            }
            Task {
                let lines = (try? await TextRecognizer.recognize(image: cgImage)) ?? []
                let id = UUID().uuidString
                let capture = RawCapture(
                    id: id,
                    kind: "shared-image",
                    capturedAt: CaptureClock.stamp(),
                    lines: lines,
                    imageFile: "captures/\(id).jpg"
                )
                let stored = (try? HoldingArea.write(capture: capture, imageData: picture.jpegData(compressionQuality: 0.9) ?? data)) != nil
                self.finish(opening: stored ? URL(string: "cicis://review") : nil)
            }
        }
    }

    private func finish(opening url: URL? = nil) {
        DispatchQueue.main.async {
            if let url { self.openApp(at: url) }
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// An extension has no `UIApplication.shared`; the application is found up the responder chain instead, the
    /// way share extensions hand the owner over to their app.
    private func openApp(at url: URL) {
        var responder: UIResponder? = self
        while let next = responder {
            if let application = next as? UIApplication {
                application.open(url, options: [:], completionHandler: nil)
                return
            }
            responder = next.next
        }
    }
}
