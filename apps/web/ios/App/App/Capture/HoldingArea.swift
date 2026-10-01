import Foundation

/// A capture as the phone writes it down: the one shape the intents, the share extension and the app's own camera
/// all produce, and the shape the web layer reads.
struct RawCapture: Codable {
    let id: String
    let kind: String
    let capturedAt: String
    var app: String?
    var title: String?
    var body: String?
    var lines: [CaptureLine]
    var imageFile: String?

    init(
        id: String,
        kind: String,
        capturedAt: String,
        app: String? = nil,
        title: String? = nil,
        body: String? = nil,
        lines: [CaptureLine] = [],
        imageFile: String? = nil
    ) {
        self.id = id
        self.kind = kind
        self.capturedAt = capturedAt
        self.app = app
        self.title = title
        self.body = body
        self.lines = lines
        self.imageFile = imageFile
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        kind = try container.decode(String.self, forKey: .kind)
        capturedAt = try container.decode(String.self, forKey: .capturedAt)
        app = try container.decodeIfPresent(String.self, forKey: .app)
        title = try container.decodeIfPresent(String.self, forKey: .title)
        body = try container.decodeIfPresent(String.self, forKey: .body)
        lines = try container.decodeIfPresent([CaptureLine].self, forKey: .lines) ?? []
        imageFile = try container.decodeIfPresent(String.self, forKey: .imageFile)
    }
}

enum HoldingAreaError: Error {
    case noContainer
}

/// The App Group holding area, and the app's private copies of what it drains.
///
/// The intents and the share extension run where the app's database is not reachable, so each writes one capture
/// into the shared container — image first, JSON last, each a whole file — and the app empties it on the next
/// drain. Pictures move into the app's own storage on the way out; the shared container keeps nothing.
enum HoldingArea {
    static let appGroup = "group.com.cicis.app"

    /// `<App Group>/captures`: what the shortcuts and the share sheet write to.
    static func groupCaptures() throws -> URL {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            throw HoldingAreaError.noContainer
        }
        let folder = container.appendingPathComponent("captures", isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// The app's own storage; a picture's name is a path inside it (`captures/<id>.jpg`).
    static func privateImageURL(_ file: String) throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return support.appendingPathComponent(file)
    }

    /// Copies a picture into the app's own storage, where the draft that keeps it will find it.
    static func store(imageData: Data, at file: String) throws {
        let url = try privateImageURL(file)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try imageData.write(to: url, options: .atomic)
    }

    /// Writes one capture where the app will find it. The image goes first and the JSON last: a capture is whole
    /// exactly when its JSON is there, so a half-written one is never drained.
    static func write(capture: RawCapture, imageData: Data? = nil) throws {
        var capture = capture
        let folder = try groupCaptures()
        if let imageData {
            if capture.imageFile == nil {
                capture.imageFile = "captures/\(capture.id).jpg"
            }
            let name = (capture.imageFile! as NSString).lastPathComponent
            try imageData.write(to: folder.appendingPathComponent(name), options: .atomic)
        }
        let json = try JSONEncoder().encode(capture)
        try json.write(to: folder.appendingPathComponent("\(capture.id).json"), options: .atomic)
    }

    /// Takes everything waiting out of the shared area.
    ///
    /// A file that cannot be read is moved aside (`captures/broken`) rather than deleted: it is evidence of a writer
    /// that got something wrong, and `holdingAreaStatus` reports it. A capture whose picture cannot be moved loses
    /// the reference rather than keeping one that will not resolve.
    static func drain() throws -> (captures: [RawCapture], broken: Int) {
        let folder = try groupCaptures()
        let brokenFolder = folder.appendingPathComponent("broken", isDirectory: true)
        let manager = FileManager.default
        let files = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        var captures: [RawCapture] = []
        var broken = 0
        for file in files {
            guard let data = try? Data(contentsOf: file),
                  var capture = try? JSONDecoder().decode(RawCapture.self, from: data) else {
                broken += 1
                try? manager.createDirectory(at: brokenFolder, withIntermediateDirectories: true)
                try? manager.moveItem(at: file, to: brokenFolder.appendingPathComponent(file.lastPathComponent))
                continue
            }
            if let imageFile = capture.imageFile {
                let source = folder.appendingPathComponent((imageFile as NSString).lastPathComponent)
                if manager.fileExists(atPath: source.path) {
                    do {
                        let destination = try privateImageURL(imageFile)
                        try manager.createDirectory(
                            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try? manager.removeItem(at: destination)
                        try manager.moveItem(at: source, to: destination)
                    } catch {
                        capture.imageFile = nil
                    }
                } else {
                    capture.imageFile = nil
                }
            }
            try? manager.removeItem(at: file)
            captures.append(capture)
        }
        return (captures, broken)
    }

    /// How much is still waiting, and how much of it could not be opened.
    static func pendingCount() -> Int {
        guard let folder = try? groupCaptures(),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        else { return 0 }
        return files.filter { $0.pathExtension == "json" }.count
    }

    static func brokenCount() -> Int {
        guard let folder = try? groupCaptures() else { return 0 }
        let brokenFolder = folder.appendingPathComponent("broken", isDirectory: true)
        guard let files = try? FileManager.default.contentsOfDirectory(at: brokenFolder, includingPropertiesForKeys: nil)
        else { return 0 }
        return files.filter { $0.pathExtension == "json" }.count
    }

    /// What a picture is, for the web layer that will draw it.
    static func mimeType(of file: String) -> String {
        switch (file as NSString).pathExtension.lowercased() {
        case "png": return "image/png"
        case "heic": return "image/heic"
        default: return "image/jpeg"
        }
    }
}
