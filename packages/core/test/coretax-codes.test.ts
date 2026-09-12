import { describe, expect, it } from 'vitest';
import {
  type AssetKind,
  ASSET_PRESETS,
  coretaxCodeFor,
  hartaLabel,
  KODE_HARTA,
  KODE_UTANG,
  sectionOfCode,
  UTANG_CODES_UNVERIFIED,
  utangLabel,
} from '../src/index';

/** The hundred each table runs in, per the DJP guide. */
const FAMILY_HUNDREDS: Record<string, string[]> = {
  kas: ['01'],
  piutang: ['02'],
  investasi: ['03'],
  bergerak: ['04'],
  tidak_bergerak: ['05'],
  // Harta Lainnya covers the intangibles at 06 and the movable rest at 07.
  lainnya: ['06', '07'],
};

describe('the harta codes', () => {
  it('are four digits, every one', () => {
    for (const entry of KODE_HARTA) expect(entry.code).toMatch(/^\d{4}$/);
  });

  it('never repeat a code', () => {
    expect(new Set(KODE_HARTA.map((entry) => entry.code)).size).toBe(KODE_HARTA.length);
  });

  it('keep each family in its own hundred', () => {
    for (const entry of KODE_HARTA) expect(FAMILY_HUNDREDS[entry.family]).toContain(entry.code.slice(0, 2));
  });

  it('cover every table the form asks for', () => {
    expect(new Set(KODE_HARTA.map((entry) => entry.family)).size).toBe(6);
  });

  it('say what each one is, in the form own words', () => {
    expect(hartaLabel('0102')).toContain('Tabungan');
    expect(hartaLabel('0307')).toContain('Kontrak investasi kolektif');
    expect(hartaLabel('0701')).toBe('Emas batangan');
    expect(hartaLabel('0502')).toBe('Tanah dan/atau bangunan untuk tempat tinggal');
  });

  it('say nothing for a code that is not on the list', () => {
    expect(hartaLabel('9999')).toBe('');
    // The three-digit codes belong to e-Form, which Coretax does not use.
    expect(hartaLabel('012')).toBe('');
    expect(hartaLabel('051')).toBe('');
  });
});

describe('the utang codes', () => {
  it('are the four the e-Form petunjuk gives', () => {
    expect(KODE_UTANG.map((entry) => entry.code)).toEqual(['101', '102', '103', '104']);
  });

  it('are marked unverified, because the Coretax guide lists none', () => {
    expect(UTANG_CODES_UNVERIFIED).toBe(true);
  });

  it('give a credit card its own code', () => {
    expect(utangLabel('102')).toBe('Kartu kredit');
  });

  it('say nothing for a code that does not exist', () => {
    expect(utangLabel('109')).toBe('');
  });
});

describe('sectionOfCode', () => {
  it('sends each code to its own table', () => {
    expect(sectionOfCode('0102')).toBe('kas');
    expect(sectionOfCode('0201')).toBe('piutang');
    expect(sectionOfCode('0303')).toBe('investasi');
    expect(sectionOfCode('0403')).toBe('bergerak');
    expect(sectionOfCode('0502')).toBe('tidak_bergerak');
  });

  it('puts gold under Harta Lainnya, not investments', () => {
    expect(sectionOfCode('0701')).toBe('lainnya');
  });

  it('puts a patent under Harta Lainnya too, which is where the intangibles live', () => {
    expect(sectionOfCode('0601')).toBe('lainnya');
  });

  it('falls back to Harta Lainnya for a code it does not know', () => {
    expect(sectionOfCode('9999')).toBe('lainnya');
  });
});

describe('coretaxCodeFor', () => {
  const cases: [AssetKind, string][] = [
    ['cash', '0102'],
    ['fund', '0307'],
    ['stock', '0303'],
    ['bond', '0305'],
    ['gold', '0701'],
    ['property', '0502'],
    ['vehicle', '0403'],
    ['other', '0799'],
  ];

  it('starts each kind on the code it implies', () => {
    for (const [kind, code] of cases) expect(coretaxCodeFor(kind)).toBe(code);
  });

  it('calls a fund a collective investment contract, not a bond', () => {
    expect(coretaxCodeFor('fund')).toBe('0307');
    expect(hartaLabel(coretaxCodeFor('fund'))).toContain('kolektif');
  });

  it('treats shares as listed, since that is what is held here', () => {
    expect(coretaxCodeFor('stock')).toBe('0303');
    expect(hartaLabel('0302')).toBe('Saham non bursa');
  });

  it('starts a bond on the government one, which is what ORI and SBSN are', () => {
    expect(hartaLabel(coretaxCodeFor('bond'))).toContain('Obligasi pemerintah');
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
