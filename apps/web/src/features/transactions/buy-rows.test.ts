import { describe, expect, it } from 'vitest';
import { amountRowText, chargedRowText, feeRowText, goalRowText, holdingFace, holdingRowText, pastWord, payRowText, unitsRowText, unitWord } from './buy-rows';

/**
 * The Buy / sell tab reads like Expense, Income and Transfer: every row is a glyph, a value on the left and a
 * small grey caption on the right. That moves the currency out of the label and into the flag beside the figure —
 * but **not** out of the accessible name, which is what every journey and every screen reader already knows the
 * row by. These are the two halves of each row, said once, so a row cannot drift into naming itself two ways.
 */
describe('what each Buy / sell row says', () => {
  it('keeps the currency in the amount row’s name and takes it out of what is drawn', () => {
    const buy = amountRowText('buy', 'IDR');
    expect(buy.label).toBe('What it cost, before fees (IDR)');
    expect(buy.placeholder).toBe('What it cost, before fees');
    // The flag beside the figure already says IDR; the caption is the code, exactly as the Expense tab's row.
    expect(buy.caption).toBe('IDR');
  });

  it('asks a sell for its proceeds, in the holding’s currency', () => {
    const sell = amountRowText('sell', 'USD');
    expect(sell.label).toBe('Proceeds, before fees (USD)');
    expect(sell.placeholder).toBe('Proceeds, before fees');
    expect(sell.caption).toBe('USD');
  });

  it('names the fee by its currency and captions it by what it is', () => {
    // Two money rows in a row would both be captioned "IDR" and neither would say which was which.
    const fee = feeRowText('USD');
    expect(fee.label).toBe('Fee (USD)');
    expect(fee.caption).toBe('Fee');
    expect(fee.placeholder).toBe('Amount');
  });

  it('counts units by the holding’s own word, and lots by the lot', () => {
    expect(unitsRowText({ useLots: false, lotSize: null, unitLabel: 'Grams' })).toEqual({
      label: 'Grams',
      caption: 'Grams',
      placeholder: 'How many',
    });
    const lots = unitsRowText({ useLots: true, lotSize: 100, unitLabel: 'Shares' });
    expect(lots.label).toBe('Lots');
    expect(lots.caption).toBe('Lots · 100 shares');
    expect(lots.hint).toBeUndefined();
  });

  it('says where the money comes from when buying, and where it lands when selling', () => {
    const buy = payRowText('buy');
    expect(buy.label).toBe('Paid with');
    expect(buy.caption).toBe('Paid with');
    expect(buy.hint).toBeUndefined();
    // Received into, as the Income form says it (owner, 13 Nov 2026) — not Proceeds into, To or Money account.
    const sell = payRowText('sell');
    expect(sell.label).toBe('Received into');
    expect(sell.caption).toBe('Received into');
    expect(payRowText('income').label).toBe('Received into');
    // A sell into a card is refused by `purchaseDraftToInput`, so the row does not offer one in words either.
    expect(sell.hint).toBeUndefined();
  });

  it('asks the charged row what the account itself moved', () => {
    const buy = chargedRowText({ mode: 'buy', cashCurrency: 'IDR', moneyName: 'BCA Tahapan' });
    expect(buy.label).toBe('Charged in IDR');
    expect(buy.caption).toBe('Charged in IDR');
    expect(buy.hint).toBe('What left BCA Tahapan, in IDR.');
    expect(chargedRowText({ mode: 'sell', cashCurrency: 'IDR', moneyName: 'BCA Tahapan' }).hint).toBe('What reached BCA Tahapan, in IDR.');
  });

  it('calls the goal row what the trade does to the goal', () => {
    expect(goalRowText('buy').label).toBe('Goal');
    expect(goalRowText('sell').label).toBe('From goal');
    expect(goalRowText('sell').caption).toBe('From goal');
  });

  it('draws the holding by its own name, with the picker’s group as the caption', () => {
    // Older labels carried a group — "Investments › Antam" — which is not part of a name.
    expect(holdingFace('Investments › Antam')).toBe('Antam');
    expect(holdingFace('Sell › BBRI shares')).toBe('BBRI shares');
    // A label with no group at all is still drawn whole rather than blanked.
    expect(holdingFace('Antam')).toBe('Antam');
    expect(holdingFace('')).toBe('');
    // Like Expense's Category row: the name and nothing else — no Bought / Sold caption, no second line.
    expect(holdingRowText().caption).toBe('');
    expect(holdingRowText().label).toBe('Investment');
    expect(holdingRowText().hint).toBeUndefined();
  });

  it('says what a trade made before the app was, where the account would be', () => {
    expect(pastWord('buy')).toBe('Past purchase');
    expect(pastWord('sell')).toBe('Past sale');
    expect(pastWord('income')).toBe('Past payment');
  });

  it('names the units row by how the holding is counted', () => {
    expect(unitWord('grams')).toBe('Grams');
    expect(unitWord('shares')).toBe('Shares');
    expect(unitWord('face')).toBe('Par value');
    expect(unitWord('units')).toBe('Units');
    // A holding with no profile, or a kind this list does not know, is counted in units.
    expect(unitWord(null)).toBe('Units');
    expect(unitWord('lots')).toBe('Units');
  });
});
