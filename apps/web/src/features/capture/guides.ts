/**
 * How capture gets its kinds of input, as the steps to follow on the phone.
 *
 * They are data rather than markup so they can be checked: the country-neutral rule says no bank, wallet or
 * merchant is named anywhere in capture, and a settings guide is exactly where a name would sneak in. Each step
 * is one thing to do, in order — a guide is read with the phone in the other hand.
 */

export interface CaptureGuide {
  key: 'notifications' | 'email' | 'share-message' | 'screen-scanner' | 'receipt';
  title: string;
  blurb: string;
  /** What the guide needs that a browser does not have, when there is something to say. */
  note?: string;
  steps: string[];
}

/**
 * The ready-made Screen scanner shortcut, shared from iCloud: one tap on "Add Shortcut" instead of building it.
 * Shared from the owner's phone (two actions: Take Screenshot → Scan screen, Show When Run off). The button and its
 * step appear only while this is a valid iCloud shortcut link.
 */
export const SCREEN_SCANNER_SHORTCUT_URL: string | null = 'https://www.icloud.com/shortcuts/47b31df6ffff48c680affd71b3971cef';

/** Whether a link is an iCloud shared shortcut, the only kind the Add button may open. */
export function isShortcutLink(url: string): boolean {
  return /^https:\/\/www\.icloud\.com\/shortcuts\/[0-9a-f]{32}$/i.test(url);
}

const scannerSteps = (link: string | null): string[] => [
  ...(link
    ? ['Tap “Add Screen scanner” below, then “Add Shortcut”.', 'Or build it by hand: Shortcuts → New → Take Screenshot → Scan screen.']
    : ['Build the shortcut: Shortcuts → New → Take Screenshot → Scan screen.']),
  'Bind it to a gesture: Settings › Accessibility › Touch › Back Tap → double tap → the shortcut. With an Action Button: Settings › Action Button → Shortcut.',
  'Back-tap on any payment screen: the draft appears in Review.',
];

export const CAPTURE_GUIDES: readonly CaptureGuide[] = [
  {
    key: 'notifications',
    title: 'Notifications',
    blurb: 'A payment notification becomes a draft the moment it arrives, without opening anything.',
    note: 'Needs iOS 27 or later: that is the release where Shortcuts gained the notification trigger. Earlier versions do not have it at all — use the Screen scanner instead.',
    steps: [
      'Open Shortcuts and start a new shortcut (+). From iOS 27 a trigger lives inside a shortcut, so there is no Automation tab to go to.',
      'In the editor, open the action library and choose the Automation category, then pick “When I receive a notification”.',
      'Choose the app the notifications come from. Only the apps chosen here are ever read.',
      'Remove the Title, Subtitle and Message filter rows with their ⊖ buttons, or fill them in: while they sit empty the automation cannot be turned on.',
      'Turn “Confirm Before Run” off, so the capture is saved without a tap.',
      'Below the trigger, add the action “Log notification” (search for the app), then tap each of Title, Body, App and Date and insert the matching variable from the trigger. Left empty they capture nothing.',
      'Save, then pay once with that app: the draft appears in Review the next time the app is opened.',
      'If the only notification that card sends is about points or cashback, turn on “Read offers for the purchase” for that source under Capture sources — the purchase is read out of the rewards message.',
    ],
  },
  {
    key: 'email',
    title: 'Bank emails',
    blurb: 'A card transaction email becomes a draft as soon as it arrives in Mail.',
    note: 'Works with the Mail app only: the email automation watches the accounts added there.',
    steps: [
      'Open Shortcuts, go to Automation and tap ＋.',
      'Choose Email, then choose the bank’s sender address under Sender. To keep to transactions, also set Subject Contains to “Transaction”.',
      'Choose “Run Immediately”, so each email is saved without a tap, then tap Next and choose New Blank Automation.',
      'Add the action “Get Details of Mail” and pick Body. Add it three more times, for Subject, Sender and Date Received. In each copy, tap its Mail and choose Shortcut Input: a copy added below another otherwise reads that one’s result instead of the email.',
      'Add the action “Log notification” (search for the app), then set Title to Subject, Body to Body, App to Sender and Date to Date Received.',
      'Tap Done. The next transaction email from that sender is a draft in Review the next time the app is opened.',
      'Each sender is a capture source of its own under Capture sources, the way an app is for notifications.',
    ],
  },
  {
    key: 'share-message',
    title: 'Share a bank message',
    blurb: 'A message that arrives where Shortcuts cannot watch for it becomes a draft with one share.',
    note: 'Works for any app, including WhatsApp Business, whose notifications cannot start a shortcut.',
    steps: [
      'Long-press the bank message in the app it arrived in, then tap Share.',
      'Choose Expanses in the share sheet. If it is not listed, scroll the app row to the end and tap More.',
      '“Saved to review” shows and the sheet closes. The app is not opened.',
      'Open Review: the draft is there, read the same way as a notification.',
    ],
  },
  {
    key: 'screen-scanner',
    title: 'Screen scanner',
    blurb: 'A screenshot of a payment screen is read the moment it is taken.',
    steps: scannerSteps(SCREEN_SCANNER_SHORTCUT_URL),
  },
  {
    key: 'receipt',
    title: 'Scan a receipt',
    blurb: 'Photograph a paper receipt, or choose a picture already taken, and check what was read.',
    steps: [
      'On Review, tap the camera button: “Take photo” for a receipt in hand, “Choose from Photos” for a picture already taken.',
      'Photograph the receipt: flat, in the light, with the total inside the frame.',
      'From Photos, one receipt or payment screen becomes a draft. Two or more screenshots, or one screenshot of a statement page, go to the statement check, which asks which card they belong to.',
      'Check the draft: the total is read.',
      'A receipt photographed in the app is kept with the purchase and saved to Photos as well. A picture chosen from Photos is not kept once recorded: Photos still has it.',
    ],
  },
];
