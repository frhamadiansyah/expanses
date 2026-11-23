/*
 * The Mac's add and edit forms (option C, owner 2026-11-23): on a wide screen each opens as a panel floating on the
 * right over the page it was opened from, which stays drawn and usable beside it. A form keeps its own address, so a
 * link, Back and a reload land on it as before; the page under it is the one the form was opened from, or — opened
 * from outside — the page it belongs to (`panelBase`).
 */

const SEG = '[^/]+';

/** Each form, and the page it belongs to when nothing opened it ("$1" is the first segment the pattern names). */
const FORMS: readonly [pattern: RegExp, base: string][] = [
  [/^\/transactions\/new$/, '/transactions'],
  [new RegExp(`^/transactions/${SEG}/edit$`), '/transactions'],
  [/^\/budget\/edit$/, '/budget'],
  [/^\/bills\/new$/, '/bills'],
  [new RegExp(`^/bills/${SEG}/(edit|link)$`), '/bills'],
  [new RegExp(`^/events/(${SEG})/(plan|shared-plan)/new$`), '/events/$1'],
  [new RegExp(`^/events/(${SEG})/(plan|shared-plan)/${SEG}/(edit|link)$`), '/events/$1'],
  [new RegExp(`^/events/(${SEG})/plan/link(/${SEG})?$`), '/events/$1'],
  [/^\/accounts\/(new|add)$/, '/wallet'],
  [new RegExp(`^/accounts/(${SEG})/(pocket|move)$`), '/accounts/$1'],
  [/^\/net-worth\/investments\/new$/, '/net-worth'],
  [/^\/net-worth\/assets\/new$/, '/net-worth'],
  [new RegExp(`^/net-worth/assets/${SEG}/edit$`), '/net-worth'],
  [/^\/net-worth\/lend-borrow\/new-(receivable|payable)$/, '/net-worth/lend-borrow'],
  [/^\/goals\/new$/, '/goals'],
  [new RegExp(`^/goals/${SEG}/edit$`), '/goals'],
  [/^\/debts\/new$/, '/net-worth/plan'],
  [/^\/cards\/new$/, '/wallet'],
];

/** The page a form belongs to, or null when the address is not one of the forms. */
export function panelBase(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  for (const [pattern, base] of FORMS) {
    const match = pattern.exec(path);
    if (match) return base.replace('$1', match[1] ?? '');
  }
  return null;
}

/** Whether this address is a form drawn in the panel (on a wide screen). */
export const isPanelForm = (pathname: string) => panelBase(pathname) !== null;
