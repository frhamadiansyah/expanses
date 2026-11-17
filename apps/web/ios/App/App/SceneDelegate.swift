import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()
        #if targetEnvironment(macCatalyst)
        sizeMacWindow(windowScene)
        #endif

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        openRouteFromLaunchArguments()
    }

    /**
     * SPIKE: `xcrun simctl launch <udid> com.expanses.spike --route /transactions/new` opens a screen on
     * launch. The shell has no address bar, so a route cannot be asked for from the outside any other way,
     * and a URL scheme would put an "Open in Expanses?" alert in front of it that nothing can tap on a
     * simulator. Only the app's own router is touched: the path is pushed and a popstate raised, which is
     * what the router listens to. Tried more than once because the web layer is still opening its database
     * when the scene connects, and only once it lands: a marker on the page, which a reload clears, makes
     * every later try a no-op.
     */
    private func openRouteFromLaunchArguments() {
        let arguments = ProcessInfo.processInfo.arguments
        guard let flag = arguments.firstIndex(of: "--route"), arguments.indices.contains(flag + 1) else { return }
        let path = arguments[flag + 1]
        let safe = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-_.")
        guard path.hasPrefix("/"), path.unicodeScalars.allSatisfy(safe.contains) else { return }
        let js = "if (!window.__spikeRouted) { window.__spikeRouted = true; window.history.pushState(null, '', '\(path)'); window.dispatchEvent(new PopStateEvent('popstate')); }"
        for seconds in [2.0, 3.5, 5.0, 7.0] {
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds) { [weak self] in
                (self?.window?.rootViewController as? CAPBridgeViewController)?.bridge?.eval(js: js)
            }
        }
    }

    #if targetEnvironment(macCatalyst)
    /**
     * The Mac window: never narrower than the width the page draws its sidebar at (768, `usePhone`, plus room for the
     * content), so the Mac always shows the wide layout and never a phone-shaped one. The first time the app opens it
     * is given a desktop size; after that macOS puts it back where and how big it was left.
     */
    private func sizeMacWindow(_ windowScene: UIWindowScene) {
        windowScene.sizeRestrictions?.minimumSize = CGSize(width: 900, height: 600)
        let sizedKey = "macWindowSized"
        guard !UserDefaults.standard.bool(forKey: sizedKey) else { return }
        UserDefaults.standard.set(true, forKey: sizedKey)
        let screen = windowScene.screen.bounds
        let size = CGSize(width: min(1280, screen.width - 80), height: min(860, screen.height - 80))
        let frame = CGRect(x: (screen.width - size.width) / 2, y: (screen.height - size.height) / 2, width: size.width, height: size.height)
        windowScene.requestGeometryUpdate(.Mac(systemFrame: frame)) { error in
            print("The Mac window was not sized: \(error)")
        }
    }
    #endif

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
