import Capacitor
import ObjectiveC
import UIKit

/**
 * `FormAccessoryBar` — the page's way to take the bar iOS puts over a web form's keyboard (⌃ ⌄ ✓) away, and bring it
 * back. Cashflow's One line asks for it gone while it is open, so its card sits on the keyboard itself; every other form
 * keeps the bar.
 *
 * The web view's content view answers `inputAccessoryView` with that bar. While hidden, its answer is swapped for one
 * that gives none; shown again, the original answer is put back. Only this — no change to how the web view makes room
 * for the keyboard (which is why this is not `@capacitor/keyboard`: loading that plugin hides the bar in every form and
 * removes the web view's own keyboard handling for the whole app).
 */
@objc(FormAccessoryBarPlugin)
public class FormAccessoryBarPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FormAccessoryBarPlugin"
    public let jsName = "FormAccessoryBar"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setVisible", returnType: CAPPluginReturnPromise),
    ]

    /** The content view's own `inputAccessoryView` while the swapped one stands in; nil while the bar shows. */
    private static var original: IMP?

    /** `visible` defaults to true: a call that says nothing leaves the bar as iOS draws it. */
    @objc func setVisible(_ call: CAPPluginCall) {
        let visible = call.getBool("visible") ?? true
        DispatchQueue.main.async { [weak self] in
            Self.setHidden(!visible)
            // The keyboard may already be up (the field focused before this call landed): it is drawn again at once.
            self?.contentView()?.reloadInputViews()
            call.resolve()
        }
    }

    private static func setHidden(_ hidden: Bool) {
        let selector = #selector(getter: UIResponder.inputAccessoryView)
        guard let contentClass = NSClassFromString("WKContentView"),
              let method = class_getInstanceMethod(contentClass, selector) else { return }
        if hidden {
            guard original == nil else { return }
            original = method_getImplementation(method)
            let none: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            let replacement = imp_implementationWithBlock(none)
            // Added on the content view's class itself when it only inherits the method, so no other responder changes.
            if !class_addMethod(contentClass, selector, replacement, method_getTypeEncoding(method)) {
                method_setImplementation(method, replacement)
            }
        } else if let kept = original {
            method_setImplementation(method, kept)
            original = nil
        }
    }

    private func contentView() -> UIView? {
        bridge?.webView?.scrollView.subviews.first { NSStringFromClass(type(of: $0)).hasPrefix("WKContentView") }
    }
}
