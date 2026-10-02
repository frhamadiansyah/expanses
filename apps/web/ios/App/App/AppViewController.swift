import Capacitor
import UIKit

/**
 * The app's bridge view controller: Capacitor's own, plus the plugins that live in this project rather than in an
 * npm package. A local plugin is not found by Capacitor's package scan, so it is registered here once the bridge
 * exists — the Capacitor 8 way for an app's own plugins.
 */
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(IdxDownloadPlugin())
        bridge?.registerPluginInstance(CapturePlugin())
    }
}
