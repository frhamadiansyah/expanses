import { describe, expect, it } from 'vitest';
import {
  ASSET_FAMILIES,
  ASSET_ITEMS,
  assetFamily,
  assetItem,
  CASH_ITEMS,
  cashCodeForSubtype,
  cashItem,
  DEBT_ITEMS,
  debtItem,
  elseItem,
  HARTA_ENGLISH,
  KODE_HARTA,
  KODE_UTANG,
  type MoneyAccountSubtype,
  searchOwnables,
  sectionOfCode,
  somethingElse,
} from '../src/index';

const HARTA_CODES = new Set(KODE_HARTA.map((entry) => entry.code));
const UTANG_CODES = new Set(KODE_UTANG.map((entry) => entry.code));

describe('the catalogue is a table the tax form recognises', () => {
  it('gives every cash and asset item a code the harta table has', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS]) expect(HARTA_CODES).toContain(item.code);
  });

  it('gives every debt item a code the utang table has', () => {
    for (const item of DEBT_ITEMS) expect(UTANG_CODES).toContain(item.code);
  });

  it('files every item in the table its code belongs to', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS]) expect(item.section).toBe(sectionOfCode(item.code));
    for (const item of DEBT_ITEMS) expect(item.section).toBeNull();
  });

  it('names each thing once per flow', () => {
    for (const items of [CASH_ITEMS, ASSET_ITEMS, DEBT_ITEMS]) {
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    }
  });

  it('gives every item words for the picker and never the code itself', () => {
    for (const item of [...CASH_ITEMS, ...ASSET_ITEMS, ...DEBT_ITEMS]) {
      expect(item.label.length).toBeGreaterThan(2);
      expect(item.label).not.toContain(item.code);
    }
  });
});

describe('cash and cash equivalents', () => {
  const SUBTYPES: MoneyAccountSubtype[] = ['cash', 'bank', 'savings', 'time_deposit', 'ewallet', 'fund', 'other_cash'];

  it('offers the seven kinds of account that hold money, in the order the screen lists them', () => {
    expect(CASH_ITEMS.map((item) => item.id)).toEqual(SUBTYPES);
    expect(CASH_ITEMS.map((item) => item.code)).toEqual(['0101', '0102', '0102', '0104', '0105', '0109', '0109']);
  });

  it('opens an account of its own subtype, and only the deposit cannot be paid from', () => {
    for (const subtype of SUBTYPES) {
      const item = cashItem(subtype);
      expect(item.behaviour).toMatchObject({ opens: 'money', subtype, spendable: subtype !== 'time_deposit' });
    }
    expect(cashItem('time_deposit').behaviour).toMatchObject({ valuedBy: 'deposit' });
    expect(cashItem('bank').behaviour).toMatchObject({ valuedBy: 'balance' });
  });

  it('answers with a default code for any subtype, and falls back to tabungan', () => {
    expect(cashCodeForSubtype('cash')).toBe('0101');
    expect(cashCodeForSubtype('bank')).toBe('0102');
    expect(cashCodeForSubtype('savings')).toBe('0102');
    expect(cashCodeForSubtype('time_deposit')).toBe('0104');
    expect(cashCodeForSubtype('ewallet')).toBe('0105');
    expect(cashCodeForSubtype('fund')).toBe('0109');
    expect(cashCodeForSubtype('other_cash')).toBe('0109');
    expect(cashCodeForSubtype('investment')).toBe('0102');
  });

  it('refuses a subtype it has never heard of', () => {
    expect(() => cashItem('crypto_wallet' as MoneyAccountSubtype)).toThrow(/crypto_wallet/);
  });
});

describe('the five families', () => {
  it('lists them in the order the screen lists them, each naming its table', () => {
    expect(ASSET_FAMILIES.map((family) => family.id)).toEqual(['receivable', 'invest', 'movable', 'immovable', 'other']);
    expect(ASSET_FAMILIES.map((family) => family.section)).toEqual(['piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya']);
  });

  it('keeps the eight kinds the app already had as ids, so nothing already written has to move', () => {
    expect(assetItem('gold')).toMatchObject({ code: '0701', behaviour: { assetKind: 'gold', valuedBy: 'grams', unitKind: 'grams' } });
    expect(assetItem('stock')).toMatchObject({ code: '0303', behaviour: { assetKind: 'stock', valuedBy: 'units', unitKind: 'shares', lotSize: 100 } });
    expect(assetItem('fund')).toMatchObject({ code: '0307', behaviour: { assetKind: 'fund', valuedBy: 'units', unitKind: 'units' } });
    expect(assetItem('bond')).toMatchObject({ code: '0305', behaviour: { assetKind: 'bond', valuedBy: 'face', unitKind: 'face' } });
    expect(assetItem('property')).toMatchObject({ code: '0502', behaviour: { assetKind: 'property', valuedBy: 'value' } });
    expect(assetItem('vehicle')).toMatchObject({ code: '0403', behaviour: { assetKind: 'vehicle', valuedBy: 'value' } });
    expect(assetItem('other')).toMatchObject({ code: '0799', behaviour: { assetKind: 'other', valuedBy: 'value' } });
    // Money added as an asset: kept for what is already there, never offered in the picker.
    expect(assetItem('cash')).toMatchObject({ code: '0102', behaviour: { assetKind: 'cash', valuedBy: 'balance' }, inPicker: false });
    expect(ASSET_FAMILIES.flatMap((family) => family.items).map((item) => item.id)).not.toContain('cash');
    // It is the only one marked so: everything else the catalogue names is a thing a picker may offer.
    expect([...CASH_ITEMS, ...ASSET_ITEMS, ...DEBT_ITEMS].filter((item) => item.inPicker === false).map((item) => item.id)).toEqual(['cash']);
  });

  it('values investments the way each is actually priced', () => {
    expect(assetFamily('invest').items.map((item) => item.code)).toEqual(['0303', '0302', '0307', '0304', '0305', '0308', '0310', '0311']);
    expect(assetItem('unlisted_stock').behaviour).toMatchObject({ assetKind: 'other', valuedBy: 'value', planGroup: 'invest' });
    expect(assetItem('corporate_bond').behaviour).toMatchObject({ assetKind: 'bond', valuedBy: 'face' });
    expect(assetItem('unit_link').behaviour).toMatchObject({ assetKind: 'other', valuedBy: 'value', planGroup: 'invest' });
  });

  it('lets a receivable take its value from the ledger, never from a number typed', () => {
    expect(assetFamily('receivable').items.map((item) => item.code)).toEqual(['0201', '0202', '0209']);
    for (const item of assetFamily('receivable').items) {
      expect(item.behaviour).toMatchObject({ opens: 'person', direction: 'lent', valuedBy: 'ledger' });
    }
  });

  it('puts things you live with under personal use and things that grow under investments', () => {
    expect(assetItem('apartment').behaviour).toMatchObject({ assetKind: 'property', planGroup: 'use', valuedBy: 'value' });
    expect(assetItem('motorcycle').behaviour).toMatchObject({ assetKind: 'vehicle', planGroup: 'use' });
    expect(assetItem('gold_jewellery').behaviour).toMatchObject({ assetKind: 'gold', planGroup: 'invest', valuedBy: 'grams', orTyped: true });
    expect(assetItem('patent').behaviour).toMatchObject({ assetKind: 'other', planGroup: 'use' });
  });
});

describe('something else', () => {
  it('offers exactly what the family has not spent, in the order the form lists it', () => {
    expect(somethingElse('receivable')).toEqual([]);
    expect(somethingElse('invest').map((code) => code.code)).toEqual(['0301', '0306', '0309', '0399']);
    expect(somethingElse('movable').map((code) => code.code)).toEqual(['0401', '0404', '0405', '0406', '0407', '0408', '0409', '0410', '0411', '0412']);
    expect(somethingElse('immovable').map((code) => code.code)).toEqual(['0504', '0505']);
    expect(somethingElse('other').map((code) => code.code)).toEqual(['0699', '0707', '0711', '0712']);
  });

  it('accounts for every harta code once: an item of a family, or something else in it', () => {
    const named = new Set([...CASH_ITEMS, ...ASSET_ITEMS].map((item) => item.code));
    const spare = new Set(ASSET_FAMILIES.flatMap((family) => somethingElse(family.id)).map((code) => code.code));
    for (const code of spare) expect(named.has(code)).toBe(false);
    // Only the four kas codes the account screen deliberately leaves out are unreachable.
    const unreachable = KODE_HARTA.filter((entry) => !named.has(entry.code) && !spare.has(entry.code));
    expect(unreachable.map((entry) => entry.code)).toEqual(['0103', '0106', '0107', '0108']);
  });

  it('records anything else as a thing you give a value to, filed under its family', () => {
    const bus = elseItem('movable', '0404');
    expect(bus).toMatchObject({ id: 'else:0404', label: 'Bus', code: '0404', section: 'bergerak' });
    expect(bus.behaviour).toMatchObject({ opens: 'holding', assetKind: 'vehicle', planGroup: 'use', valuedBy: 'value' });
    expect(bus.sub).toBe('Bus');
    expect(elseItem('other', '0711')).toMatchObject({ label: 'Jet ski', sub: 'Jet ski', section: 'lainnya' });
    expect(elseItem('invest', '0399').behaviour).toMatchObject({ assetKind: 'other', planGroup: 'invest' });
    expect(assetItem('else:0404')).toEqual(bus);
  });

  it('refuses a code the family does not hold', () => {
    expect(() => elseItem('movable', '0502')).toThrow(/0502/);
  });

  /** `elseItem` reads its label straight out of `HARTA_ENGLISH`; a code with no gloss would be labelled undefined. */
  it('has English words for every code it can reach', () => {
    for (const family of ASSET_FAMILIES) {
      for (const entry of somethingElse(family.id)) {
        expect((HARTA_ENGLISH as Record<string, string>)[entry.code], entry.code).toBeTruthy();
      }
    }
  });
});

describe('debts', () => {
  it('lists them the way someone would say them, with the code behind each', () => {
    expect(DEBT_ITEMS.map((item) => item.code)).toEqual(['101', '101', '101', '102', '101', '101', '101', '103', '109']);
    expect(debtItem('home_mortgage').behaviour).toMatchObject({ opens: 'loan', asksRate: true });
    expect(debtItem('online_loan').behaviour).toMatchObject({ opens: 'loan', asksRate: false });
    expect(debtItem('credit_card').behaviour).toMatchObject({ opens: 'card' });
    expect(debtItem('affiliate_debt').behaviour).toMatchObject({ opens: 'person', direction: 'borrowed' });
    expect(debtItem('other_debt')).toMatchObject({ code: '109', behaviour: { opens: 'person', direction: 'borrowed' } });
  });
});

describe('searching', () => {
  it('finds a thing by its name, by its quieter line, and by its code', () => {
    expect(searchOwnables('gopay', 'account').map((item) => item.id)).toEqual(['ewallet']);
    expect(searchOwnables('reksadana', 'asset').map((item) => item.id)).toEqual(['fund']);
    expect(searchOwnables('0503', 'asset').map((item) => item.id)).toEqual(['apartment']);
    expect(searchOwnables('paylater', 'debt').map((item) => item.id)).toEqual(['online_loan']);
  });

  it('needs every word to match, and answers nothing rather than everything', () => {
    expect(searchOwnables('gold jewellery', 'asset').map((item) => item.id)).toEqual(['gold_jewellery']);
    expect(searchOwnables('helicopter', 'asset')).toEqual([]);
    expect(searchOwnables('', 'asset').length).toBe(ASSET_ITEMS.length);
  });

  it('matches as it is typed, one word at a time, never inside an unrelated compound word', () => {
    // Prefix, not full-word: found before the last letter is typed.
    expect(searchOwnables('moto', 'asset').map((item) => item.id)).toEqual(['motorcycle']);
    expect(searchOwnables('apart', 'asset').map((item) => item.id)).toEqual(['apartment']);
    // A hyphenated label is still found by its first word.
    expect(searchOwnables('unit', 'asset').map((item) => item.id)).toEqual(['stock', 'fund', 'unit_link']);
    // The prefix still respects word starts: "gold" never lands inside "Non-gold jewellery".
    expect(searchOwnables('gold jewellery', 'asset').map((item) => item.id)).toEqual(['gold_jewellery']);
  });
});
