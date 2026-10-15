import { SharingError } from '@expanses/db';

/** Whether an invite for a person's new phone was refused because the old phone is still in the event (final review C2). */
export function isStillHasPhone(failure: unknown): boolean {
  return failure instanceof SharingError && failure.code === 'STILL_HAS_PHONE';
}

/** The People sheet's line that removes just a person's phones (lost phone, §7); it asks twice, as Remove does. */
export function oldPhoneTitle(name: string, armed: boolean): string {
  return armed ? `Tap again to remove ${name}'s old phone` : `Remove ${name}'s old phone`;
}
