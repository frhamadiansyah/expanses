export type AccountKind = 'asset' | 'liability' | 'income' | 'expense' | 'equity';

export interface PostingLine {
  accountId: string;
  amountMinor: number;
  currency: string;
  memo?: string | null;
}

export interface PlannedEntry {
  accountId: string;
  amountMinor: number;
  currency: string;
  memo: string | null;
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
