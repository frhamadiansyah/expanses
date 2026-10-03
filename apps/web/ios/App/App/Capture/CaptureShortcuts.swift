import AppIntents

/// The two actions as Shortcuts shows them, so an automation can find them by name.
struct CaptureShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: LogNotificationIntent(),
            phrases: ["Log notification in \(.applicationName)"],
            shortTitle: "Log notification",
            systemImageName: "bell.badge"
        )
        AppShortcut(
            intent: ScanScreenIntent(),
            phrases: ["Scan screen in \(.applicationName)"],
            shortTitle: "Scan screen",
            systemImageName: "text.viewfinder"
        )
    }
}
