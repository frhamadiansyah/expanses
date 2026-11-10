import Foundation

/**
 * The small "this month's spending" summary the medium home screen widget may show, kept in the App Group's shared
 * defaults so the widget extension can read what the app wrote.
 *
 * Compiled into both the App target (the plugin writes) and the widget target (the widget reads), so it uses nothing
 * beyond Foundation.
 *
 * Off by default: until the switch is turned on nothing is written, and turning it off erases what was there. A summary
 * carries its month, and `current(now:)` gives it only for the month `now` is in, so a summary from a month that has
 * ended is never shown as this month's spending.
 */
enum WidgetSummaryStore {
    static let suite = "group.com.cicis.app"           // the existing App Group
    static let enabledKey = "widget.totals.enabled"
    static let summaryKey = "widget.totals.summary"

    struct Summary: Codable {
        let bookId: String
        let month: String          // yyyy-MM
        let amountMinor: Int
        let currency: String
        let amountText: String
        let sharePercent: Int?
        let writtenAt: String      // ISO 8601
    }

    private static var defaults: UserDefaults? { UserDefaults(suiteName: suite) }

    /** False when never set. */
    static var isEnabled: Bool { defaults?.bool(forKey: enabledKey) ?? false }

    /** Turning it off erases the summary at once. */
    static func setEnabled(_ on: Bool) {
        defaults?.set(on, forKey: enabledKey)
        if !on { erase() }
    }

    /** Ignored while switched off, so nothing reaches the App Group before the owner asks for it. */
    static func write(_ summary: Summary) {
        guard isEnabled, let data = try? JSONEncoder().encode(summary) else { return }
        defaults?.set(data, forKey: summaryKey)
    }

    static func erase() {
        defaults?.removeObject(forKey: summaryKey)
    }

    /** The summary only when switched on and written for the month `now` is in (yyyy-MM, Calendar.current). */
    static func current(now: Date) -> Summary? {
        guard isEnabled,
              let data = defaults?.data(forKey: summaryKey),
              let summary = try? JSONDecoder().decode(Summary.self, from: data),
              summary.month == monthKey(now) else { return nil }
        return summary
    }

    /** `yyyy-MM` for the month `date` is in, by the device's calendar and time zone. */
    static func monthKey(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.year, .month], from: date)
        return String(format: "%04d-%02d", parts.year ?? 0, parts.month ?? 0)
    }
}
