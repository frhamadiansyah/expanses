import { describe, expect, it } from 'vitest';
import { fundBuy, fundNavText, fundSell, fundUnitsMicro, fundUnitsText, groupTypedAmount, isMoneyMarketFund, parsePriceMicro, parseUnits, sellBasisMinor } from '../src/index';

const NAV = parsePriceMicro('1.843,2715', 'IDR');

describe('a fund bought or sold by amount', () => {
  it('keeps a NAV’s four decimals exactly', () => {
    expect(NAV).toBe(1_843_271_500);
    expect(fundNavText(NAV, 'IDR')).toBe('1.843,2715');
  });

  it('comes to amount ÷ NAV, to four decimal places, a half rounded up', () => {
    expect(fundUnitsMicro(1_000_000, NAV)).toBe(542_513_700);
    expect(fundUnitsText(fundUnitsMicro(1_000_000, NAV))).toBe('542,5137');
    expect(fundUnitsText(fundUnitsMicro(500_000, NAV))).toBe('271,2568');
    // Always a whole ten-thousandth of a unit in the millionths units are stored in.
    expect(fundUnitsMicro(123_457, NAV) % 100).toBe(0);
    // 1 ÷ 0,00016 is 6.250 exactly; 1 ÷ 3 is 0,3333; 2 ÷ 3 is 0,6667 (the half and above go up).
    expect(fundUnitsMicro(1, parsePriceMicro('3', 'IDR'))).toBe(333_300);
    expect(fundUnitsMicro(2, parsePriceMicro('3', 'IDR'))).toBe(666_700);
    expect(fundUnitsMicro(1, parsePriceMicro('20.000', 'IDR'))).toBe(100);
    expect(fundUnitsMicro(1, parsePriceMicro('20.001', 'IDR'))).toBe(0);
  });

  it('a buy needs an amount and a NAV, and charges no fee', () => {
    expect(fundBuy({ amountMinor: 1_000_000, priceMicro: NAV })).toEqual({ unitsMicro: 542_513_700, grossMinor: 1_000_000 });
    expect(fundBuy({ amountMinor: null, priceMicro: NAV })).toBeNull();
    expect(fundBuy({ amountMinor: 0, priceMicro: NAV })).toBeNull();
    expect(fundBuy({ amountMinor: 1_000_000, priceMicro: null })).toBeNull();
  });

  it('All sells every unit exactly, worth the units at the NAV to the rupiah', () => {
    const held = parseUnits('1.356,2481');
    const sell = fundSell({ amountMinor: null, all: true, priceMicro: NAV, heldMicro: held });
    expect(sell).toEqual({ unitsMicro: held, grossMinor: 2_499_933, tooMany: false });
    expect(held - sell!.unitsMicro).toBe(0);
  });

  it('a typed amount sells its units, and one worth more than is held is refused', () => {
    const held = parseUnits('1.356,2481');
    expect(fundSell({ amountMinor: 500_000, all: false, priceMicro: NAV, heldMicro: held })).toEqual({ unitsMicro: 271_256_800, grossMinor: 500_000, tooMany: false });
    expect(fundSell({ amountMinor: 2_500_000, all: false, priceMicro: NAV, heldMicro: held })?.tooMany).toBe(true);
    expect(fundSell({ amountMinor: null, all: false, priceMicro: NAV, heldMicro: held })).toBeNull();
    expect(fundSell({ amountMinor: 500_000, all: false, priceMicro: NAV, heldMicro: 0 })).toBeNull();
  });

  it('the gain on units sold is against their average cost', () => {
    const held = parseUnits('1.356,2481');
    const position = { unitsMicro: held, costMinor: 2_450_000, realizedMinor: 0, incomeMinor: 0, byYear: {} };
    const sell = fundSell({ amountMinor: 500_000, all: false, priceMicro: NAV, heldMicro: held })!;
    // 271,2568 of 1.356,2481 cost 2.450.000 × 271,2568 ÷ 1.356,2481 = 490.013,…
    expect(sellBasisMinor(position, sell.unitsMicro)).toBe(490_013);
  });
});

describe('what else a fund’s sheet needs', () => {
  it('writes units with four decimals at least', () => {
    expect(fundUnitsText(10_000_000)).toBe('10,0000');
    expect(fundUnitsText(1_356_248_100)).toBe('1.356,2481');
    expect(fundUnitsText(1_500_000_000_000)).toBe('1.500.000,0000');
  });

  it('tells a money market fund by its name', () => {
    expect(isMoneyMarketFund('Sucorinvest Money Market Fund')).toBe(true);
    expect(isMoneyMarketFund('Reksadana Pasar Uang Syariah')).toBe(true);
    expect(isMoneyMarketFund('Bahana RDPU')).toBe(true);
    expect(isMoneyMarketFund('Schroder Dana Prestasi Plus')).toBe(false);
    expect(isMoneyMarketFund('Sucorinvest Equity Fund')).toBe(false);
  });

  it('groups a money amount as it is typed', () => {
    expect(groupTypedAmount('1000000', 'IDR')).toBe('1.000.000');
    expect(groupTypedAmount('1.000.0005', 'IDR')).toBe('10.000.005');
    expect(groupTypedAmount('Rp 2,5', 'IDR')).toBe('25');
    expect(groupTypedAmount('', 'IDR')).toBe('');
    expect(groupTypedAmount('007', 'IDR')).toBe('7');
    expect(groupTypedAmount('1234,567', 'USD')).toBe('1.234,56');
    expect(groupTypedAmount('1234,', 'USD')).toBe('1.234,');
  });
});
