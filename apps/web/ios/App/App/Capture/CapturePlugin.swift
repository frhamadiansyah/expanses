import Capacitor
import UIKit

/// The web layer's door to the phone's capture services: the holding area the shortcuts and the share sheet write
/// to, the camera, and the pictures themselves.
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
        CAPPluginMethod(name: "readCaptureImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteCaptureImage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "holdingAreaStatus", returnType: CAPPluginReturnPromise),
    ]

    private var receiptCall: CAPPluginCall?

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
            guard self.receiptCall == nil else {
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

private struct ScanResult: Encodable {
    let capture: RawCapture
}
