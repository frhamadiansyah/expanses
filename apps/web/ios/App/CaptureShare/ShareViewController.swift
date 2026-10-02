import UIKit
import UniformTypeIdentifiers

/// The share sheet's door: one image comes in, is read on the phone, and waits in the App Group.
///
/// There is nothing to compose and nothing to confirm — sharing the image was already the owner's decision — so
/// the picture is read and stored as soon as the sheet opens. Once it is stored the app is opened on Review
/// (`cicis://review`), where the drain that runs on opening turns it into the draft the owner came to check.
final class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        saveFirstImage()
    }

    private func saveFirstImage() {
        guard let item = extensionContext?.inputItems.first as? NSExtensionItem,
              let provider = item.attachments?.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) })
        else {
            finish()
            return
        }
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
                self.finish(openingApp: stored)
            }
        }
    }

    private func finish(openingApp: Bool = false) {
        DispatchQueue.main.async {
            if openingApp { self.openReview() }
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }

    /// An extension has no `UIApplication.shared`; the application is found up the responder chain instead, the
    /// way share extensions hand the owner over to their app.
    private func openReview() {
        guard let url = URL(string: "cicis://review") else { return }
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
