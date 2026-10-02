# Transaction capture — design

Status: draft for the owner's review, 2026-09-30. Brainstormed with the owner; mockups in
`.superpowers/brainstorm/37661-1790769283/content/` (not committed).

## 1. Purpose

Recording a payment by hand is the slowest part of the app. The owner pays mostly by bank transfer, e-wallet
(GoPay, DANA, OVO…) and card, and every one of those already produces something readable: a push notification, a
success screen, a paper receipt. Capture turns those into **drafts** the owner confirms with one tap.

Three ways in, one pipeline:

| Source | Trigger |
|---|---|
| Notification | iOS Shortcuts personal automation "When I receive a notification" from chosen apps → our **Log notification** action |
| Screen | Our ready-made **Screen scanner** shortcut on Back Tap or the Action Button (takes a screenshot → our **Scan screen** action); the iOS share sheet for an image already saved |
| Paper receipt | The camera, inside the app |

Success: a GoPay payment notification becomes a correct draft with no typing; a BCA transfer screenshot taken with
Back Tap becomes a correct draft after at most one correction the first time and none after; nothing reaches the
books unconfirmed; nothing leaves the phone.

## 2. Decisions (from the brainstorm)

| # | Decision |
|---|---|
| D1 | **Reading happens on the phone only.** Apple's text recognition (Vision) plus our own rules. No cloud, no per-scan cost. Paper receipts are best effort (total and date reliably; merchant when legible). |
| D2 | **Every capture becomes a draft in the To-review inbox** (the existing Review page and `draft_transactions`). Nothing is recorded unconfirmed. |
| D3 | **The account is learned per source.** First capture from a source asks "Which account is this?"; the answer is remembered. Editable in Settings → Capture → Capture sources. |
| D4 | **Duplicates are matched and merged** into the existing draft or recorded transaction (adding missing fields and the image) instead of making a second draft. A merged draft can be unmerged. |
| D5 | **Capture handles every movement**: spent, received, transfer, top-up. An out-and-in pair of the same amount between two of the owner's accounts becomes one transfer draft. A setting chooses **Everything** (default) or **Expenses only** (money in and top-ups are skipped). |
| D6 | **General reader + word lists + learned templates.** The reader finds fields by pattern; one word list per language (Indonesian, English) gives direction, type and promo words; each source learns a template on the phone from the owner's corrections. No bank or e-wallet is named in code (country-neutral rule). |
| D7 | **The picture or original text is always viewable** from a draft, full screen with pinch zoom, with boxes around each field that was read. It is kept while the draft waits (however long), deleted when the draft is resolved unless "Keep photo" attaches it to the transaction. |
| D8 | **Version 1 is iPhone only.** On the Mac the share sheet can still add an image; Shortcuts triggers and Back Tap are iPhone features. |

## 3. The pieces

### 3.1 Native iPhone code (new — the app has none yet)

A small Swift layer inside `apps/web/ios/App`, exposed to the web app through a local Capacitor plugin
(`CapturePlugin`):

- **App Intents** (shown in Shortcuts):
  - `LogNotificationIntent(title, body, app, date)` — the owner maps Shortcuts' notification variables to these.
  - `ScanScreenIntent(image)` — the Screen scanner shortcut passes its screenshot.
  Both run without opening the app's UI.
- **Share extension** accepting one image.
- **Text recognition**: `VNRecognizeTextRequest` (accurate mode, languages `id-ID`, `en-US`), returning lines with
  their text, bounding box (normalised 0–1) and height.
- **Holding area**: intents and the extension cannot reach the app's database, so each writes one capture as a JSON
  file (plus the image file) into an **App Group** container. The plugin's `drainCaptures()` hands them to the web
  app and deletes them once stored.
- **Camera**: the plugin's `scanReceipt()` opens the camera, recognises the photo and returns the same shape.

Capture shape, the one contract between native and web:

```ts
type RawCapture = {
  id: string;                        // uuid made at capture
  kind: 'notification' | 'screen' | 'photo' | 'shared-image';
  capturedAt: string;                // ISO
  app: string | null;                // notification's app name / bundle id
  title: string | null;              // notification only
  body: string | null;               // notification only
  lines: { text: string; box: [number, number, number, number]; height: number }[];  // images only
  imageFile: string | null;          // file name in the app's private capture folder
};
```

### 3.2 Word lists (data, per language)

`packages/core/src/capture/words/{id,en}.ts`: direction and type words (spent: `bayar, pembayaran, transfer ke,
kirim, paid, sent, debit…`; received: `masuk, diterima, dari, received, credit…`; top-up: `top up, isi saldo…`;
refund; promo: `diskon, cashback, voucher, promo, reward, kupon, discount, coupon…`), field labels (`total, jumlah,
nominal, amount, merchant, penerima, recipient…`) and amount shorthands (`rb` = thousand, `jt` = million). No bank
names. Adding a language is adding a file.

### 3.3 The reader (pure, `packages/core/src/capture/read.ts`)

`readCapture(capture, words, template | null) → Reading` where every field carries a confidence 0–100 and, for
images, the line it came from:

1. **Promo check** → `{ skipped: 'promo' }`.
2. **Amount**: every money figure (`Rp 50.000`, `IDR 50,000.00`, `50rb`, `1,2jt`, `$12.50`); prefer one next to a
   label word, then (images) the tallest line, then the largest non-balance figure (a line with a balance word —
   `saldo, balance, sisa` — is never the amount).
3. **Currency**: printed; else the source account's; else the workspace's.
4. **Date/time**: printed (common Indonesian and English forms); else `capturedAt`.
5. **Type**: from direction words; default spent.
6. **Name**: text after `ke/to/di/at/dari/from` or after a merchant/recipient label.
7. With a template: the template's anchors are tried first for each field; the general steps fill the rest.

### 3.4 Capture sources and learning (`packages/db`, local only, never synced)

`capture_sources(id, key, label, account_id, workspace_id, template_json, captured_count, updated_at)`:

- **key**: a notification's app; an image's **fingerprint** = the sorted set of non-numeric words in the top 15% of
  the image (title bar, brand, "Transaksi Berhasil"), plus any masked account digits (`···· 1234`). Two captures
  are the same source when their fingerprints share at least 70% of words.
- **Account and workspace**: set by the first "Which account is this?" answer.
- **Template**: per field, an anchor `{ label: string | null, region: [x, y, w, h] }` — the label text on the
  same or previous line, and the rough place. Written when the owner corrects a field whose value appears on a
  line of the capture; the matching line gives the anchor. A template anchor that is not found falls back to the
  general reader, and the next correction replaces it.
- The Capture sources screen lists each source with its account and "learned / learning", and offers Reset.

### 3.5 The matcher (`packages/db`)

Before a draft is made, look for a match:

- **Same payment, two captures** (notification + screenshot, or two screenshots): same amount, same account (or
  either unknown), capture times within **15 minutes** → merge into the existing draft; if it is already recorded,
  attach the image to that transaction and drop the capture.
- **Transfer pair**: one capture "out" of account A and one "in" to account B (both the owner's), same amount,
  within **1 day** → one transfer draft A → B.
- **Already recorded by hand**: same amount and account, same day, recorded transaction with no capture yet →
  offer "Looks like one you added" on the draft with **Link** (attach) or **Keep separate**. Never auto-merged into
  a hand-entered transaction.
- A merged draft lists "Seen in …" with **Unmerge**, which splits the last capture back into its own draft.

### 3.6 The inbox (existing Review page, extended)

- `draft_transactions` gains: `kind` (`expense | income | transfer`), `to_account_id` (transfers), `source_id`
  (capture source), `capture_ids` (JSON list), `image_file`, `reading_json` (fields, confidences, line boxes). The
  existing `source` enum gains `notification`, `screen`, `photo`.
- Rows show a source icon (🔔 notification, 📱 screenshot, 🧾 photo) and "merged" hints; swipe right adds, left
  discards, as today. A draft that still needs an answer (no account, low-confidence amount) opens its sheet.
- The sheet: the picture (tap → full-screen viewer with pinch zoom and a labelled box per read field; tapping a field
  on the sheet jumps to its box; a notification shows its original text), "Which account is this?" for a new source,
  yellow for unsure fields, "Keep photo" (on by default for photos, off for screenshots).
- "Skipped (N)" at the foot lists captures skipped as promos or by Expenses-only in the last 7 days, each with
  **Bring back**.
- Adding a transfer draft records a normal transfer; income and expense as today.

### 3.7 Settings → Capture

Setup guides for Notifications (the Shortcuts automation steps, "Open Shortcuts" button, minimum iOS shown),
Screen scanner ("Add shortcut" opens our shortcut link, then Back Tap / Action Button steps), Scan a receipt; the
**Everything / Expenses only** switch; the Capture sources list.

## 4. Data flow

1. A trigger fires → native code writes a `RawCapture` (+ image) to the App Group holding area.
2. The app becomes active (or is already open) → `drainCaptures()` → each capture: find its source → `readCapture`
   with the source's template → skip (promo / Expenses only; kept in the Skipped list 7 days) or → matcher → merge
   or new draft. The image moves into the app's private capture folder.
3. The owner reviews → corrections update the source (account, template) → Add records the transaction (with the
   image if "Keep photo") → the draft's raw text and image are deleted (existing purge path).

## 5. Privacy

- Nothing leaves the phone. No network call anywhere in capture.
- Captures, images, sources and templates are local and never synced. In a shared workspace a draft reaches the
  partner only after Add, as an ordinary transaction.
- Raw notification text and images are deleted when the draft is resolved (unless kept as the transaction's photo);
  skipped captures after 7 days.
- The notification automation only sends notifications from apps the owner picks in Shortcuts.

## 6. What goes wrong

- App not open when a shortcut runs → the capture waits in the holding area; processed on next open.
- Nothing readable → a draft marked "Couldn't read this" with the picture; the owner fills or discards it.
- Wrong amount (e.g. a balance) → visible in the viewer; correcting it teaches the template.
- Promo skipped wrongly → Skipped list → Bring back.
- Wrong merge → Unmerge.
- iOS too old for the notification trigger → the guide says so; Screen scanner and camera still work.
- A holding-area file that cannot be parsed → moved aside and shown once as "1 capture couldn't be opened".

## 7. Testing

- Reader: a corpus of made-up or anonymised notifications and receipt line sets (Indonesian and English) with
  expected readings; fast-check properties for amount parsing (thousand separators, decimals, `rb`/`jt`).
- Learning: correct a field → next capture from the same fingerprint reads it; a moved label → fallback → re-learn.
- Matcher: notification + screenshot merge; transfer pair; two real same-amount purchases 2 hours apart stay two;
  unmerge; link to a hand-entered transaction.
- Native: an XCTest for the text recognition wrapper on bundled sample images; a device checklist for the two
  intents, the share extension and the camera.
- E2E (Playwright): captures injected through a test hook into the drain path → Review → add, merge, teach, viewer.

## 8. Build order

1. Core reader + word lists + corpus tests.
2. Capture sources, templates, matcher, draft columns (migration).
3. Review page: new kinds, source icons, "Which account?", viewer, Skipped list, Unmerge.
4. Native plugin: text recognition + camera (`scanReceipt`), drain path.
5. App Intents (Log notification, Scan screen), share extension, App Group holding area, the shortcut file.
6. Settings → Capture guides; device checklist; TestFlight.

## 9. Out of scope

- Cloud reading of any kind (D1).
- Android notification listening; Mac triggers (D8).
- Line items on paper receipts (only the total).
- Bank email alerts; Apple Wallet transaction sync (possible later via the Shortcuts "Transaction" automation).
- Voice entry (possible later with the same reader).
