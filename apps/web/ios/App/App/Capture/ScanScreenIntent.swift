import AppIntents
import Foundation
import UIKit

/// The Screen scanner shortcut's second step: a screenshot goes in, the phone reads its text, and the capture
/// waits in the App Group. The app does not open, and nothing leaves the phone.
struct ScanScreenIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan screen"
    static let description = IntentDescription("Reads a screenshot's text and saves it to Expanses' To-review inbox. Nothing leaves the phone.")
    static let openAppWhenRun = false

    @Parameter(title: "Screenshot")
    var image: IntentFile

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let shared = UIImage(data: image.data) else {
            throw CaptureIntentError.unreadableImage
        }
        let picture = TextRecognizer.upright(shared)
        guard let cgImage = picture.cgImage else {
            throw CaptureIntentError.unreadableImage
        }
        let id = UUID().uuidString
        let lines = try await TextRecognizer.recognize(image: cgImage)
        let capture = RawCapture(
            id: id,
            kind: "screen",
            capturedAt: CaptureClock.stamp(),
            lines: lines,
            imageFile: "captures/\(id).jpg"
        )
        try HoldingArea.write(capture: capture, imageData: picture.jpegData(compressionQuality: 0.9) ?? image.data)
        return .result(dialog: "Saved to review")
    }
}

enum CaptureIntentError: Error, CustomLocalizedStringResourceConvertible {
    case unreadableImage

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .unreadableImage:
            return "That image could not be read"
        }
    }
}
