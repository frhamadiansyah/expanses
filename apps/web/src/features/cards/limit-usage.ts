/**
 * How a card's limit is taken up. An instalment purchase is recorded on the card at its full price, so what the
 * plan has not billed yet is already inside what is owed: it is shown as part of the used amount, never taken
 * off the limit a second time.
 */
export interface LimitUsage {
  /** Everything owed on the card, instalments included. */
  usedMinor: number;
  /** The part of what is owed that instalments have not billed yet. */
  heldMinor: number;
  /** What can still be spent; negative when over the limit. */
  availableMinor: number | null;
  /** Bar widths as whole percentages of the limit: owed outside instalments, then held by them. */
  barUsedPct: number;
  barHeldPct: number;
  usedPct: number | null;
}

export function limitUsage(owedMinor: number, limitMinor: number | null, unbilledMinor: number): LimitUsage {
  const used = Math.max(0, owedMinor);
  // Instalments cannot hold more than is owed: a card paid off early has nothing left for them to hold.
  const held = Math.min(Math.max(0, unbilledMinor), used);
  if (!limitMinor || limitMinor <= 0) return { usedMinor: used, heldMinor: held, availableMinor: null, barUsedPct: 0, barHeldPct: 0, usedPct: null };
  const pct = (minor: number) => Math.min(100, Math.round((minor / limitMinor) * 100));
  const barHeldPct = pct(held);
  return {
    usedMinor: used,
    heldMinor: held,
    availableMinor: limitMinor - owedMinor,
    barUsedPct: Math.max(0, pct(used) - barHeldPct),
    barHeldPct,
    usedPct: pct(used),
  };
}
