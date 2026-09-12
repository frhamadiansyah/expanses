import { describe, expect, it } from 'vitest';
import {
  type AssetKind,
  ASSET_PRESETS,
  CASH_EQUIVALENT_CODE,
  coretaxCodeFor,
  hartaLabel,
  KODE_HARTA,
  KODE_UTANG,
  sectionOfCode,
  utangLabel,
} from '../src/index';

/** The hundred each family runs in, per the form. */
const FAMILY_HUNDREDS: Record<string, string> = {
  kas: '01',
  piutang: '02',
  investasi: '03',
  transportasi: '04',
  bergerak: '05',
  tidak_bergerak: '06',
};

describe('the harta codes', () => {
  it('are three digits, every one', () => {
    for (const entry of KODE_HARTA) expect(entry.code).toMatch(/^\d{3}$/);
  });

  it('never repeat a code', () => {
    expect(new Set(KODE_HARTA.map((entry) => entry.code)).size).toBe(KODE_HARTA.length);
  });

  it('keep each family in its own hundred', () => {
    for (const entry of KODE_HARTA) expect(entry.code.slice(0, 2)).toBe(FAMILY_HUNDREDS[entry.family]);
  });

  it('cover the ones the owner actually holds', () => {
    const codes = KODE_HARTA.map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['012', '014', '021', '032', '034', '036', '043', '051', '061']));
  });

  it('say what each one is, in the form own words', () => {
    expect(hartaLabel('012')).toBe('Tabungan');
    expect(hartaLabel('036')).toBe('Reksadana');
    expect(hartaLabel('051')).toBe('Logam mulia');
    expect(hartaLabel('061')).toBe('Tanah atau bangunan tempat tinggal');
  });

  it('say nothing for a code that is not on the list, rather than guessing', () => {
    expect(hartaLabel('999')).toBe('');
    expect(hartaLabel('0302')).toBe('');
  });
});

describe('the utang codes', () => {
  it('are the four the form allows', () => {
    expect(KODE_UTANG.map((entry) => entry.code)).toEqual(['101', '102', '103', '104']);
  });

  it('give a credit card its own code', () => {
    expect(utangLabel('102')).toBe('Kartu kredit');
  });

  it('name a bank loan as the form does', () => {
    expect(utangLabel('101')).toContain('bank');
  });

  it('say nothing for a code that does not exist', () => {
    // 109 was a placeholder in the design and is not a real code.
    expect(utangLabel('109')).toBe('');
  });
});

describe('sectionOfCode', () => {
  it('follows the family the code belongs to', () => {
    expect(sectionOfCode('012')).toBe('kas');
    expect(sectionOfCode('021')).toBe('piutang');
    expect(sectionOfCode('032')).toBe('investasi');
    expect(sectionOfCode('061')).toBe('tidak_bergerak');
  });

  it('puts a vehicle under Harta Bergerak, which asks for its plate', () => {
    expect(sectionOfCode('043')).toBe('bergerak');
  });

  it('puts gold under Harta Lainnya, not investments', () => {
    expect(sectionOfCode('051')).toBe('lainnya');
  });

  it('falls back to Harta Lainnya for a code it does not know', () => {
    expect(sectionOfCode('999')).toBe('lainnya');
  });
});

describe('coretaxCodeFor', () => {
  const cases: [AssetKind, string][] = [
    ['cash', '012'],
    ['fund', '036'],
    ['stock', '032'],
    ['bond', '034'],
    ['gold', '051'],
    ['property', '061'],
    ['vehicle', '043'],
    ['other', '059'],
  ];

  it('starts each kind on the code it implies', () => {
    for (const [kind, code] of cases) expect(coretaxCodeFor(kind)).toBe(code);
  });

  it('agrees with the preset the asset was created from', () => {
    for (const preset of ASSET_PRESETS) expect(preset.coretaxCode).toBe(coretaxCodeFor(preset.kind));
  });

  it('gives every preset a code that is on the list', () => {
    const codes = new Set(KODE_HARTA.map((entry) => entry.code));
    for (const preset of ASSET_PRESETS) expect(codes.has(preset.coretaxCode)).toBe(true);
  });

  it('puts every preset in the section its code implies', () => {
    for (const preset of ASSET_PRESETS) expect(preset.coretaxSection).toBe(sectionOfCode(preset.coretaxCode));
  });
});

describe('the code still to confirm', () => {
  it('uses 015 for cash equivalents, which two sources of three give', () => {
    expect(CASH_EQUIVALENT_CODE).toBe('015');
    expect(hartaLabel(CASH_EQUIVALENT_CODE)).toBe('Setara kas lainnya');
  });
});
