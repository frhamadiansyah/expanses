import Capacitor
import Foundation
import WidgetKit

/**
 * `WidgetSummary` — the page's way to put this month's spending on the medium home screen widget, or take it off.
 *
 * The web layer decides what the summary says (the figure, its text, the share of the budget, the month) and when it
 * changes. This plugin only keeps it in the App Group through `WidgetSummaryStore` and asks WidgetKit to redraw, so the
 * widget never shows a summary the app did not just write or erase.
 *
 * `write` rejects with `failed` when the summary is not the shape the widget reads.
 */
@objc(WidgetSummaryPlugin)
public class WidgetSummaryPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WidgetSummaryPlugin"
    public let jsName = "WidgetSummary"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "erase", returnType: CAPPluginReturnPromise),
    ]

    /** False until switched on. */
    @objc func getEnabled(_ call: CAPPluginCall) {
        call.resolve(["enabled": WidgetSummaryStore.isEnabled])
    }

    /** Off erases the summary at once. */
    @objc func setEnabled(_ call: CAPPluginCall) {
        WidgetSummaryStore.setEnabled(call.getBool("enabled") ?? false)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /** Ignored by the store while switched off; a bad shape is refused rather than half written. */
    @objc func write(_ call: CAPPluginCall) {
        guard let object = call.getObject("summary"),
              JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let summary = try? JSONDecoder().decode(WidgetSummaryStore.Summary.self, from: data) else {
            call.reject("Not a widget summary.", "failed")
            return
        }
        WidgetSummaryStore.write(summary)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func erase(_ call: CAPPluginCall) {
        WidgetSummaryStore.erase()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}
