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
        bridge?.registerPluginInstance(FileExportPlugin())
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

#if targetEnvironment(macCatalyst)
/**
 * `FileExport` — the Mac's own Save window for a file the app made (a backup): the share menu Mac Catalyst offers has no
 * plain "Save", so a backup handed to it could only be sent somewhere or cancelled ("Share canceled", owner 22 Nov
 * 2026). `exportFile({ path })` takes a file URL the app already wrote and shows the system Save panel for a copy of it;
 * it resolves once saved and rejects with "Save canceled" when the panel is closed without saving.
 */
@objc(FileExportPlugin)
public class FileExportPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "FileExportPlugin"
    public let jsName = "FileExport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "exportFile", returnType: CAPPluginReturnPromise),
    ]

    /** The call waiting on the panel; one at a time. */
    private var pending: CAPPluginCall?

    @objc func exportFile(_ call: CAPPluginCall) {
        guard let path = call.getString("path"), let url = URL(string: path), url.isFileURL else {
            call.reject("No file to save")
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                call.reject("No window to save from")
                return
            }
            self.pending?.reject("Save canceled")
            self.pending = call
            let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
            picker.delegate = self
            presenter.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        pending?.resolve(["saved": true])
        pending = nil
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.reject("Save canceled")
        pending = nil
    }
}
#endif
