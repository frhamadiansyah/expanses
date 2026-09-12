import type { PostingLine } from '../ledger/types';
import { type Position, sellBasisMinor, TradeError, type TradeKind } from './position';
import { formatUnits } from './units';

export interface TradeAccounts {
  holdingAccountId: string;
  holdingCurrency: string;
  /** Where the money comes from or goes to. For an opening position this is the Opening Balances account. */
  cashAccountId: string;
  cashCurrency: string;
  realizedGainsCategoryId: string;
  investmentIncomeCategoryId: string;
  finalTaxCategoryId: string;
  /** Needed only when the holding and the cash account use different currencies. */
  currencyExchangeAccountId?: string;
}

export interface TradeInput {
  kind: TradeKind;
  occurredOn: string;
  unitsMicro: number;
  /** Amount before fees and tax, in the holding's currency. */
  grossMinor: number;
  feeMinor: number;
  taxMinor: number;
  /** Money that actually left or reached the cash account, in the cash currency. Only for a different currency. */
  cashMinor?: number;
}

const line = (accountId: string, amountMinor: number, currency: string): PostingLine => ({ accountId, amountMinor, currency });

/** Adds the two Currency Exchange legs when the cash account is in another currency. */
function cashLines(accounts: TradeAccounts, amountMinor: number, cashMinor: number | undefined): PostingLine[] {
  if (accounts.cashCurrency === accounts.holdingCurrency) {
    return [line(accounts.cashAccountId, -amountMinor, accounts.cashCurrency)];
  }
  if (!accounts.currencyExchangeAccountId || cashMinor === undefined) {
    throw new TradeError('CURRENCY_MISMATCH', `A ${accounts.holdingCurrency} holding paid from a ${accounts.cashCurrency} account needs the amount in ${accounts.cashCurrency}`);
  }
  return [
    line(accounts.currencyExchangeAccountId, -amountMinor, accounts.holdingCurrency),
    line(accounts.currencyExchangeAccountId, cashMinor, accounts.cashCurrency),
    line(accounts.cashAccountId, -cashMinor, accounts.cashCurrency),
  ];
}

/**
 * Ledger lines for one trade. Positive is a debit, negative a credit.
 * Buy: cost includes fees and tax (Pasal 10). Sell: the holding gives up average cost and the rest is the realized gain.
 */
export function tradePostings(input: TradeInput, position: Position, accounts: TradeAccounts): PostingLine[] {
  if (input.grossMinor < 0 || input.feeMinor < 0 || input.taxMinor < 0) {
    throw new TradeError('INVALID_AMOUNT', 'Amounts on a trade cannot be negative');
  }
  const { holdingCurrency } = accounts;
  if (input.kind === 'unit_change') return [];

  if (input.kind === 'buy') {
    if (input.unitsMicro <= 0) throw new TradeError('INVALID_UNITS', 'A buy needs units greater than zero');
    const cost = input.grossMinor + input.feeMinor + input.taxMinor;
    if (cost <= 0) throw new TradeError('INVALID_AMOUNT', 'A buy needs an amount greater than zero');
    return [line(accounts.holdingAccountId, cost, holdingCurrency), ...cashLines(accounts, cost, input.cashMinor)];
  }

  if (input.kind === 'sell') {
    if (input.unitsMicro <= 0) throw new TradeError('INVALID_UNITS', 'A sell needs units greater than zero');
    const basis = sellBasisMinor(position, input.unitsMicro);
    const net = input.grossMinor - input.feeMinor - input.taxMinor;
    const gain = input.grossMinor - input.feeMinor - basis;
    const lines: PostingLine[] = [...cashLines(accounts, -net, input.cashMinor === undefined ? undefined : -input.cashMinor)];
    if (input.taxMinor > 0) lines.push(line(accounts.finalTaxCategoryId, input.taxMinor, holdingCurrency));
    lines.push(line(accounts.holdingAccountId, -basis, holdingCurrency));
    if (gain !== 0) lines.push(line(accounts.realizedGainsCategoryId, -gain, holdingCurrency));
    return lines;
  }

  if (input.kind === 'income') {
    if (input.grossMinor <= 0) throw new TradeError('INVALID_AMOUNT', 'Income needs an amount greater than zero');
    const net = input.grossMinor - input.taxMinor;
    const lines: PostingLine[] = [...cashLines(accounts, -net, input.cashMinor === undefined ? undefined : -input.cashMinor)];
    if (input.taxMinor > 0) lines.push(line(accounts.finalTaxCategoryId, input.taxMinor, holdingCurrency));
    lines.push(line(accounts.investmentIncomeCategoryId, -input.grossMinor, holdingCurrency));
    return lines;
  }

  throw new TradeError('UNKNOWN_KIND', `Unknown trade kind "${String(input.kind)}"`);
}

/** Plain-language description stored on the ledger transaction. */
export function tradeDescription(input: TradeInput, holdingName: string): string {
  if (input.kind === 'buy') return `Bought ${formatUnits(input.unitsMicro)} ${holdingName}`;
  if (input.kind === 'sell') return `Sold ${formatUnits(input.unitsMicro)} ${holdingName}`;
  if (input.kind === 'income') return `Income from ${holdingName}`;
  return `Units changed on ${holdingName}`;
}
