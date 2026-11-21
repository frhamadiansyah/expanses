import { dropStandbyOffer, markStandbyDone, offerStandby, type SelfEngine, SharingError, standbyGone, standbyOffers, standbyWanted, SyncTransportError } from '@expanses/db';
import type { SyncService } from './sync-service';

/*
 * Link my devices, Drop 5 (spec §3.4): after each run of the owner's own channel. On the seat, every other linked
 * device is invited into each workspace shared with someone else, as a device of the owner's own member; on every
 * other device, the seat's invites for it are claimed — it stands by, ready to take over if the seat is lost.
 */
export async function standbyStep(sync: SyncService, engine: SelfEngine, inviterName: string, deviceName: string): Promise<void> {
  const seat = await engine.seat();
  const me = engine.deviceId;
  if (!seat) return;
  const database = sync.database;
  if (seat === me) {
    const household = await sync.engine();
    // An unlinked device leaves the shared workspaces too: it keeps its own data, never the household's.
    await removeGone(household, await standbyGone(database, me));
    for (const wanted of await standbyWanted(database, me)) {
      try {
        const invite = await household.linkDevice(wanted.bookId, { inviterName });
        await offerStandby(database, wanted.relayBookId, wanted.deviceId, invite.code, Date.now());
      } catch (error) {
        console.warn('A standby invite could not be made; tried again after the next run', error);
      }
    }
    return;
  }
  const household = await sync.engine();
  for (const offer of await standbyOffers(database, me)) {
    try {
      await household.claimStandby(offer.code, { deviceName });
      await markStandbyDone(database, offer.relayBookId);
    } catch (error) {
      // Used or run out: the seat is asked for a fresh one. Anything else is tried again after the next run.
      if (error instanceof SharingError && (error.code === 'INVITE_CLAIMED' || error.code === 'INVITE_EXPIRED')) await dropStandbyOffer(database, offer.relayBookId, me);
      else throw error;
    }
  }
}

/**
 * Each unlinked device out of each shared workspace, one at a time: one that fails is tried again after the next run
 * and holds up none of the others. One the relay no longer has (404) is gone already: the removal in the log is read
 * in, and it is done.
 */
export async function removeGone(
  household: { removeDevice: (bookId: string, deviceId: string) => Promise<void>; syncOnce: (bookId: string) => Promise<unknown> },
  gone: readonly { bookId: string; deviceId: string }[],
): Promise<void> {
  for (const { bookId, deviceId } of gone) {
    try {
      await household.removeDevice(bookId, deviceId);
    } catch (error) {
      if (error instanceof SyncTransportError && error.status === 404) await household.syncOnce(bookId).catch(() => undefined);
      else console.warn('An unlinked device could not be taken out of a shared workspace; tried again after the next run', error);
    }
  }
}
