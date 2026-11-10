import SwiftUI
import WidgetKit

/// The widgets only open the app: One line, Receipt or Paste through `cicis://add/...`. The medium one may also show
/// this month's spending, and only when that is switched on in the app (WidgetSummaryStore).
@main
struct CicisWidgetsBundle: WidgetBundle {
    var body: some Widget {
        AddExpenseWidget()
        QuickAddWidget()
        // Control Center controls arrived in iOS 18. On iOS 17 the control is simply not offered.
        if #available(iOSApplicationExtension 18.0, *) {
            AddExpenseControl()
        }
    }
}
