import { minorToMajorString, type ReceiptFill, readReceipt } from '@expanses/core';
import { native } from '../../capture/native';
import type { FormDraft } from './tx-form';

/** The fields a receipt can fill, in the words the line under the card names them. */
export type ReceiptField = 'amount' | 'note' | 'date';

/** What a receipt filled, and what those fields held before: Undo puts exactly that back. */
export interface ReceiptFilled {
  fields: ReceiptField[];
  before: Pick<FormDraft, 'amount' | 'currency' | 'description' | 'occurredOn'>;
}

/**
 * A receipt read onto the form: only what is still empty is filled, so nothing typed is ever overwritten. The date
 * counts as empty while it is still today, the day the form opens on; a receipt dated in the future is not believed.
 * The amount goes in only in the currency it can be read in — the paying account's, or one the form may be switched
 * to — and is left alone otherwise.
 */
export function applyReceipt(
  draft: FormDraft,
  fill: ReceiptFill,
  o: { postingCurrency: string; today: string; foreignAllowed: boolean },
): { next: FormDraft; filled: ReceiptFilled | null } {
  const before = { amount: draft.amount, currency: draft.currency, description: draft.description, occurredOn: draft.occurredOn };
  const patch: Partial<FormDraft> = {};
  const fields: ReceiptField[] = [];
  if (draft.amount.trim() === '' && fill.amountMinor !== null && fill.amountMinor > 0) {
    const same = fill.currency === o.postingCurrency;
    if (same || o.foreignAllowed) {
      patch.amount = minorToMajorString(fill.amountMinor, fill.currency);
      if (!same) patch.currency = fill.currency;
      fields.push('amount');
    }
  }
  if (draft.description.trim() === '' && fill.name) {
    patch.description = fill.name;
    fields.push('note');
  }
  if (fill.date && draft.occurredOn === o.today && fill.date < o.today) {
    patch.occurredOn = fill.date;
    fields.push('date');
  }
  return fields.length === 0 ? { next: draft, filled: null } : { next: { ...draft, ...patch }, filled: { fields, before } };
}

/** The line under the card: "Filled from the receipt: amount, note, date." */
export const filledLine = (fields: readonly ReceiptField[]): string => `Filled from the receipt: ${fields.join(', ')}. Check them.`;

/** A picture's bytes as base64, for the phone to read. */
function base64Of(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
    reader.onerror = () => reject(reader.error ?? new Error('That photo could not be opened'));
    reader.readAsDataURL(file);
  });
}

/**
 * Reads a receipt photo on the phone (Apple's text recognition, nothing leaves the device). Null when it is not a
 * picture, when this device cannot read pictures, or when the picture holds no figure: the photo is attached either
 * way, and a receipt that could not be read simply fills nothing.
 */
export async function readReceiptPhoto(file: File, currency: string): Promise<ReceiptFill | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const { lines } = await native.recognizeImage({ base64: await base64Of(file) });
    return readReceipt(lines, currency, new Date().toISOString());
  } catch {
    return null;
  }
}
