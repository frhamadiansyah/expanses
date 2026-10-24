import Capacitor
import CoreNFC
import Foundation

/**
 * `EmoneyReader` — a diagnostic that reads an e-money card held to the phone: SELECT the application, then the
 * balance and the card number (and a "card attribute"), and hand each raw answer back to the web layer. A spike.
 *
 * The commands are public and unauthenticated. Mandiri e-money answers ISO 7816-4 over ISO-DEP; the AID is
 * `0000000000000001`, and the balance/card-number/attribute reads carry no key and need no authentication — see the
 * MIT-licensed https://github.com/agusibrahim/prepaidcard_reader (android/.../bmandirinfc/EMoney.java) and
 * https://github.com/felixtandian/emoneyReader (lib/emoneyUtils.dart). Only the command bytes were taken from them.
 *
 * READ-ONLY, enforced here and nothing can go round it: every command is checked against `allowed` before it is
 * transmitted. The list holds exactly the four reads this diagnostic sends — SELECT (A4, a read that chooses a file)
 * and the three proprietary reads (B5 balance, B3 card number, F2 attribute). No write (D0/D2/D6/DC/E2/0E),
 * authenticate (20/24/82/84/88) or purse debit/top-up command is on the list, so none can ever be sent. The card
 * holds money; a stray write could change what is on it, which is why the gate is a fixed allowlist, not a filter.
 *
 * Rejection codes the page reads: `unavailable` (no Core NFC), `cancelled` (sheet dismissed), `busy`, `no_session`,
 * `refused` (a command not on the allowlist — should never happen, the web layer sends the same four), `failed`.
 */
@available(iOS 13.0, *)
@objc(EmoneyReaderPlugin)
public class EmoneyReaderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "EmoneyReaderPlugin"
    public let jsName = "EmoneyReader"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "begin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "transmit", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
    ]

    /**
     * The only commands that may leave the phone, as upper-case hex. Exactly the four fixed `COMMANDS` the web layer
     * sends (apps/web/src/features/capture/emoney/apdu.ts). A command not in this set — and not the one record shape
     * below — is refused before it is transmitted.
     */
    private static let allowed: Set<String> = [
        "00A4040008" + "0000000000000001", // SELECT the e-money application by AID
        "00B500000A", // balance (proprietary read, no data)
        "00B300003F", // card number (proprietary read, no data)
        "00F210000B", // card attribute (proprietary read, no data)
    ]

    /**
     * Owner-supplied standard ISO read, read-only, on the owner's own card, no authentication bypassed: READ RECORD
     * (INS B2) of a record by number in short file 1 (P2 0C), `00 B2 nn 0C 00`. Admitted only in exactly this shape —
     * CLA 00, INS B2, any record number, P2 0C, one Le byte — so no other SFI, record mode or data field can be sent.
     */
    private static func isAllowedRecordRead(_ hex: String) -> Bool {
        hex.range(of: "^00B2[0-9A-F]{2}0C[0-9A-F]{2}$", options: .regularExpression) != nil
    }

    private var session: NFCTagReaderSession?
    private var tag: NFCISO7816Tag?
    private var beginCall: CAPPluginCall?

    @objc func available(_ call: CAPPluginCall) {
        let ok = NFCTagReaderSession.readingAvailable
        call.resolve(["available": ok, "reason": ok ? NSNull() : "NFC is not available on this device"])
    }

    /// Opens a reader session and resolves once an ISO7816 tag is connected, or rejects if the sheet is dismissed.
    @objc func begin(_ call: CAPPluginCall) {
        guard NFCTagReaderSession.readingAvailable else {
            call.reject("NFC is not available on this device", "unavailable")
            return
        }
        guard beginCall == nil, session == nil else {
            call.reject("A card read is already in progress.", "busy")
            return
        }
        guard let session = NFCTagReaderSession(pollingOption: .iso14443, delegate: self, queue: .main) else {
            call.reject("The reader could not start.", "failed")
            return
        }
        call.keepAlive = true
        beginCall = call
        self.session = session
        session.alertMessage = "Hold the e-money card to the top of the phone."
        session.begin()
    }

    /// Sends one command — only if it is on the allowlist — and hands back the answer split into data and SW.
    @objc func transmit(_ call: CAPPluginCall) {
        guard let apdu = call.getString("apdu")?.uppercased(), let bytes = Self.hexToData(apdu) else {
            call.reject("Not a command.", "failed")
            return
        }
        guard Self.allowed.contains(apdu) || Self.isAllowedRecordRead(apdu) else {
            // The read-only gate: a command that is not one of the fixed reads or the one record shape is never sent.
            call.reject("That command is not an allowed read.", "refused")
            return
        }
        guard let tag = tag, let command = NFCISO7816APDU(data: bytes) else {
            call.reject("No card is connected.", "no_session")
            return
        }
        tag.sendCommand(apdu: command) { data, sw1, sw2, error in
            if let error = error {
                call.reject("The card did not answer.", "failed", error)
                return
            }
            let sw = String(format: "%02X%02X", sw1, sw2)
            call.resolve(["data": Self.dataToHex(data), "sw": sw])
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        let message = call.getString("message")
        DispatchQueue.main.async {
            if let message = message { self.session?.alertMessage = message }
            self.session?.invalidate()
            self.finishSession()
            call.resolve()
        }
    }

    /// Lets go of the session, the tag and any waiting `begin` call. Safe to call more than once.
    private func finishSession() {
        session = nil
        tag = nil
        beginCall = nil
    }

    private static func hexToData(_ hex: String) -> Data? {
        guard hex.count % 2 == 0 else { return nil }
        var data = Data(capacity: hex.count / 2)
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            guard let byte = UInt8(hex[index..<next], radix: 16) else { return nil }
            data.append(byte)
            index = next
        }
        return data
    }

    private static func dataToHex(_ data: Data) -> String {
        data.map { String(format: "%02X", $0) }.joined()
    }
}

@available(iOS 13.0, *)
extension EmoneyReaderPlugin: NFCTagReaderSessionDelegate {
    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        DispatchQueue.main.async {
            if let call = self.beginCall {
                // A user-dismissed sheet is not a failure the page should shout about.
                let nfc = error as? NFCReaderError
                if nfc?.code == .readerSessionInvalidationErrorUserCanceled {
                    call.reject("Cancelled", "cancelled")
                } else {
                    call.reject(error.localizedDescription, "failed", error)
                }
            }
            self.finishSession()
        }
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard case let .iso7816(iso) = tags.first else {
            session.restartPolling()
            return
        }
        session.connect(to: tags.first!) { error in
            if let error = error {
                session.invalidate(errorMessage: "The card could not be read.")
                DispatchQueue.main.async {
                    self.beginCall?.reject(error.localizedDescription, "failed", error)
                    self.finishSession()
                }
                return
            }
            DispatchQueue.main.async {
                self.tag = iso
                session.alertMessage = "Reading the card…"
                let call = self.beginCall
                self.beginCall = nil
                call?.resolve()
            }
        }
    }
}
