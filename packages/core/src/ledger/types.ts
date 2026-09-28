export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export interface PostingLine {
  accountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
  /** Category of a card purchase whose other side is an asset, so points still count. */
  spendCategoryId?: string | null;
  /**
   * The line in the base currency, when the caller already knows it and it must not be re-derived: household
   * sharing posts the figure the payer's device computed, so every device holds the same number (spec §7.4). Ignored
   * on a line already in the base currency. A currency's rounding difference never lands on a line that carries one.
   */
  amountBaseMinor?: number;
}

export interface PlannedEntry {
  accountId: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
  spendCategoryId: string | null;
  fxRateToBase: number;
  amountBaseMinor: number;
}

export interface PostingInput {
  baseCurrency: string;
  lines: PostingLine[];
  /** currency -> units of base per 1 major unit. Base currency is implicitly 1. */
  ratesToBase: Record<string, number>;
  /** accountId -> required entry currency, or null when any currency is allowed. */
  accountCurrencies: Record<string, string | null>;
}

export type PostingErrorCode =
  | 'TOO_FEW_LINES'
  | 'NOT_INTEGER'
  | 'ZERO_AMOUNT'
  | 'UNKNOWN_ACCOUNT'
  | 'CURRENCY_MISMATCH'
  | 'UNBALANCED'
  | 'MISSING_RATE';

export class PostingError extends Error {
  readonly code: PostingErrorCode;

  constructor(code: PostingErrorCode, message: string) {
    super(message);
    this.name = 'PostingError';
    this.code = code;
  }
}
