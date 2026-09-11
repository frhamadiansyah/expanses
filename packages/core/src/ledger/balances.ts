import { convertMinor } from '../money/money';
import type { AccountKind } from './types';

/** Converts a raw debit-positive sum into the sign a user expects for the account kind. */
export function displayAmount(kind: AccountKind, rawMinor: number): number {
  const flipped = kind === 'liability' || kind === 'income' || kind === 'equity' ? -rawMinor : rawMinor;
  return flipped === 0 ? 0 : flipped;
}

export interface NetWorthAccount {
  id: string;
  kind: AccountKind;
  currency: string | null;
}

export interface NetWorthResult {
  assetsBaseMinor: number;
  liabilitiesBaseMinor: number;
  netWorthBaseMinor: number;
  missingRates: string[];
}

/** Net worth at a date: native balances at that date converted at rates as of that date. */
export function netWorth(p: {
  baseCurrency: string;
  accounts: NetWorthAccount[];
  nativeBalances: Record<string, number>;
  ratesToBase: Record<string, number>;
}): NetWorthResult {
  let assets = 0;
  let liabilities = 0;
  const missing = new Set<string>();
  for (const account of p.accounts) {
    if ((account.kind !== 'asset' && account.kind !== 'liability') || account.currency === null) continue;
    const raw = p.nativeBalances[account.id] ?? 0;
    if (raw === 0) continue;
    const rate = account.currency === p.baseCurrency ? 1 : p.ratesToBase[account.currency];
    if (rate === undefined) {
      missing.add(account.currency);
      continue;
    }
    const converted = convertMinor(raw, account.currency, p.baseCurrency, rate);
    if (account.kind === 'asset') assets += converted;
    else liabilities -= converted;
  }
  return {
    assetsBaseMinor: assets,
    liabilitiesBaseMinor: liabilities,
    netWorthBaseMinor: assets - liabilities,
    missingRates: [...missing].sort(),
  };
}
