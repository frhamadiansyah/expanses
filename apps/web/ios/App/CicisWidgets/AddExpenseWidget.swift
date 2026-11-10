import SwiftUI
import WidgetKit

/// Home screen (small) and lock screen (circular): one tap opens One line. Nothing on it changes, so the timeline is a
/// single static entry, and it never shows an amount.
struct AddExpenseWidget: Widget {
    static let kind = "com.cicis.app.widgets.add"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: AddExpenseProvider()) { _ in
            AddExpenseView()
        }
        .configurationDisplayName("Add expense")
        .description("Opens One line.")
        .supportedFamilies([.systemSmall, .accessoryCircular])
    }
}

struct AddExpenseEntry: TimelineEntry {
    let date: Date
}

struct AddExpenseProvider: TimelineProvider {
    func placeholder(in context: Context) -> AddExpenseEntry {
        AddExpenseEntry(date: .now)
    }

    func getSnapshot(in context: Context, completion: @escaping (AddExpenseEntry) -> Void) {
        completion(AddExpenseEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<AddExpenseEntry>) -> Void) {
        completion(Timeline(entries: [AddExpenseEntry(date: .now)], policy: .never))
    }
}

struct AddExpenseView: View {
    @Environment(\.widgetFamily) private var family

    var body: some View {
        content
            .widgetURL(URL(string: "cicis://add/line"))
    }

    @ViewBuilder
    private var content: some View {
        switch family {
        case .accessoryCircular:
            // The lock screen: a ＋ only.
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "plus")
                    .font(.system(size: 26, weight: .semibold))
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Add expense")
            .containerBackground(for: .widget) { Color.clear }
        default:
            VStack(spacing: 8) {
                Image(systemName: "plus")
                    .font(.system(size: 40, weight: .semibold))
                Text("Add expense")
                    .font(.headline)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .containerBackground(.fill.tertiary, for: .widget)
        }
    }
}
