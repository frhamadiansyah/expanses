import Capacitor
import Foundation
import Security
import UIKit

/**
 * `ICloudBackup` — the owner's own iCloud Drive as a place to keep the app's backups, and iCloud Keychain as the place
 * to keep the key that locks them.
 *
 * The web layer does everything that decides anything: what goes in a copy, the encryption (WebCrypto, AES-GCM), when a
 * copy is due and which copies to remove. This plugin only moves bytes and keeps the key, so the rules stay in tested
 * TypeScript and the Swift stays small.
 *
 * Files live in the app's iCloud container, under `Documents/`, which iCloud Drive shows as the "cicis" folder. Each
 * file is already encrypted when it arrives here.
 *
 * Every method rejects with a code the page reads: `unavailable` (not signed in to iCloud, or iCloud Drive off for the
 * app), `not_found`, `no_key` (the key a copy names is not in this device's keychain), `failed`.
 */
@objc(ICloudBackupPlugin)
public class ICloudBackupPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "ICloudBackupPlugin"
    public let jsName = "ICloudBackup"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "key", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    /** PERMANENT once shipped, like the bundle id: a new container is a new, empty folder, and the old copies are stranded. */
    static let container = "iCloud.com.cicis.app"
    /** The keychain service the backup keys are filed under. One item per key, named by its id, so two devices never overwrite each other's. */
    static let keyService = "com.cicis.app.icloud-backup-key"
    /** Backups are written here, and nothing else in the container is read. */
    static let suffix = ".cicisbackup"

    /** All file work happens off the main thread: the first call to the container URL can take seconds. */
    private let queue = DispatchQueue(label: "com.cicis.app.icloud-backup", qos: .utility)

    private func folder() -> URL? {
        guard FileManager.default.ubiquityIdentityToken != nil,
              let root = FileManager.default.url(forUbiquityContainerIdentifier: Self.container) else { return nil }
        let documents = root.appendingPathComponent("Documents", isDirectory: true)
        try? FileManager.default.createDirectory(at: documents, withIntermediateDirectories: true)
        return documents
    }

    /** A name the page sent, checked to be one of ours and nothing that walks out of the folder. */
    private func safeName(_ call: CAPPluginCall) -> String? {
        guard let name = call.getString("name"), name.hasSuffix(Self.suffix), !name.contains("/"), !name.hasPrefix(".") else {
            call.reject("Not a backup name.", "failed")
            return nil
        }
        return name
    }

    // MARK: status

    /** Whether there is somewhere to write, and the two facts about this device the page names copies by. */
    @objc func status(_ call: CAPPluginCall) {
        queue.async {
            let available = self.folder() != nil
            DispatchQueue.main.async {
                call.resolve([
                    "available": available,
                    "deviceId": UIDevice.current.identifierForVendor?.uuidString ?? "unknown",
                    "model": UIDevice.current.model,
                ])
            }
        }
    }

    // MARK: list

    /**
     * The name of every backup in the folder, downloaded or not. A file iCloud has not brought down yet may sit on
     * disk as `.<name>.icloud`; it is listed under its real name, and `read` fetches it. Everything the page shows
     * about a copy — when, which device, its size, whether photos are in it — is in the name, so listing never has
     * to download anything.
     */
    @objc func list(_ call: CAPPluginCall) {
        queue.async {
            guard let folder = self.folder() else {
                call.reject("iCloud Drive is not available.", "unavailable")
                return
            }
            let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil, options: [])) ?? []
            var names = Set<String>()
            for url in urls {
                var name = url.lastPathComponent
                if name.hasPrefix("."), name.hasSuffix(".icloud") {
                    name = String(name.dropFirst().dropLast(".icloud".count))
                }
                if name.hasSuffix(Self.suffix) { names.insert(name) }
            }
            call.resolve(["names": Array(names)])
        }
    }

    // MARK: write

    /** Writes `base64` as `name`, replacing a file of that name, through a file coordinator as iCloud expects. */
    @objc func write(_ call: CAPPluginCall) {
        guard let name = safeName(call) else { return }
        guard let base64 = call.getString("base64"), let data = Data(base64Encoded: base64) else {
            call.reject("No bytes to write.", "failed")
            return
        }
        queue.async {
            guard let folder = self.folder() else {
                call.reject("iCloud Drive is not available.", "unavailable")
                return
            }
            let target = folder.appendingPathComponent(name)
            var coordinationError: NSError?
            var writeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forReplacing, error: &coordinationError) { url in
                do { try data.write(to: url, options: .atomic) } catch { writeError = error }
            }
            if let error = coordinationError ?? writeError {
                call.reject(error.localizedDescription, "failed")
            } else {
                call.resolve(["bytes": data.count])
            }
        }
    }

    // MARK: read

    /** Reads `name`, asking iCloud to bring it down first when only its placeholder is here. Gives up after a minute. */
    @objc func read(_ call: CAPPluginCall) {
        guard let name = safeName(call) else { return }
        queue.async {
            guard let folder = self.folder() else {
                call.reject("iCloud Drive is not available.", "unavailable")
                return
            }
            let target = folder.appendingPathComponent(name)
            let placeholder = folder.appendingPathComponent(".\(name).icloud")
            let fm = FileManager.default
            guard fm.fileExists(atPath: target.path) || fm.fileExists(atPath: placeholder.path) else {
                call.reject("That copy is no longer in iCloud.", "not_found")
                return
            }
            /*
             * Asked for either way: older systems keep a `.name.icloud` placeholder, newer ones list a not-yet-downloaded
             * file under its own name with no bytes behind it. The coordinated read below waits for the download too;
             * this loop only covers the placeholder case, where the file itself does not exist until it lands.
             */
            try? fm.startDownloadingUbiquitousItem(at: target)
            let deadline = Date().addingTimeInterval(60)
            while !fm.fileExists(atPath: target.path) && Date() < deadline {
                Thread.sleep(forTimeInterval: 0.25)
            }
            var coordinationError: NSError?
            var data: Data?
            NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: target, options: [], error: &coordinationError) { url in
                data = try? Data(contentsOf: url)
            }
            guard let data else {
                call.reject(coordinationError?.localizedDescription ?? "That copy could not be brought down from iCloud.", "failed")
                return
            }
            call.resolve(["base64": data.base64EncodedString()])
        }
    }

    // MARK: remove

    @objc func remove(_ call: CAPPluginCall) {
        guard let name = safeName(call) else { return }
        queue.async {
            guard let folder = self.folder() else {
                call.reject("iCloud Drive is not available.", "unavailable")
                return
            }
            let target = folder.appendingPathComponent(name)
            var coordinationError: NSError?
            var removeError: Error?
            NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: target, options: .forDeleting, error: &coordinationError) { url in
                do { try FileManager.default.removeItem(at: url) } catch { removeError = error }
            }
            // Already gone is what was asked for.
            if let error = coordinationError ?? removeError, (error as NSError).code != NSFileNoSuchFileError {
                call.reject(error.localizedDescription, "failed")
            } else {
                call.resolve()
            }
        }
    }

    // MARK: key

    /**
     * The key that locks the backups, kept in iCloud Keychain (a synchronizable item) so another device signed in to
     * the same Apple ID can open them and nobody else can.
     *
     * With `keyId`: that key, or `no_key`. Without: any backup key already here, or a new one. Keys are never replaced
     * — each is its own item, named by its id — so a second device that makes a key before the first one's has synced
     * adds a key rather than overwriting the one the older copies need.
     */
    @objc func key(_ call: CAPPluginCall) {
        queue.async {
            if let wanted = call.getString("keyId") {
                if let secret = Self.readKey(account: wanted) {
                    call.resolve(["keyId": wanted, "key": secret.base64EncodedString()])
                } else {
                    call.reject("This device does not have the key for that copy.", "no_key")
                }
                return
            }
            if let (account, secret) = Self.anyKey() {
                call.resolve(["keyId": account, "key": secret.base64EncodedString()])
                return
            }
            var bytes = [UInt8](repeating: 0, count: 32)
            guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
                call.reject("No key could be made.", "failed")
                return
            }
            let secret = Data(bytes)
            let account = UUID().uuidString.lowercased()
            let add: [String: Any] = [
                kSecClass as String: kSecClassGenericPassword,
                kSecAttrService as String: Self.keyService,
                kSecAttrAccount as String: account,
                kSecAttrSynchronizable as String: kCFBooleanTrue!,
                // Synchronizable items cannot be ThisDeviceOnly; after first unlock lets a backup run while locked.
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
                kSecValueData as String: secret,
            ]
            let status = SecItemAdd(add as CFDictionary, nil)
            guard status == errSecSuccess else {
                call.reject("The key could not be kept in the keychain (\(status)).", "failed")
                return
            }
            call.resolve(["keyId": account, "key": secret.base64EncodedString()])
        }
    }

    private static func readKey(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keyService,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: kCFBooleanTrue!,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else { return nil }
        return result as? Data
    }

    /** The oldest backup key here, so every device settles on the same one once the keychain has synced. */
    private static func anyKey() -> (String, Data)? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: keyService,
            kSecAttrSynchronizable as String: kCFBooleanTrue!,
            kSecReturnAttributes as String: true,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitAll,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let items = result as? [[String: Any]] else { return nil }
        let sorted = items.sorted {
            (($0[kSecAttrCreationDate as String] as? Date) ?? .distantFuture) < (($1[kSecAttrCreationDate as String] as? Date) ?? .distantFuture)
        }
        for item in sorted {
            if let account = item[kSecAttrAccount as String] as? String, let data = item[kSecValueData as String] as? Data {
                return (account, data)
            }
        }
        return nil
    }

    // MARK: settings

    /** The app's page in Settings, where iCloud is the first thing an owner can reach from. */
    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }
}
