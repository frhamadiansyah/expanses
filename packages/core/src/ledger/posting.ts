import { currencyInfo } from '../money/currencies';
import { convertMinor } from '../money/money';
import { type PlannedEntry, PostingError, type PostingInput, type PostingLine } from './types';

/**
 * Validates posting lines and computes base-currency amounts.
 * Enforces: at least two lines, non-zero safe-integer amounts, known accounts,
 * account currency constraints, zero sum per currency, available FX rates.
 */
export function planPosting(input: PostingInput): PlannedEntry[] {
  const { baseCurrency, lines, ratesToBase, accountCurrencies } = input;
  if (lines.length < 2) {
    throw new PostingError('TOO_FEW_LINES', 'A transaction needs at least two lines');
  }

  const sums = new Map<string, number>();
  for (const line of lines) {
    if (!Number.isSafeInteger(line.amountMinor)) {
      throw new PostingError('NOT_INTEGER', `Amount ${line.amountMinor} is not an integer of minor units`);
    }
    if (line.amountMinor === 0) {
      throw new PostingError('ZERO_AMOUNT', 'Lines must have a non-zero amount');
    }
    currencyInfo(line.currency);
    if (!(line.accountId in accountCurrencies)) {
      throw new PostingError('UNKNOWN_ACCOUNT', `Unknown account ${line.accountId}`);
    }
    const required = accountCurrencies[line.accountId];
    if (required != null && required !== line.currency) {
      throw new PostingError(
        'CURRENCY_MISMATCH',
        `Account ${line.accountId} holds ${required}, line is ${line.currency}`,
      );
    }
    sums.set(line.currency, (sums.get(line.currency) ?? 0) + line.amountMinor);
  }

  for (const [currency, sum] of sums) {
    if (sum !== 0) {
      throw new PostingError('UNBALANCED', `Lines in ${currency} sum to ${sum}, expected 0`);
    }
  }

  const rateFor = (currency: string): number => {
    if (currency === baseCurrency) return 1;
    const rate = ratesToBase[currency];
    if (rate === undefined || !(rate > 0)) {
      throw new PostingError('MISSING_RATE', `No ${currency}->${baseCurrency} rate`);
    }
    return rate;
  };

  // A carried base figure (spec §7.4 of household sharing) is posted as it is. Its rate is the one given, else the
  // one the figure itself implies, so a currency whose every line carries one needs no rate at all.
  const carried = new Set<PlannedEntry>();
  const impliedRate = (line: PostingLine & { amountBaseMinor: number }): number => {
    const given = ratesToBase[line.currency];
    if (given !== undefined && given > 0) return given;
    const shift = currencyInfo(line.currency).exponent - currencyInfo(baseCurrency).exponent;
    const rate = Math.abs(line.amountBaseMinor / line.amountMinor) * 10 ** shift;
    if (!(rate > 0) || !Number.isFinite(rate)) {
      throw new PostingError('MISSING_RATE', `No ${line.currency}->${baseCurrency} rate`);
    }
    return rate;
  };

  const planned: PlannedEntry[] = lines.map((line) => {
    if (line.amountBaseMinor !== undefined && line.currency !== baseCurrency) {
      if (!Number.isSafeInteger(line.amountBaseMinor)) {
        throw new PostingError('NOT_INTEGER', `Base amount ${line.amountBaseMinor} is not an integer of minor units`);
      }
      const entry: PlannedEntry = {
        accountId: line.accountId,
        amountMinor: line.amountMinor,
        currency: line.currency,
        memo: line.memo ?? null,
        spendCategoryId: line.spendCategoryId ?? null,
        fxRateToBase: impliedRate(line as PostingLine & { amountBaseMinor: number }),
        amountBaseMinor: line.amountBaseMinor,
      };
      carried.add(entry);
      return entry;
    }
    const rate = rateFor(line.currency);
    return {
      accountId: line.accountId,
      amountMinor: line.amountMinor,
      currency: line.currency,
      memo: line.memo ?? null,
      spendCategoryId: line.spendCategoryId ?? null,
      fxRateToBase: rate,
      amountBaseMinor: convertMinor(line.amountMinor, line.currency, baseCurrency, rate),
    };
  });

  // Rounding can leave a same-currency group's base amounts off by a unit; absorb it in the largest line.
  for (const currency of sums.keys()) {
    if (currency === baseCurrency) continue;
    const group = planned.filter((p) => p.currency === currency);
    const drift = group.reduce((s, p) => s + p.amountBaseMinor, 0);
    if (drift !== 0) {
      const free = group.filter((p) => !carried.has(p));
      if (free.length === 0) {
        throw new PostingError('UNBALANCED', `Base amounts of the ${currency} lines sum to ${drift}, expected 0`);
      }
      const largest = free.reduce((a, b) => (Math.abs(b.amountMinor) > Math.abs(a.amountMinor) ? b : a));
      largest.amountBaseMinor -= drift;
    }
  }

  return planned;
}
