import UIKit
import Vision

/// One line of text as Vision read it, in the coordinates the reader expects: x, y, width and height in 0–1, with
/// y measured from the top of the picture.
struct CaptureLine: Codable {
    let text: String
    let box: [Double]
    let height: Double
}

enum TextRecognizer {
    /// Apple's on-phone recognition, for screenshots and receipt photos.
    ///
    /// Accurate mode because a payment is read once and must be right; language correction off because figures and
    /// merchant names are not prose, and a "correction" would quietly change them.
    static func recognize(image: CGImage) async throws -> [CaptureLine] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = languages(for: request)
        request.usesLanguageCorrection = false

        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])

        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else { return nil }
            let box = observation.boundingBox
            // Vision measures y from the bottom-left; the reader counts from the top, where the line's top edge is
            // 1 - (origin.y + height).
            return CaptureLine(
                text: candidate.string,
                box: [box.origin.x, 1 - box.origin.y - box.height, box.width, box.height],
                height: box.height
            )
        }
    }

    /// Indonesian first, then English — but only the ones this phone's Vision can read in accurate mode. Asking for a
    /// language it does not have makes `perform` throw, and a capture is better read in English than not at all; when
    /// neither is offered, the request keeps Vision's own default.
    static let wanted = ["id-ID", "en-US"]

    static func languages(for request: VNRecognizeTextRequest) -> [String] {
        guard let supported = try? request.supportedRecognitionLanguages() else { return [] }
        return wanted.filter { want in
            supported.contains { $0.caseInsensitiveCompare(want) == .orderedSame }
        }
    }

    /// The picture turned the way it is seen. A camera photo is stored sideways with an orientation flag; drawing it
    /// once into an upright bitmap means the text is read, its boxes are measured, and the JPEG is saved all from the
    /// same pixels, so a box always lands on the line it came from.
    static func upright(_ image: UIImage) -> UIImage {
        guard image.imageOrientation != .up else { return image }
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = image.scale
        format.opaque = true
        return UIGraphicsImageRenderer(size: image.size, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: image.size))
        }
    }
}
