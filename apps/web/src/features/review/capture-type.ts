/**
 * What kind of thing a capture was, as the owner would name it: an SMS, a WhatsApp message, an app's notification, an
 * email, a screenshot, a photo, a card tapped on the phone.
 *
 * The draft only knows the door it came in by — a notification, a screen, a photo — and a notification is three
 * different things to the person who got it. Which app handed it over tells them apart: the source a notification is
 * filed under is keyed on that app, so the answer is read from the source, with no column of its own to keep.
 *
 * One map holds every kind's word and glyph, so the Review list's rows, the draft's source box and the plain view
 * opened from it name a capture the same way. Email and NFC have a word and a glyph here before anything produces
 * them, so the door that does later has nothing to invent.
 */
import type { CaptureSource, DraftRow } from '@expanses/db';
import { Bell, Camera, type LucideIcon, Mail, MessageCircle, MessageSquare, Nfc, Smartphone } from 'lucide-react';

export type CaptureType = 'sms' | 'whatsapp' | 'notification' | 'email' | 'screenshot' | 'photo' | 'nfc';

/** Each kind's word and its glyph — a plain Lucide one, never an app's own logo. */
export const CAPTURE_TYPES: Record<CaptureType, { word: string; Icon: LucideIcon }> = {
  sms: { word: 'SMS', Icon: MessageSquare },
  whatsapp: { word: 'WhatsApp', Icon: MessageCircle },
  notification: { word: 'Notification', Icon: Bell },
  email: { word: 'Email', Icon: Mail },
  screenshot: { word: 'Screenshot', Icon: Smartphone },
  photo: { word: 'Photo', Icon: Camera },
  nfc: { word: 'NFC', Icon: Nfc },
};

/**
 * Which messaging app a notification came from, by the app it names: the phone's own Messages app (an identifier with
 * `MobileSMS` in it, or the name "Messages") is an SMS, WhatsApp is WhatsApp, and every other app is a notification.
 * Case does not matter, because a shortcut may hand over an identifier or a display name.
 */
export function messageTypeOf(app: string | null): 'sms' | 'whatsapp' | 'notification' {
  const named = app?.trim().toLowerCase() ?? '';
  if (named.includes('mobilesms') || named === 'messages') return 'sms';
  if (named.includes('whatsapp')) return 'whatsapp';
  return 'notification';
}

/**
 * What a draft was, from the door it came in by and the source it was filed under. Null for a draft that is not a
 * capture at all — a statement's row has no kind of its own to show.
 */
export function captureTypeOf(draft: Pick<DraftRow, 'source'>, source: Pick<CaptureSource, 'keyKind' | 'key'> | null): CaptureType | null {
  switch (draft.source) {
    case 'notification':
      // Only a source keyed on an app knows the app; one found by a screen's layout never fronts a notification.
      return messageTypeOf(source?.keyKind === 'app' ? source.key : null);
    case 'screen':
      return 'screenshot';
    case 'photo':
      return 'photo';
    case 'email':
      return 'email';
    default:
      return null;
  }
}
