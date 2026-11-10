import SwiftUI
import WidgetKit

/// Home screen (medium): three ways in, One line, Receipt and Paste. Under them, this month's spending, only when it
/// is switched on in the app and the summary the app wrote is for the month it is now.
struct QuickAddWidget: Widget {
    static let kind = "com.cicis.app.widgets.quick"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: Self.kind, provider: QuickAddProvider()) { entry in
            QuickAddView(entry: entry)
        }
        .configurationDisplayName("Quick add")
        .description("Opens One line, Receipt or Paste.")
        .supportedFamilies([.systemMedium])
    }
}

struct QuickAddEntry: TimelineEntry {
    let date: Date
    /// Nil when switched off, never written, or written for another month.
    let summary: WidgetSummaryStore.Summary?
}

struct QuickAddProvider: TimelineProvider {
    func placeholder(in context: Context) -> QuickAddEntry {
        QuickAddEntry(date: .now, summary: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (QuickAddEntry) -> Void) {
        let now = Date.now
        completion(QuickAddEntry(date: now, summary: WidgetSummaryStore.current(now: now)))
    }

    /// The app reloads the timeline whenever it writes, so the policy is `.never`. A second entry at the start of next
    /// month reads the summary again for that month, which gives nil for a summary written this month: if the app is
    /// not opened before the month ends, the widget drops the line instead of showing last month's spending as this
    /// month's.
    func getTimeline(in context: Context, completion: @escaping (Timeline<QuickAddEntry>) -> Void) {
        let now = Date.now
        var entries = [QuickAddEntry(date: now, summary: WidgetSummaryStore.current(now: now))]
        if let nextMonth = Calendar.current.dateInterval(of: .month, for: now)?.end {
            entries.append(QuickAddEntry(date: nextMonth, summary: WidgetSummaryStore.current(now: nextMonth)))
        }
        completion(Timeline(entries: entries, policy: .never))
    }
}

struct QuickAddView: View {
    let entry: QuickAddEntry

    var body: some View {
        VStack(spacing: 10) {
            HStack(spacing: 8) {
                QuickAddButton(title: "＋ Type", link: "cicis://add/line")
                QuickAddButton(title: "Receipt", link: "cicis://add/receipt")
                QuickAddButton(title: "Paste", link: "cicis://add/paste")
            }
            if let summary = entry.summary {
                Text(Self.spentLine(summary))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    // Redacted by iOS while the device is locked: the buttons stay, the figure does not.
                    .privacySensitive()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .containerBackground(.fill.tertiary, for: .widget)
    }

    static func spentLine(_ summary: WidgetSummaryStore.Summary) -> String {
        var line = "\(summary.amountText) spent this month"
        if let p = summary.sharePercent {
            line += " · \(p)% of budget"
        }
        return line
    }
}

private struct QuickAddButton: View {
    let title: String
    let link: String

    var body: some View {
        Link(destination: URL(string: link)!) {
            Text(title)
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(.fill.secondary, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
    }
}
