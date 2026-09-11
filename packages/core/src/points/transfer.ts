export interface TransferPartner {
  id: string;
  key: string;
  /** Loyalty program points convert into, e.g. KrisFlyer. */
  program: string;
  /** `points` of the card program convert to `partnerUnits` of the partner program. */
  points: number;
  partnerUnits: number;
  /** Conversions happen in steps of this many points. */
  incrementPoints: number;
  validFrom: string | null;
  validTo: string | null;
}

/** Converts a points balance: only whole increments convert, and partner units round down. */
export function convertPoints(points: number, partner: Pick<TransferPartner, 'points' | 'partnerUnits' | 'incrementPoints'>): number {
  if (points <= 0 || partner.points <= 0 || partner.incrementPoints <= 0) return 0;
  const convertible = Math.floor(points / partner.incrementPoints) * partner.incrementPoints;
  return Math.floor((convertible * partner.partnerUnits) / partner.points);
}

/** Estimates partner units for a single purchase, without increment rounding that would zero small purchases. */
export function estimatePartnerUnits(points: number, partner: Pick<TransferPartner, 'points' | 'partnerUnits'>): number {
  if (points <= 0 || partner.points <= 0) return 0;
  return Math.floor((points * partner.partnerUnits) / partner.points);
}

/** The partner converting into `program` that is valid on `onDate`, if any. */
export function partnerFor(partners: TransferPartner[], program: string, onDate: string): TransferPartner | null {
  return partners.find((p) => p.program === program && (!p.validFrom || onDate >= p.validFrom) && (!p.validTo || onDate <= p.validTo)) ?? null;
}
