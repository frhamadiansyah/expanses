import AppIntents
import Foundation

/// The Shortcuts action a notification automation calls: it writes the notification down and says where it went,
/// without opening the app.
///
/// The owner maps the trigger's variables — Title, Body, App, Date — into these parameters once. The capture waits
/// in the App Group until the app drains it; nothing leaves the phone, and the app does not have to be open.
struct LogNotificationIntent: AppIntent {
    static let title: LocalizedStringResource = "Log notification"
    static let description = IntentDescription("Saves a notification to Expanses' To-review inbox. Nothing leaves the phone.")
    static let openAppWhenRun = false

    @Parameter(title: "Title")
    var title: String?

    @Parameter(title: "Body")
    var body: String?

    @Parameter(title: "App")
    var app: String?

    @Parameter(title: "Date")
    var date: Date?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let named = app?.trimmingCharacters(in: .whitespacesAndNewlines)
        let capture = RawCapture(
            id: UUID().uuidString,
            kind: "notification",
            capturedAt: CaptureClock.stamp(date ?? Date()),
            app: named?.isEmpty == false ? named : nil,
            title: title,
            body: body,
            lines: [],
            imageFile: nil
        )
        try HoldingArea.write(capture: capture)
        return .result(dialog: "Saved to review")
    }
}
