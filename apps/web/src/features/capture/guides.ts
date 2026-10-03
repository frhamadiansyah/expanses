/**
 * How capture gets its three kinds of input, as the steps to follow on the phone.
 *
 * They are data rather than markup so they can be checked: the country-neutral rule says no bank, wallet or
 * merchant is named anywhere in capture, and a settings guide is exactly where a name would sneak in. Each step
 * is one thing to do, in order — a guide is read with the phone in the other hand.
 */

export interface CaptureGuide {
  key: 'notifications' | 'screen-scanner' | 'receipt';
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
    blurb: 'Photograph a paper receipt and keep it with the purchase.',
    steps: [
      'From the add-transaction button (+), choose “Scan a receipt”.',
      'Photograph the receipt: flat, in the light, with the total inside the frame.',
      'Check the draft: the total is read, and “Keep photo” is already on for a photographed receipt.',
    ],
  },
];
