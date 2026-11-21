/**
 * The three figures Net worth last showed for a workspace — the total, Assets and Liabilities — kept on the device so
 * the next open can draw them at once, before the sheet behind them has been read again (owner, 21 Nov 2026: the page
 * took 7–8 s on her iPhone and drew nothing but a dash until then). The page replaces them with what it reads, so a
 * figure that moved since is right a moment later; the rows and the line are never drawn from here.
 *
 * Which page they were — this phone's own or the household's — is kept with them, and they are only offered back to a
 * page of the same kind: a personal total must never stand where the household's belongs. A database put back from a
 * copy forgets them (`forgetLastFigures`, called by every import), so a restore never opens on the figures it replaced.
 */
export interface LastFigures {
  household: boolean;
  currency: string;
  netWorthMinor: number;
  assetsMinor: number;
  liabilitiesMinor: number;
}

const KEY = 'cicis.net-worth.last-figures';

type Kept = Record<string, LastFigures>;

function readAll(storage: Storage | undefined): Kept {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Kept) : {};
  } catch {
    return {};
  }
}

const local = (): Storage | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);

/** The figures last shown for `workspaceId`, if they were a page of the same kind in the same currency. */
export function lastFigures(workspaceId: string, page: { household: boolean; currency: string }, storage = local()): LastFigures | null {
  const kept = readAll(storage)[workspaceId];
  if (!kept || kept.household !== page.household || kept.currency !== page.currency) return null;
  if (!whole(kept.netWorthMinor) || !whole(kept.assetsMinor) || !whole(kept.liabilitiesMinor)) return null;
  return kept;
}

/** Keeps what the page has just drawn, when it differs from what is kept. */
export function keepLastFigures(workspaceId: string, figures: LastFigures, storage = local()): void {
  const all = readAll(storage);
  const was = all[workspaceId];
  if (
    was &&
    was.household === figures.household &&
    was.currency === figures.currency &&
    was.netWorthMinor === figures.netWorthMinor &&
    was.assetsMinor === figures.assetsMinor &&
    was.liabilitiesMinor === figures.liabilitiesMinor
  ) {
    return;
  }
  try {
    storage?.setItem(KEY, JSON.stringify({ ...all, [workspaceId]: figures }));
  } catch {
    // No storage (a private window): the next open waits for its figures, as it always did.
  }
}

/** Forgets every workspace's figures: the database under them has been replaced. */
export function forgetLastFigures(storage = local()): void {
  try {
    storage?.removeItem(KEY);
  } catch {
    // Nothing kept, or nowhere to keep it.
  }
}
