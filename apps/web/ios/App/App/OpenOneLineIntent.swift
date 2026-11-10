import AppIntents
import Foundation

/// The Control Center "Add expense" button's action: it opens the app on One line through `cicis://add/line`.
///
/// Compiled into both the App target and the CicisWidgets target. The control lives in the widget extension, but the
/// system runs an intent that opens the app in the app's process, so both have to know it.
@available(iOS 18.0, *)
struct OpenOneLineIntent: AppIntent {
    static let title: LocalizedStringResource = "Add expense"
    static let openAppWhenRun = true

    func perform() async throws -> some IntentResult & OpensIntent {
        .result(opensIntent: OpenURLIntent(URL(string: "cicis://add/line")!))
    }
}
