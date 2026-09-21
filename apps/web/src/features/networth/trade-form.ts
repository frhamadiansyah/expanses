import { formatUnits, type Position, parseMajor, parseUnits, priceMicroFrom, sellBasisMinor, type TradeKind } from '@expanses/core';
import type { RecordTradeInput, TradeRow } from '@expanses/db';
import { bareFigure } from './debt-rows';

export interface TradeDraft {
  kind: TradeKind;
  accountId: string;
  occurredOn: string;
  units: string;
  /** Amount before fees and tax: what it cost, the proceeds, or the income. */
  gross: string;
  fee: string;
  tax: string;
  /** Empty means Opening Balances: something owned before the app. */
  cashAccountId: string;
  /** Goal this buy funds, or the goal a sell takes its units from. Empty means no goal. */
  goalId: string;
}

export const emptyTradeDraft = (accountId: string, cashAccountId: string, today: string): TradeDraft => ({
  kind: 'buy',
  accountId,
  occurredOn: today,
  units: '',
  gross: '',
  fee: '0',
  tax: '0',
  cashAccountId,
  goalId: '',
});

/**
 * A pre-filled amount, written the way the app writes money and the owner types it — `10.447.125`, `1.825,00` — never
 * the raw `10447125`. `parseMajor` reads it back to the same figure.
 */
export const typedAmount = (minor: number, currency: string): string => bareFigure(minor, currency);

/** An edit opens with the trade's own figures, each in the app's number format. */
export function draftFromTrade(
  trade: Pick<TradeRow, 'kind' | 'accountId' | 'occurredOn' | 'unitsMicro' | 'grossMinor' | 'feeMinor' | 'taxMinor' | 'cashAccountId' | 'goalId'>,
  currency: string,
): Partial<TradeDraft> {
  return {
    kind: trade.kind,
    accountId: trade.accountId,
    occurredOn: trade.occurredOn,
    units: trade.unitsMicro === 0 ? '' : formatUnits(trade.unitsMicro),
    gross: typedAmount(trade.grossMinor, currency),
    fee: typedAmount(trade.feeMinor, currency),
    tax: typedAmount(trade.taxMinor, currency),
    cashAccountId: trade.cashAccountId ?? '',
    goalId: trade.goalId ?? '',
  };
}

const amount = (text: string, currency: string, label: string): number => {
  if (text.trim() === '') return 0;
  try {
    return parseMajor(text, currency);
  } catch {
    throw new Error(`${label} must be a number`);
  }
};

/** Turns what was typed into a trade to record, with messages meant for the screen. */
export function draftToInput(draft: TradeDraft, currency: string, today: string): RecordTradeInput {
  if (!draft.accountId) throw new Error('Choose what you bought or sold');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.occurredOn)) throw new Error('Choose a date');
  if (draft.occurredOn > today) throw new Error('A trade cannot be dated after today');

  const fee = amount(draft.fee, currency, 'Fee');
  const tax = amount(draft.tax, currency, 'Tax withheld');
  if (fee < 0 || tax < 0) throw new Error('Fee and tax cannot be negative');

  if (draft.kind === 'income') {
    const gross = amount(draft.gross, currency, 'Amount');
    if (gross <= 0) throw new Error('Enter the amount before tax');
    return { accountId: draft.accountId, kind: 'income', occurredOn: draft.occurredOn, unitsMicro: 0, grossMinor: gross, feeMinor: 0, taxMinor: tax, cashAccountId: draft.cashAccountId || null, goalId: null };
  }

  if (draft.units.trim() === '') throw new Error('Enter how many units, shares or grams');
  let unitsMicro: number;
  try {
    unitsMicro = parseUnits(draft.units);
  } catch {
    throw new Error('Units must be a number');
  }
  if (unitsMicro <= 0) throw new Error('Enter more than zero units');

  if (draft.kind === 'unit_change') {
    return { accountId: draft.accountId, kind: 'unit_change', occurredOn: draft.occurredOn, unitsMicro, grossMinor: 0, feeMinor: 0, taxMinor: 0, cashAccountId: null, goalId: null };
  }

  const gross = amount(draft.gross, currency, draft.kind === 'buy' ? 'Cost' : 'Proceeds');
  if (gross <= 0) throw new Error(draft.kind === 'buy' ? 'Enter what it cost, before fees' : 'Enter the proceeds, before fees');

  return {
    accountId: draft.accountId,
    kind: draft.kind,
    occurredOn: draft.occurredOn,
    unitsMicro,
    grossMinor: gross,
    feeMinor: fee,
    taxMinor: tax,
    cashAccountId: draft.cashAccountId || null,
    goalId: draft.goalId || null,
  };
}

/** Price per unit implied by the amount typed, for the check under the form. */
export function pricePreview(draft: TradeDraft, currency: string): number | null {
  try {
    const unitsMicro = parseUnits(draft.units);
    const gross = parseMajor(draft.gross, currency);
    if (unitsMicro <= 0 || gross <= 0) return null;
    return priceMicroFrom(gross, unitsMicro);
  } catch {
    return null;
  }
}

/** What a sell would give up and gain, shown before saving. Null when it cannot be worked out. */
export function sellPreview(draft: TradeDraft, position: Position | undefined, currency: string): { basisMinor: number; realizedMinor: number } | null {
  if (draft.kind !== 'sell' || !position) return null;
  try {
    const unitsMicro = parseUnits(draft.units);
    if (unitsMicro <= 0 || unitsMicro > position.unitsMicro) return null;
    const basisMinor = sellBasisMinor(position, unitsMicro);
    const gross = draft.gross.trim() === '' ? 0 : parseMajor(draft.gross, currency);
    const fee = draft.fee.trim() === '' ? 0 : parseMajor(draft.fee, currency);
    return { basisMinor, realizedMinor: gross - fee - basisMinor };
  } catch {
    return null;
  }
}
