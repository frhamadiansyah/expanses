import { parseRate } from '@expanses/core';
import { type AccountRow, type Database, upsertRate, type WorkspaceContext } from '@expanses/db';
import { checkManualRate } from '../../lib/rates';
import type { FormDraft, FormPost } from './tx-form';

/**
 * Which currencies a save has to be able to convert before it can be posted.
 *
 * Asked once, for every way in: a second copy is how one screen comes to demand a rate another does not.
 */
export function currenciesOf(post: FormPost, accounts: readonly AccountRow[]): string[] {
  const currencyOf = (id: string) => accounts.find((a) => a.id === id)?.currency ?? '';
  if (post.kind === 'post') return [...new Set(post.input.lines.map((line) => line.currency))];
  if (post.kind === 'split') return [currencyOf(post.input.moneyAccountId)];
  if (post.kind === 'transfer-goal') return [currencyOf(post.input.fromAccountId), currencyOf(post.input.toAccountId)];
  return [];
}

/**
 * Everything a save does about **currencies** before it writes anything: the rate the user typed by hand, the
 * rates the posting needs, and the message that asks for one that is missing.
 *
 * One implementation, because the two that existed diverged in the worst possible way. `TransactionCard.submit`
 * read `draft.manualRate`; `EditSheet.save` was a line-for-line copy of it **with the rate block left out** —
 * and `draft.manualRate` had exactly one reader in the whole app. So the phone's edit sheet drew the rate row
 * under More, took the rate, and threw it away: Save said "add it under More", More was where you had just
 * added it, and Save said the same thing again, for ever. The only way out was ⋯ → Open in full form.
 *
 * `where` is the only thing the two callers still differ by — the card's row sits under "Add more details" and
 * the sheet's under "More", and the message has to say which — so that is a parameter rather than a copy.
 *
 * Throws with the words the user reads; the caller has already put the pair into `needsRate` by then, which is
 * what puts the rate row on screen (§3.3).
 */
export async function ratesForSave({
  database,
  ws,
  draft,
  post,
  accounts,
  rateDate,
  needsRate,
  resolveRates,
  onMissing,
  where,
}: {
  database: Database;
  ws: WorkspaceContext;
  draft: FormDraft;
  post: FormPost;
  accounts: readonly AccountRow[];
  /** The day the rate is stored under — never later than today, exactly as `resolveRates` resolves it. */
  rateDate: string;
  /** The pair a previous Save came back without, or null. Only then is a typed rate meaningful. */
  needsRate: string | null;
  resolveRates: (currencies: string[], onDate: string) => Promise<{ rates: Record<string, number>; missing: string[] }>;
  /** Told which pair is missing, so the screen can draw the row that asks for it. */
  onMissing: (currency: string) => void;
  /** What the row asking for the rate is called on this screen. */
  where: string;
}): Promise<Record<string, number>> {
  if (needsRate && draft.manualRate.trim()) {
    const rate = parseRate(draft.manualRate);
    // A rate ten times off the last one known is nearly always a decimal separator, and it is caught before
    // it is stored rather than after every figure on the screen has been converted with it.
    await checkManualRate(database, needsRate, ws.baseCurrency, rateDate, rate);
    await upsertRate(database, { fromCurrency: needsRate, toCurrency: ws.baseCurrency, onDate: rateDate, rate, source: 'manual', sourceDate: rateDate });
  }
  const foreign = currenciesOf(post, accounts).filter((code) => code && code !== ws.baseCurrency);
  const resolved = await resolveRates([...new Set(foreign)], draft.occurredOn);
  if (resolved.missing.length > 0) {
    onMissing(resolved.missing[0]!);
    throw new Error(`No ${resolved.missing[0]}→${ws.baseCurrency} rate for ${rateDate}. Add it under “${where}”.`);
  }
  return resolved.rates;
}
