/** A ceiling on how many points convert in one window, and what becomes of the rest. */
export interface RedemptionCap {
  /** The window the ceiling resets on. */
  window: 'month' | 'year';
  /** The ceiling in program points. Exactly one of this and `capPartnerUnits` is set. */
  capPoints: number | null;
  /** The ceiling in partner units, for issuers that publish it that way. */
  capPartnerUnits: number | null;
  /** True when one ceiling covers every partner together rather than each partner on its own. */
  shared: boolean;
  /** The ratio past the ceiling, or null when nothing converts past it. */
  beyond: { points: number; partnerUnits: number } | null;
}

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
  /** Set when the issuer limits how much converts in a window. */
  cap?: RedemptionCap | null;
}

type Ratio = Pick<TransferPartner, 'points' | 'partnerUnits'>;
type Convertible = Ratio & Pick<TransferPartner, 'incrementPoints'> & { cap?: RedemptionCap | null };

const units = (points: number, ratio: Ratio): number => Math.floor((points * ratio.partnerUnits) / ratio.points);

/** The ceiling in program points, whichever way the issuer publishes it, or null when uncapped. */
export function capInPoints(partner: Convertible): number | null {
  const cap = partner.cap;
  if (!cap) return null;
  if (cap.capPoints !== null) return cap.capPoints;
  if (cap.capPartnerUnits === null || partner.partnerUnits <= 0) return null;
  return Math.floor((cap.capPartnerUnits * partner.points) / partner.partnerUnits);
}

/** What converting a whole balance in one go would yield, and what it would leave behind. */
export interface ConversionDetail {
  /** Partner units the balance converts to, both rates together. */
  units: number;
  /** Points moving at the headline ratio. */
  fullRatePoints: number;
  /** Points moving at the reduced ratio past the ceiling. */
  beyondPoints: number;
  /** Points that cannot move at all: past a hard ceiling, or short of a whole step. */
  unconvertedPoints: number;
}

/**
 * Converts a points balance: only whole increments convert, and partner units round down.
 * A ceiling is spent in whole increments too, so a step straddling it waits for the next window
 * rather than being split; anything past the ceiling moves at the reduced ratio, if the issuer offers one.
 */
export function convertDetail(points: number, partner: Convertible): ConversionDetail {
  const none = { units: 0, fullRatePoints: 0, beyondPoints: 0, unconvertedPoints: Math.max(0, Math.floor(points) || 0) };
  if (points <= 0 || partner.points <= 0 || partner.incrementPoints <= 0) return none;

  const step = partner.incrementPoints;
  const whole = Math.floor(points / step) * step;
  const cap = capInPoints(partner);
  const fullRatePoints = cap === null ? whole : Math.floor(Math.min(whole, Math.max(0, cap)) / step) * step;
  const past = whole - fullRatePoints;
  const beyond = partner.cap?.beyond ?? null;
  const beyondPoints = beyond && beyond.points > 0 ? past : 0;

  return {
    units: units(fullRatePoints, partner) + (beyondPoints > 0 && beyond ? units(beyondPoints, beyond) : 0),
    fullRatePoints,
    beyondPoints,
    unconvertedPoints: Math.floor(points) - fullRatePoints - beyondPoints,
  };
}

/** Converts a points balance: only whole increments convert, and partner units round down. */
export function convertPoints(points: number, partner: Convertible): number {
  return convertDetail(points, partner).units;
}

/** Estimates partner units for a single purchase, without increment rounding that would zero small purchases. */
export function estimatePartnerUnits(points: number, partner: Ratio): number {
  if (points <= 0 || partner.points <= 0) return 0;
  return units(points, partner);
}

/** The partner converting into `program` that is valid on `onDate`, if any. */
export function partnerFor(partners: TransferPartner[], program: string, onDate: string): TransferPartner | null {
  return partners.find((p) => p.program === program && (!p.validFrom || onDate >= p.validFrom) && (!p.validTo || onDate <= p.validTo)) ?? null;
}
