import type { AccountRow } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { photosCorner } from './PhotosSheet';
import { splitSummary } from './SplitSheet';
import { emptyForm, type FormDraft } from './tx-form';
import { withSummary } from './WithSheet';

/**
 * What the three rows under "Add more details" say without being opened.
 *
 * Each of these writers carries a comment naming the hazard it guards — `formatMinor` and never
 * `minorToMajorString`, because that one writes US$85,00 as "85.00", which this app's own number formatting
 * reads as eighty-five thousand — and until now not one of them had a test. The only thing standing between
 * the comment and a hundredfold error was a single chromium assertion.
 *
 * So every figure here is in **USD**: exponent 2, where a figure read at the wrong exponent is a hundred times
 * what was typed. An IDR fixture has exponent 0 and reads the same whether the currency was honoured or
 * ignored — which is exactly why the row that already had an e2e is the row in dollars.
 */
const accounts = [
  { id: 'acct-usd', name: 'Wise USD', kind: 'asset', subtype: 'bank', currency: 'USD' },
  { id: 'acct-bank', name: 'BCA Tahapan', kind: 'asset', subtype: 'bank', currency: 'IDR' },
] as AccountRow[];

/** US$100.03 on the USD account — uneven, and uneven the way that tells a floored share from a rounded one. */
const usd: FormDraft = { ...emptyForm('ws-1'), moneyId: 'acct-usd', currency: 'USD', amount: '100.03', categoryId: 'cat-restaurants' };
const person = (name: string) => ({ debtAccountId: '', name, amount: '' });

describe('what the Split row says', () => {
  it('says nothing has been split until something has', () => {
    expect(splitSummary([], 'USD')).toBe('None');
  });

  it('counts the rows and totals them in the currency they are read in', () => {
    const rows = [
      { categoryId: 'cat-groceries', amount: '40.50' },
      { categoryId: 'cat-restaurants', amount: '44.50' },
    ];
    // US$85,00 — not "85.00", which is what a figure written for a form input looks like and what this app
    // reads as eighty-five thousand; and not US$0,85 either, which is the same figure read at IDR's exponent.
    expect(splitSummary(rows, 'USD')).toBe('2 splits · Total US$85,00');
    // The same rows in rupiah are a different figure and a different symbol: the currency is honoured, not assumed.
    expect(splitSummary([{ categoryId: 'cat-groceries', amount: '40500' }], 'IDR')).toBe('1 split · Total Rp\u00a040.500');
  });

  it('says "1 split", the way its two siblings count', () => {
    // Reachable: **+ Split** makes two rows and ✕ takes one away, which used to leave "1 splits · Total …".
    expect(splitSummary([{ categoryId: 'cat-groceries', amount: '40.50' }], 'USD')).toBe('1 split · Total US$40,50');
  });

  it('counts a row that cannot be read yet as nothing rather than throwing the total away', () => {
    // A half-typed figure is the normal state of a row being typed into; the save is what refuses it.
    expect(splitSummary([{ categoryId: 'cat-groceries', amount: '40.50' }, { categoryId: '', amount: '' }], 'USD')).toBe('2 splits · Total US$40,50');
  });
});

describe('what the With row says', () => {
  it('says nobody until somebody is named', () => {
    expect(withSummary(usd, accounts, 'USD')).toBe('None');
    // A row being typed into names nobody, so it is nobody on the bill either.
    expect(withSummary({ ...usd, with: [person('  ')] }, accounts, 'USD')).toBe('None');
  });

  it('counts one person as a person, and says what they owe to the cent', () => {
    // Half of US$100.03 floored is US$50,01, and the odd cent stays with you: rounded it would be 50,02.
    expect(withSummary({ ...usd, withEqually: true, with: [person('Andi')] }, accounts, 'USD')).toBe('1 person · They owe you US$50,01');
  });

  it('counts several, and totals what all of them owe', () => {
    const three = { ...usd, withEqually: true, with: [person('Andi'), person('Budi'), person('Citra')] };
    // floor(10003/4) = 2500 each, so the three of them owe US$75,00 and the odd 3 cents are yours.
    expect(withSummary(three, accounts, 'USD')).toBe('3 people · They owe you US$75,00');
  });

  it('divides what the account was charged, not what was typed at it', () => {
    // US$100 charged to the rupiah account as Rp 1.600.000: the bill is the figure that posts. Halved off the
    // typed figure instead, Andi would owe Rp 50 — and the row would read as an arithmetic mistake.
    const foreign = { ...usd, moneyId: 'acct-bank', amount: '100', chargedAmount: '1600000', withEqually: true, with: [person('Andi')] };
    expect(withSummary(foreign, accounts, 'IDR')).toBe('1 person · They owe you Rp 800.000');
  });

  it('reads the bill in the paying account’s own currency, whatever was typed', () => {
    // Rp 100.003 off the rupiah account: half of it floored is Rp 50.001 — rounded it would be 50.002 — and
    // the figure carries IDR's own symbol and exponent rather than the one the sheet was last read in.
    // (`\u00a0`, because `formatMinor` writes the symbol and the figure with a non-breaking space between.)
    const rupiah = { ...usd, moneyId: 'acct-bank', currency: 'IDR', amount: '100003', withEqually: true, with: [person('Andi')] };
    expect(withSummary(rupiah, accounts, 'IDR')).toBe('1 person · They owe you Rp\u00a050.001');
  });
});

/**
 * The camera in the bar, which replaced §4's Photos row.
 *
 * A corner button carries a glyph and never a word, so its `aria-label` is the whole of what a screen reader
 * gets — the count has to be *in* the name, not only drawn in the badge beside it. And the badge is drawn only
 * when there is something to count: a "0" sitting on the glyph reads as a state rather than as an absence.
 */
describe('what the photos button says and shows', () => {
  it('names the count, and draws a badge only once there is one', () => {
    expect(photosCorner(0)).toEqual({ label: 'Photos', badge: null });
    expect(photosCorner(1)).toEqual({ label: 'Photos, 1 added', badge: '1' });
    expect(photosCorner(2)).toEqual({ label: 'Photos, 2 added', badge: '2' });
    // Nothing caps the figure: the badge grows with its own padding rather than turning into "9+".
    expect(photosCorner(12)).toEqual({ label: 'Photos, 12 added', badge: '12' });
  });
});
