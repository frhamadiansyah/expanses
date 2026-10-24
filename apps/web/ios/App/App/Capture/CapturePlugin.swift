import Capacitor
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// The web layer's door to the phone's capture services: the holding area the shortcuts and the share sheet write
/// to, the camera, the photo library, and the pictures themselves.
///
/// Nothing here decides what a capture means — that is the reader's work in `@expanses/core` — and nothing leaves
/// the phone.
@objc(CapturePlugin)
public class CapturePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CapturePlugin"
    public let jsName = "Capture"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "drainCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ackCaptures", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanReceipt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pickPhotos", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readCaptureImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCaptureImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "holdingAreaStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recognizeImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takeStatementBatch", returnType: CAPPluginReturnPromise),
    ]

    private var receiptCall: CAPPluginCall?
    private var photosCall: CAPPluginCall?

    /// The most pictures one pick takes: the share sheet's own limit, so both doors take the same statements.
    private static let mostPhotos = 20

    /// Everything the shortcuts and the share sheet left behind, in the order it arrived. Nothing is removed: the
    /// web layer calls `ackCaptures` once it has stored them.
    @objc func drainCaptures(_ call: CAPPluginCall) {
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                call.resolve(with: DrainedCaptures(captures: try HoldingArea.drain()))
            } catch {
                call.reject("The holding area could not be read", nil, error)
            }
        }
    }

    /// The web layer has committed these captures: the holding area lets them go.
    @objc func ackCaptures(_ call: CAPPluginCall) {
        let ids = (call.getArray("ids") ?? []).compactMap { $0 as? String }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try HoldingArea.ack(ids: ids)
                call.resolve()
            } catch {
                call.reject("The holding area could not be cleared", nil, error)
            }
        }
    }

    @objc func holdingAreaStatus(_ call: CAPPluginCall) {
        call.resolve(["pending": HoldingArea.pendingCount(), "broken": HoldingArea.brokenCount()])
    }

    @objc func readCaptureImage(_ call: CAPPluginCall) {
        guard let file = call.getString("file") else {
            call.reject("A file name is required")
            return
        }
        do {
            let data = try Data(contentsOf: try HoldingArea.privateImageURL(file))
            call.resolve(["base64": data.base64EncodedString(), "mime": HoldingArea.mimeType(of: file)])
        } catch {
            call.reject("That picture is not on this phone", nil, error)
        }
    }

    /// The text of a picture the web layer hands over (base64), read on the phone. Nothing is written to disk.
    @objc func recognizeImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
              let decoded = UIImage(data: data),
              let cgImage = TextRecognizer.upright(decoded).cgImage
        else {
            call.reject("unreadableImage")
            return
        }
        Task {
            do {
                call.resolve(with: RecognizedImage(lines: try await TextRecognizer.recognize(image: cgImage)))
            } catch {
                call.reject("The picture could not be read", nil, error)
            }
        }
    }

    /// The statement screenshots the share sheet read as one batch, handed over and deleted from the App Group.
    @objc func takeStatementBatch(_ call: CAPPluginCall) {
        guard let batchId = call.getString("batchId"), HoldingArea.isPlainName(batchId) else {
            call.reject("A batch id is required")
            return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                call.resolve(with: StatementBatch(images: try HoldingArea.takeStatementBatch(id: batchId)))
            } catch {
                call.reject("The statement screenshots could not be read", nil, error)
            }
        }
    }

    @objc func deleteCaptureImage(_ call: CAPPluginCall) {
        guard let file = call.getString("file") else {
            call.reject("A file name is required")
            return
        }
        guard file.split(separator: "/").allSatisfy({ HoldingArea.isPlainName(String($0)) }) else {
            call.reject("Not a capture picture")
            return
        }
        if let url = try? HoldingArea.privateImageURL(file) {
            try? FileManager.default.removeItem(at: url)
        }
        call.resolve()
    }

    /// The camera, for a paper receipt: one picture, read on the phone, handed back as a capture.
    @objc func scanReceipt(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.receiptCall == nil, self.photosCall == nil else {
                call.reject("The camera is already open")
                return
            }
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
                call.reject("Not available here")
                return
            }
            let picker = UIImagePickerController()
            picker.sourceType = .camera
            picker.delegate = self
            self.receiptCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }
}

extension CapturePlugin {
    /// The photo library, for pictures already taken: up to `mostPhotos`, in the order chosen. The system picker runs
    /// outside the app, so it needs no access to the library and asks for none; only the chosen pictures come back.
    /// Each is read on the phone and kept as the camera's photo is — what they are (a statement's screenshots or one
    /// draft) is the web layer's call, the same one it makes for what the share sheet hands over.
    @objc func pickPhotos(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard self.photosCall == nil, self.receiptCall == nil else {
                call.reject("A picker is already open")
                return
            }
            var configuration = PHPickerConfiguration()
            configuration.filter = .images
            configuration.selectionLimit = Self.mostPhotos
            configuration.selection = .ordered
            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            self.photosCall = call
            self.bridge?.viewController?.present(picker, animated: true)
        }
    }

    /// One chosen picture, read and kept under the app's private captures; nil when it cannot be opened.
    private static func capture(of provider: NSItemProvider) async -> RawCapture? {
        let data: Data? = await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
        // Upright once, here, as the camera's photo is: the text is read and the JPEG saved from the same pixels.
        guard let data, let chosen = UIImage(data: data), case let picture = TextRecognizer.upright(chosen),
              let cgImage = picture.cgImage else {
            return nil
        }
        let lines = (try? await TextRecognizer.recognize(image: cgImage)) ?? []
        let id = UUID().uuidString
        var imageFile: String?
        if let jpeg = picture.jpegData(compressionQuality: 0.9) {
            let file = "captures/\(id).jpg"
            if (try? HoldingArea.store(imageData: jpeg, at: file)) != nil { imageFile = file }
        }
        return RawCapture(id: id, kind: "shared-image", capturedAt: CaptureClock.stamp(), lines: lines, imageFile: imageFile)
    }
}

extension CapturePlugin: PHPickerViewControllerDelegate {
    public func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard let call = photosCall else { return }
        photosCall = nil
        let providers = results.map(\.itemProvider)
        Task {
            // One picture in memory at a time, as the share sheet reads a statement's screenshots.
            var captures: [RawCapture] = []
            for provider in providers {
                if let capture = await Self.capture(of: provider) {
                    captures.append(capture)
                } else if providers.count > 1 {
                    // A screenshot of several that cannot be opened still counts, as the share sheet counts it: the
                    // check says nothing was read from it, rather than the rest reading as one receipt.
                    captures.append(RawCapture(id: UUID().uuidString, kind: "shared-image", capturedAt: CaptureClock.stamp()))
                }
            }
            call.resolve(with: PickedPhotos(captures: captures))
        }
    }
}

extension CapturePlugin: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    public func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        let call = receiptCall
        receiptCall = nil
        call?.resolve(["capture": NSNull()])
    }

    public func imagePickerController(
        _ picker: UIImagePickerController,
        didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
    ) {
        picker.dismiss(animated: true)
        guard let call = receiptCall else { return }
        receiptCall = nil
        // Upright once, here: the text is read, its boxes measured and the JPEG saved from these same pixels.
        guard let photo = info[.originalImage] as? UIImage, case let image = TextRecognizer.upright(photo),
              let cgImage = image.cgImage else {
            call.reject("That picture could not be read")
            return
        }
        Task {
            do {
                let lines = try await TextRecognizer.recognize(image: cgImage)
                let id = UUID().uuidString
                var imageFile: String?
                if let data = image.jpegData(compressionQuality: 0.9) {
                    let file = "captures/\(id).jpg"
                    try HoldingArea.store(imageData: data, at: file)
                    imageFile = file
                }
                let capture = RawCapture(
                    id: id,
                    kind: "photo",
                    capturedAt: CaptureClock.stamp(),
                    lines: lines,
                    imageFile: imageFile
                )
                call.resolve(with: ScanResult(capture: capture))
            } catch {
                call.reject("The picture could not be read", nil, error)
            }
        }
    }
}

private struct DrainedCaptures: Encodable {
    let captures: [RawCapture]
}

private struct PickedPhotos: Encodable {
    let captures: [RawCapture]
}

private struct ScanResult: Encodable {
    let capture: RawCapture
}

private struct RecognizedImage: Encodable {
    let lines: [CaptureLine]
}

private struct StatementBatch: Encodable {
    let images: [HoldingArea.StatementImage]
}
