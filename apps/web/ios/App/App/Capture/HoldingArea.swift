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

/// When a capture happened, written with the phone's own offset (`2026-09-30T06:30:00+07:00`), so the day it carries
/// is the owner's day: a coffee at 06:30 in Jakarta is the 30th, not the 29th it would read as in UTC.
enum CaptureClock {
    static func stamp(_ date: Date = Date()) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = .current
        return formatter.string(from: date)
    }
}

enum HoldingAreaError: Error {
    case noContainer
}

/// The App Group holding area, and the app's private copies of what it drains.
///
/// The intents and the share extension run where the app's database is not reachable, so each writes one capture
/// into the shared container — image first, JSON last, each a whole file. The app reads it on the next drain and
/// clears what it has stored once its write has committed (`ack`); pictures are copied into the app's own storage
/// as they are read, and the shared container keeps nothing that has been acknowledged.
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

    /// Reads everything waiting in the shared area, and leaves it there.
    ///
    /// Nothing is deleted here: the web layer has not stored anything yet, and a drain that dies before its write
    /// commits (an error, the app killed mid-way) must find the same captures next time. The app says it has them with
    /// `ack(ids:)`; until then a capture is read again on every drain, which is harmless because the queue takes a
    /// capture id once.
    ///
    /// Where a picture lives, the one rule: a capture's `imageFile` (`captures/<id>.jpg`) always names a path inside
    /// the app's own storage (`privateImageURL`), and `readCaptureImage` reads only there. So the picture is *copied*
    /// there on every drain, before the web layer sees the capture; the shared copy stays until the ack. Before and
    /// after the ack the same name opens the same picture.
    ///
    /// A file that cannot be read is moved aside (`captures/broken`) rather than deleted: it is evidence of a writer
    /// that got something wrong, and `holdingAreaStatus` reports it. A capture whose picture cannot be copied loses
    /// the reference rather than keeping one that will not resolve.
    static func drain() throws -> [RawCapture] {
        let folder = try groupCaptures()
        let brokenFolder = folder.appendingPathComponent("broken", isDirectory: true)
        let manager = FileManager.default
        let files = try manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        var captures: [RawCapture] = []
        for file in files {
            guard let data = try? Data(contentsOf: file),
                  var capture = try? JSONDecoder().decode(RawCapture.self, from: data) else {
                try? manager.createDirectory(at: brokenFolder, withIntermediateDirectories: true)
                try? manager.moveItem(at: file, to: brokenFolder.appendingPathComponent(file.lastPathComponent))
                continue
            }
            if let imageFile = capture.imageFile {
                let source = folder.appendingPathComponent((imageFile as NSString).lastPathComponent)
                do {
                    let destination = try privateImageURL(imageFile)
                    if manager.fileExists(atPath: source.path) {
                        try manager.createDirectory(
                            at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
                        try? manager.removeItem(at: destination)
                        try manager.copyItem(at: source, to: destination)
                    } else if !manager.fileExists(atPath: destination.path) {
                        capture.imageFile = nil
                    }
                } catch {
                    capture.imageFile = nil
                }
            }
            captures.append(capture)
        }
        return captures
    }

    /// The app has stored these captures: their JSON and the shared copy of their picture go. The app's own copy
    /// of the picture stays where `drain` put it; whether it is kept is the queue's decision, and the web layer
    /// deletes the ones nothing keeps with `deleteCaptureImage`.
    static func ack(ids: [String]) throws {
        let folder = try groupCaptures()
        let manager = FileManager.default
        for id in ids where isPlainName(id) {
            let file = folder.appendingPathComponent("\(id).json")
            if let data = try? Data(contentsOf: file),
               let capture = try? JSONDecoder().decode(RawCapture.self, from: data),
               let imageFile = capture.imageFile {
                let name = (imageFile as NSString).lastPathComponent
                if isPlainName(name) {
                    try? manager.removeItem(at: folder.appendingPathComponent(name))
                }
            }
            try? manager.removeItem(at: file)
        }
    }

    /// A name that stays inside its folder: no separators, no `..`.
    static func isPlainName(_ name: String) -> Bool {
        !name.isEmpty && !name.contains("/") && !name.contains("\\") && name != "." && name != ".."
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

    // MARK: Statement batches (statement-check S2)

    /// One screenshot of a statement batch as it is written down: its text lines and nothing else — no image bytes.
    struct StatementImage: Codable {
        let lines: [CaptureLine]
    }

    /// `captures/statement-<id>`: one batch of statement screenshots, a `<n>.json` per screenshot in share order.
    static func statementFolder(_ batchId: String) throws -> URL {
        try groupCaptures().appendingPathComponent("statement-\(batchId)", isDirectory: true)
    }

    /// A batch nobody took (the share was left on the card picker) is not kept past a day: statement text does not
    /// wait on the phone.
    static let statementBatchLifetime: TimeInterval = 24 * 60 * 60

    /// Writes one statement batch: the lines of each screenshot, in order. The batch is written aside and moved into
    /// place in one step, so the app never finds half of one. Older batches nobody took are deleted on the way.
    static func writeStatementBatch(id batchId: String, images: [[CaptureLine]]) throws {
        guard isPlainName(batchId) else { return }
        let manager = FileManager.default
        let folder = try groupCaptures()
        sweepStatementBatches(in: folder)
        let partial = folder.appendingPathComponent(".statement-\(batchId).partial", isDirectory: true)
        try? manager.removeItem(at: partial)
        try manager.createDirectory(at: partial, withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        for (index, lines) in images.enumerated() {
            let json = try encoder.encode(StatementImage(lines: lines))
            try json.write(to: partial.appendingPathComponent("\(index).json"), options: .atomic)
        }
        let destination = try statementFolder(batchId)
        try? manager.removeItem(at: destination)
        try manager.moveItem(at: partial, to: destination)
    }

    /// Hands a statement batch over and deletes it: a second take finds nothing. Screenshots come back in the order
    /// they were shared; a file that cannot be read is skipped, never kept.
    static func takeStatementBatch(id batchId: String) throws -> [StatementImage] {
        guard isPlainName(batchId) else { return [] }
        let manager = FileManager.default
        let folder = try statementFolder(batchId)
        defer { try? manager.removeItem(at: folder) }
        guard let files = try? manager.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil) else { return [] }
        let numbered = files.compactMap { file -> (Int, URL)? in
            guard file.pathExtension == "json", let n = Int(file.deletingPathExtension().lastPathComponent) else { return nil }
            return (n, file)
        }.sorted { $0.0 < $1.0 }
        let decoder = JSONDecoder()
        return numbered.compactMap { _, file in
            guard let data = try? Data(contentsOf: file) else { return nil }
            return try? decoder.decode(StatementImage.self, from: data)
        }
    }

    /// Deletes statement batches (and half-written ones) older than `statementBatchLifetime`.
    static func sweepStatementBatches(in folder: URL, now: Date = Date()) {
        let manager = FileManager.default
        guard let entries = try? manager.contentsOfDirectory(
            at: folder, includingPropertiesForKeys: [.creationDateKey], options: [])
        else { return }
        for entry in entries {
            let name = entry.lastPathComponent
            guard name.hasPrefix("statement-") || name.hasPrefix(".statement-") else { continue }
            let created = (try? entry.resourceValues(forKeys: [.creationDateKey]).creationDate) ?? .distantPast
            if now.timeIntervalSince(created) > statementBatchLifetime {
                try? manager.removeItem(at: entry)
            }
        }
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
