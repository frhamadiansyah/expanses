import Capacitor

/// The bridge's view controller, with the app's own capture plugin registered the moment the bridge exists.
///
/// A local plugin is in no package Capacitor scans, so it is handed to the bridge here — before the web layer can
/// ask for it.
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(CapturePlugin())
    }
}
