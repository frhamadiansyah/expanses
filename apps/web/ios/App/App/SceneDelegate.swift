import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = AppViewController()
        window?.makeKeyAndVisible()

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

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
