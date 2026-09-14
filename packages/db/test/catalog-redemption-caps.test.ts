import { findEntry } from '@expanses/catalog';
import { convertPoints, type TransferPartner } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { applyCatalogEntry, createAccount, listTransferPartners } from '../src/index';
import { setupDb } from './helpers';

const TODAY = '2026-09-14';

/** Applies an entry and reads its partners back, so the cap is checked through the database rather than the JSON. */
async function partnersOf(entryId: string, memberLevel?: string): Promise<TransferPartner[]> {
  const t = await setupDb();
  const card = await createAccount(t.database, t.ws, { name: entryId, kind: 'liability', subtype: 'credit_card', currency: 'IDR' });
  const { programId } = await applyCatalogEntry(t.database, t.ws, {
    cardAccountId: card.id,
    entry: structuredClone(findEntry(entryId)!),
    today: TODAY,
    replaceManual: false,
    ...(memberLevel ? { memberLevel } : {}),
  });
  return listTransferPartners(t.database, t.ws, programId);
}

const byKey = (partners: TransferPartner[], key: string) => partners.find((p) => p.key === key)!;

describe('redemption caps survive a round trip through the database', () => {
  it('keeps Mandiri’s monthly ceiling and the reduced rate past it', async () => {
    const krisflyer = byKey(await partnersOf('mandiri-world-prioritas'), 'krisflyer');
    expect(krisflyer.cap).toEqual({
      window: 'month',
      capPoints: 25_000,
      capPartnerUnits: null,
      shared: true,
      beyond: { points: 3000, partnerUnits: 1000 },
    });
  });

  it('keeps OCBC’s ceiling hard, with no ratio past it', async () => {
    const krisflyer = byKey(await partnersOf('ocbc-90n'), 'krisflyer');
    expect(krisflyer.cap?.capPoints).toBe(100_000);
    expect(krisflyer.cap?.beyond).toBeNull();
  });

  it('keeps Jenius’s ceilings in partner units, each partner on its own', async () => {
    const partners = await partnersOf('jenius-kartu-kredit', 'grow-plus');
    expect(byKey(partners, 'krisflyer-grow').cap).toMatchObject({ capPartnerUnits: 30_000, capPoints: null, shared: false });
    expect(byKey(partners, 'garudamiles').cap).toMatchObject({ capPartnerUnits: 20_000, shared: false });
    // Only KrisFlyer and GarudaMiles are limited; the other three are not.
    expect(byKey(partners, 'linkmiles').cap).toBeNull();
    expect(byKey(partners, 'traveloka').cap).toBeNull();
  });

  it('keeps Maybank’s ceiling on a year rather than a month', async () => {
    const partners = await partnersOf('maybank-visa-infinite');
    expect(byKey(partners, 'krisflyer').cap).toMatchObject({ window: 'year', capPoints: 200_000, beyond: { points: 20_000, partnerUnits: 6_666 } });
    // AirAsia moves in 5.000 steps, so its reduced ratio is written against 5.000 too.
    expect(byKey(partners, 'airasia').cap?.beyond).toEqual({ points: 5000, partnerUnits: 1666 });
  });

  it('leaves a card without a published ceiling uncapped', async () => {
    for (const partner of await partnersOf('bca-unionpay')) expect(partner.cap, partner.key).toBeNull();
  });
});

describe('what the ceilings do to an estimate', () => {
  it('holds a Mandiri cycle to 25.000 at one for one, then a third of the rate', async () => {
    const krisflyer = byKey(await partnersOf('mandiri-world-prioritas'), 'krisflyer');
    // The 1.000 step lands exactly on the ceiling, so 25.000 moves one for one and the last 15.000 at 3.000 for 1.000.
    expect(convertPoints(40_000, krisflyer)).toBe(25_000 + 5_000);
    expect(convertPoints(20_000, krisflyer)).toBe(20_000);
    // Below the 10.000 that opens a conversion, nothing moves at all.
    expect(convertPoints(9_999, krisflyer)).toBe(0);
  });

  it('refuses to move an OCBC balance past 100.000 at all', async () => {
    const krisflyer = byKey(await partnersOf('ocbc-90n'), 'krisflyer');
    expect(convertPoints(90_000, krisflyer)).toBe(90_000);
    expect(convertPoints(250_000, krisflyer)).toBe(100_000);
  });

  it('holds a Jenius balance to one KrisFlyer conversion, the 30.000 miles it allows', async () => {
    const partners = await partnersOf('jenius-kartu-kredit', 'grow-plus');
    expect(convertPoints(200_000, byKey(partners, 'krisflyer-grow'))).toBe(30_000);
    // Traveloka has no ceiling, so a large balance still moves in full.
    expect(convertPoints(25_000, byKey(partners, 'traveloka'))).toBe(1_000_000);
  });

  it('drops a Maybank balance to a third once 200.000 TREATS have gone in the year', async () => {
    const krisflyer = byKey(await partnersOf('maybank-bmw'), 'krisflyer');
    expect(convertPoints(200_000, krisflyer)).toBe(200_000);
    // The next 100.000 give 5 steps of 6.666.
    expect(convertPoints(300_000, krisflyer)).toBe(200_000 + 5 * 6_666);
  });
});
