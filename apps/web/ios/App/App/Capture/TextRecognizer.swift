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
        request.recognitionLanguages = ["id-ID", "en-US"]
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
}
