import UIKit
import UniformTypeIdentifiers

/// The share sheet's door: one image comes in, is read on the phone, and waits in the App Group.
///
/// There is nothing to compose and nothing to confirm — sharing the image was already the owner's decision — so
/// the picture is read and stored as soon as the sheet opens. Once it is stored the app is opened on Review
/// (`cicis://review`), where the drain that runs on opening turns it into the draft the owner came to check.
///
/// Two or more images are one statement's screenshots (statement-check S2): each is read on the phone, only its
/// text lines are written to `captures/statement-<batchId>/` — no picture is kept — and the app is opened on
/// `cicis://statement/<batchId>`, where the owner says which card it is.
final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let providers = imageProviders()
        if providers.count >= 2 {
            saveStatementBatch(providers)
        } else if let provider = providers.first {
            saveImage(provider)
        } else {
            finish()
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
