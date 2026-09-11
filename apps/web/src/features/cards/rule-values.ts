/** Earn rates may carry one decimal (7,5 points per Rp 50.000). Accepts a comma or a dot; empty means not entered. */
export function parseRulePoints(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(',', '.');
  if (!/^\d+(\.\d)?$/.test(normalized)) throw new Error(`"${trimmed}" must be a number of points with at most one decimal, like 3 or 7,5`);
  return Number(normalized);
}
