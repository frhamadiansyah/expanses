import UIKit
import UniformTypeIdentifiers

/// The share sheet's door: one image comes in, is read on the phone, and waits in the App Group.
///
/// There is nothing to compose and nothing to confirm — sharing the image was already the owner's decision — so
/// the picture is read and stored as soon as the sheet opens, and the sheet closes itself. The app does not have
/// to be running; the capture is drained the next time it is.
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
                try? HoldingArea.write(capture: capture, imageData: picture.jpegData(compressionQuality: 0.9) ?? data)
                self.finish()
            }
        }
    }

    private func finish() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil)
        }
    }
}
