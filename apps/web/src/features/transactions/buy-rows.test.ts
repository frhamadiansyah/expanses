import { describe, expect, it } from 'vitest';
import { amountRowText, chargedRowText, feeRowText, goalRowText, holdingFace, holdingRowText, payRowText, unitsRowText } from './buy-rows';

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
    expect(fee.placeholder).toBe('0');
  });

  it('counts units by the holding’s own word, and lots by the lot', () => {
    expect(unitsRowText({ useLots: false, lotSize: null, unitLabel: 'Grams' })).toEqual({
      label: 'Grams',
      caption: 'Grams',
      placeholder: 'How many',
      hint: undefined,
    });
    const lots = unitsRowText({ useLots: true, lotSize: 100, unitLabel: 'Shares' });
    expect(lots.label).toBe('Lots');
    expect(lots.caption).toBe('Lots');
    expect(lots.hint).toBe('100 shares a lot.');
  });

  it('says where the money comes from when buying, and where it lands when selling', () => {
    const buy = payRowText('buy');
    expect(buy.label).toBe('Paid with');
    expect(buy.caption).toBe('Paid with');
    expect(buy.hint).toBe('A credit card works: the card owes more, and the purchase still earns points.');
    const sell = payRowText('sell');
    expect(sell.label).toBe('Proceeds into');
    expect(sell.caption).toBe('Proceeds into');
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
    expect(goalRowText('buy').label).toBe('For goal');
    expect(goalRowText('sell').label).toBe('Sell from goal');
    expect(goalRowText('sell').caption).toBe('Sell from goal');
  });

  it('draws the holding by its own name, with the picker’s group as the caption', () => {
    // The picker's labels are "Investments › Antam" and "Sell › Antam": the group is a caption, not part of a name.
    expect(holdingFace('Investments › Antam')).toBe('Antam');
    expect(holdingFace('Sell › BBRI shares')).toBe('BBRI shares');
    // A label with no group at all is still drawn whole rather than blanked.
    expect(holdingFace('Antam')).toBe('Antam');
    expect(holdingFace('')).toBe('');
    expect(holdingRowText('buy').caption).toBe('Bought');
    expect(holdingRowText('sell').caption).toBe('Sold');
    expect(holdingRowText('buy').label).toBe('What you bought or sold');
    expect(holdingRowText('buy').hint).toBe('Units are recorded, so this never counts as spending.');
  });
});
