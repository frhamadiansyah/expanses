import { type AssetProfileRow, HELD_AT_SUBTYPES, linkHolding, sameFundAs, saveAssetProfile, openBroker } from '@expanses/db';
import { useState } from 'react';
import { useApp } from '../../app/context';
import { useAccounts, useInvalidateAll } from '../../lib/queries';
import { brokerChoices } from '../investments/add-holding';
import { useHoldingLinks, useSecurities } from '../investments/queries';

/**
 * Which ticker a holding is and where it is kept (spec §7.6), for the rows of the asset page's Details: the security
 * it is linked to, the broker it sits at and the brokers it could, and the change of broker, saved as it is picked.
 * A mutual fund (spec 2026-10-19-fund-by-amount) may also be held at a bank or a fund app, may name a place that is
 * not in the app, and may be the same fund as a holding at another place.
 */
export function useStockAndBroker(accountId: string) {
  const { database, ws } = useApp();
  const invalidate = useInvalidateAll();
  const linksQuery = useHoldingLinks();
  const securitiesQuery = useSecurities();
  const links = linksQuery.data ?? [];
  const link = links.find((l) => l.accountId === accountId);
  const security = (securitiesQuery.data ?? []).find((s) => s.id === link?.securityId);
  /** Whether the link and its security are known, so a listed share is not yet mistaken for a plain holding. */
  const ready = linksQuery.isSuccess && securitiesQuery.isSuccess;
  const accounts = useAccounts().data ?? [];
  const brokers = brokerChoices(accounts);
  // Where a fund can be held: a broker's cash, a bank, a savings account or a fund app — never a pocket.
  const places = accounts.filter((a) => a.kind === 'asset' && HELD_AT_SUBTYPES.includes(a.subtype) && a.parentId === null && a.archivedAt === null);
  // The other holdings of the same fund: those linked to its security.
  const samePlaces = link?.securityId ? links.filter((l) => l.securityId === link.securityId && l.accountId !== accountId).map((l) => l.accountId) : [];
  const [error, setError] = useState<unknown>(null);

  async function run(work: () => Promise<void>) {
    setError(null);
    try {
      await work();
      await invalidate();
    } catch (e) {
      setError(e);
    }
  }

  const keptAt = (brokerAccountId: string) => run(() => linkHolding(database, ws, { accountId, brokerAccountId: brokerAccountId || null }));
  /** A broker not yet in the app, opened by name in the holding's own currency and picked at once. */
  const newBroker = (name: string) =>
    run(async () => {
      const currency = accounts.find((a) => a.id === accountId)?.currency ?? ws.baseCurrency;
      const broker = await openBroker(database, ws, { name, currency });
      await linkHolding(database, ws, { accountId, brokerAccountId: broker.id });
    });
  const sameFund = (otherAccountId: string) => run(() => sameFundAs(database, ws, accountId, otherAccountId || null));
  /** A place not in the app, by name: it is the tax report's Nama institusi, written whole as the profile's other fields are. */
  const placeName = (profile: AssetProfileRow, name: string) =>
    run(async () => {
      if ((profile.coretaxFields.inst ?? '') === name.trim()) return;
      await saveAssetProfile(database, ws, {
        accountId: profile.accountId,
        assetKind: profile.assetKind,
        planGroup: profile.planGroup,
        unitKind: profile.unitKind,
        lotSize: profile.lotSize,
        risk: profile.risk,
        coretaxSection: profile.coretaxSection,
        coretaxCode: profile.coretaxCode,
        acquiredYear: profile.acquiredYear,
        reportable: profile.reportable,
        taxTreatment: profile.taxTreatment,
        coretaxFields: { ...profile.coretaxFields, inst: name.trim() },
      });
    });

  return { link, security, ready, brokers, places, samePlaces, keptAt, newBroker, sameFund, placeName, error };
}
