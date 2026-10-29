import type { ReceiptLinesReading } from '@expanses/core';
import type { FormDraft } from './tx-form';

/**
 * The Add form, held while the receipt page is open. The form is a screen of its own, so going to the receipt page
 * unmounts it; the draft waits here and the form takes it back when it opens again, with the With sheet open on
 * the amounts the receipt gave. Nothing here is saved anywhere: it lives as long as the page does.
 */
export interface HeldForm {
  draft: FormDraft;
  /** The currency the bill is divided in: the paying account's. */
  currency: string;
  /** What was just read off a photo; null when Edit reopens a bill already on the draft. */
  reading: ReceiptLinesReading | null;
  /** 'account': the split started from Account (the start page), not from a purchase; back returns there. */
  origin?: 'account';
  /** Handed to a blank New transaction to record, not back to a form waiting on the With sheet. */
  recorded?: boolean;
}

let held: HeldForm | null = null;

export const holdForm = (form: HeldForm): void => {
  held = form;
};
export const heldForm = (): HeldForm | null => held;
export const releaseForm = (): void => {
  held = null;
};
