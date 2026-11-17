import Capacitor
import UIKit
import WebKit

/**
 * The app's bridge view controller: Capacitor's own, plus the plugins that live in this project rather than in an
 * npm package. A local plugin is not found by Capacitor's package scan, so it is registered here once the bridge
 * exists — the Capacitor 8 way for an app's own plugins.
 */
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(IdxDownloadPlugin())
        bridge?.registerPluginInstance(ICloudBackupPlugin())
        bridge?.registerPluginInstance(CapturePlugin())
        bridge?.registerPluginInstance(WidgetSummaryPlugin())
        bridge?.registerPluginInstance(FormAccessoryBarPlugin())
        #if targetEnvironment(macCatalyst)
        markMacApp()
        #else
        // No Mac reads an NFC card: the plugin is not in the Mac build at all (an iOS-only file in the project).
        bridge?.registerPluginInstance(EmoneyReaderPlugin())
        #endif
    }

    #if targetEnvironment(macCatalyst)
    /**
     * The Mac app (Mac Catalyst) tells the page it is on a Mac before any of the page's own code runs, so the web layer
     * can leave out what only a phone has — the widget, NFC, the capture shortcuts, the screen lock — without a round
     * trip to a plugin (`isMacApp()`, apps/web/src/lib/mac.ts). Capacitor itself says "ios" either way. Added here, once
     * the web view exists and before its first page loads; the controller is the one Capacitor gave the web view.
     */
    private func markMacApp() {
        let marker = WKUserScript(source: "window.__cicisMac = true;", injectionTime: .atDocumentStart, forMainFrameOnly: true)
        webView?.configuration.userContentController.addUserScript(marker)
    }
    #endif
}
