import { type CreatedInvite, type MoveRefusal, ownerScope } from '@expanses/db';
import { useApp } from '../../app/context';
import { useResolveRates } from '../../lib/queries';
import { thisDeviceName } from '../sharing/SharingSection';
import { finishConversion, markConversionDone, runShare, type ShareProgress } from './share-event';
import { conversionSteps, fetchConversionRates } from './shared-queries';

export interface ShareEventNowInput {
  eventId: string;
  /** What this person is called in the event. */
  personName: string;
  currency: string;
  /** People without the app, by name. */
  names?: readonly string[];
}

/**
 * Sharing one existing event (shared events §6), as the event's Share sheet does it and the share list does for each
 * event ticked: the rates every move needs first, then the relay book, the conversion and the invite, each at most
 * once for the `progress` given (`runShare`). Null while a run for the same progress is under way.
 */
export function useShareEventNow(): (input: ShareEventNowInput, progress: ShareProgress) => Promise<{ invite: CreatedInvite; kept: MoveRefusal[] } | null> {
  const { database, ws, sync } = useApp();
  const resolveRates = useResolveRates();
  return async (input, progress) => {
    await fetchConversionRates(database, ws, input.eventId, input.currency, resolveRates);
    return runShare(progress, {
      share: async () =>
        (
          await sync.shareEvent(ownerScope(ws), {
            eventId: input.eventId,
            currency: input.currency,
            personName: input.personName,
            deviceName: thisDeviceName(),
            names: (input.names ?? []).map((n) => n.trim()).filter(Boolean),
          })
        ).bookId,
      // Safe to run again (I9): a retry after a conversion cut short part-way never copies the plan twice.
      convert: async () => {
        const kept = await finishConversion(conversionSteps(database, ws, input.eventId));
        markConversionDone(input.eventId);
        return kept;
      },
      invite: (bookId) => sync.eventInvite(bookId, input.personName),
    });
  };
}
