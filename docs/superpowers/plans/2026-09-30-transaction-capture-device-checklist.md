# Transaction capture — device checklist

Everything here needs the owner's iPhone. The simulator builds and runs the app, but it has no camera, no Back
Tap and no notifications to automate, so these checks wait for a real device. Tick each line once it holds, and
fix the code — not the checklist — when one does not.

## Before starting

- [ ] The app builds for the device with `group.com.cicis.app` in its provisioning profile, and has been opened
      once after install.

## Notifications (Shortcuts automation)

- [ ] Shortcuts → Automation → New → **When I receive a notification** → choose the bank/wallet app → Run
      Immediately → action **Log notification** → map the trigger's Title, Body, App and Date into the action.
- [ ] Trigger it (a small payment, or the app's own test notification): Shortcuts shows "Saved to review".
- [ ] Open Expanses → Review: the capture is a draft with 🔔, the right figure and direction, and asks "Which
      account is this?" the first time.

## Screen scanner (shortcut on Back Tap / Action Button)

- [ ] Add the Screen scanner shortcut. Until the owner shares its iCloud link (recorded below), build it by
      hand: Shortcuts → New → **Take Screenshot** → **Scan screen**.
- [ ] Settings › Accessibility › Touch › Back Tap → double tap → the Screen scanner shortcut (or Action
      Button → Shortcut).
- [ ] Back-Tap on a payment screen, open Expanses: the screenshot is a draft with 📱 and the figure read.

## Receipt photo (camera, from the app)

- [ ] From the add-transaction entry, **Scan a receipt** → photograph a paper receipt with a clear TOTAL.
- [ ] The draft shows the total — not the tax line or a cash-tendered figure — wears 🧾, and its picture opens in
      the viewer.
- [ ] TextRecognizer, on a real picture (Task 6 had no cheap Swift test target, so this stands in for it):
      the lines read off the photo place the total where it belongs; correcting the amount teaches the source
      and the next receipt of the same layout reads it without a correction.

## Share sheet

- [ ] Share a screenshot from Photos → the Expanses entry appears → using it saves the image, and a draft
      appears on the next open.

## Learning and merging

- [ ] Correct one field on the first draft of a source (the amount, or the merchant) → the next screenshot of
      the same source reads the corrected field at confidence 95.
- [ ] Make one payment, then screenshot its notification and its success screen: the two become one draft
      ("Seen in 2 captures"), and Unmerge splits them back.

## A backlog

- [ ] Keep the app closed, trigger five or so captures (notifications and screenshots), then open it: all of
      them arrive, merges across the batch are applied, and the Review badge is right.

## The owner's shortcut link

Record the iCloud link here when the owner shares it, so Settings → Capture can open it:
`TODO(owner): iCloud link for the Screen scanner shortcut`
