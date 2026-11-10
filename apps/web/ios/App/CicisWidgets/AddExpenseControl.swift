import AppIntents
import SwiftUI
import WidgetKit

/// Control Center, the lock screen's bottom buttons and the Action button (iOS 18 and later): opens One line.
@available(iOS 18.0, *)
struct AddExpenseControl: ControlWidget {
    static let kind = "com.cicis.app.widgets.control.add"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: OpenOneLineIntent()) {
                Label("Add expense", systemImage: "plus")
            }
        }
        .displayName("Add expense")
    }
}
