import type { SheetSectionKey } from '@expanses/core';
import type { ShareSegment } from './ShareBar';
import type { DebtKind } from './debt-rows';
import { ASSET_STACK_KEYS, DEBT_STACK_KEYS, stackColours } from './stack-keys';

/*
 * What a side is made of, as the bar and its key read it.
 *
 * The Overview drew both of these itself, beside the totals they divide — and a share bar read next to a total is
 * read as part of the total rather than as a subject of its own. Each one belongs to the page whose list it divides:
 * the Assets page says what is owned and what it is owned *in*, and the Liabilities page says what is owed and of
 * what kind, which is the fold its drawers already make. The bar and the drawers are then two readings of one list
 * on one page, instead of the same reading drawn twice on two.
 */

const SECTION_COLOURS = stackColours(ASSET_STACK_KEYS);
const DEBT_COLOURS = stackColours(DEBT_STACK_KEYS);

/** The kind of debt a drawer is, in the palette's own words for it. */
const DEBT_KEY: Record<DebtKind, string> = { card: 'credit_card', loan: 'loan', person: 'payable' };

/**
 * One segment per section of the statement: the six kinds of thing you own.
 *
 * A section whose total is null — a holding in a currency with no rate — is left out rather than drawn as nothing:
 * the caller only draws the bar at all once the page's own total is known, so a null here is a segment that would
 * have been a nought, and a nought in a share bar is a share that is not there.
 */
export function assetSegments(groups: readonly { group: SheetSectionKey; label: string; totalMinor: number | null }[]): ShareSegment[] {
  return groups.flatMap((group) =>
    group.totalMinor === null
      ? []
      : [{ key: group.group, label: group.label, minor: group.totalMinor, className: SECTION_COLOURS[group.group] ?? 'bg-slate-400' }],
  );
}

/**
 * What a bar can honestly divide: the segments above nought, as shares of what they come to together.
 *
 * A share of a total is only a share while every part is a positive piece of it. An overdrawn current account can take
 * the section it sits in below nought, and a whole side with it — and a total below nought has no shares, so the bar
 * drew nothing at all. The parts that are held are still held, so they are divided among themselves, and a part below
 * nought is handed back to be named beside the bar rather than drawn as a negative width.
 */
export function heldShares(segments: readonly ShareSegment[]): { shown: ShareSegment[]; below: ShareSegment[]; heldMinor: number } {
  const shown = segments.filter((segment) => segment.minor > 0);
  return { shown, below: segments.filter((segment) => segment.minor < 0), heldMinor: shown.reduce((sum, segment) => sum + segment.minor, 0) };
}

/** One segment per kind of debt: the same drawers the list under the bar is folded by. */
export function debtSegments(drawers: readonly { key: string; label: string; totalMinor: number | null; kind: DebtKind }[]): ShareSegment[] {
  return drawers.flatMap((drawer) =>
    drawer.totalMinor === null
      ? []
      : [{ key: drawer.key, label: drawer.label, minor: drawer.totalMinor, className: DEBT_COLOURS[DEBT_KEY[drawer.kind]] ?? 'bg-rose-500' }],
  );
}
