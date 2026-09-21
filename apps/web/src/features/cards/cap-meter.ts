/**
 * A rule's cap as the meter under it draws it: how full, and whether it reads as reached.
 *
 * "Reached" is decided on the percent the meter shows, rounded, not on the raw fraction — so the bar turns the
 * warn colour at the moment it looks full, exactly where the page switched it before the restyle. A cap 99,6 %
 * used draws a full bar, and a full bar in the tint would say there was room left when there is none to see.
 */
export function capMeter(usedMinor: number, capMinor: number): { fraction: number; tone: 'tint' | 'warn' } {
  const fraction = Math.max(0, Math.min(1, usedMinor / capMinor));
  return { fraction, tone: Math.round((usedMinor / capMinor) * 100) >= 100 ? 'warn' : 'tint' };
}
