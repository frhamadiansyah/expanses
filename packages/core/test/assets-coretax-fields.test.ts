import { describe, expect, it } from 'vitest';
import { ASSET_PRESETS, CORETAX_SECTIONS, type CoretaxSection, missingCoretaxFields, presetFor, validateCoretaxFields } from '../src/index';

describe('asset presets', () => {
  it('names a Coretax section that exists and a four-digit code', () => {
    for (const preset of ASSET_PRESETS) {
      expect(CORETAX_SECTIONS[preset.coretaxSection], preset.kind).toBeDefined();
      expect(preset.coretaxCode, preset.kind).toMatch(/^\d{4}$/);
    }
  });

  it('covers every kind exactly once', () => {
    const kinds = ASSET_PRESETS.map((p) => p.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(kinds).toEqual(expect.arrayContaining(['fund', 'stock', 'bond', 'gold', 'property', 'vehicle', 'other', 'cash']));
  });

  it('measures gold in grams under Harta Lainnya', () => {
    const gold = presetFor('gold');
    expect(gold).toMatchObject({ subtype: 'investment', valuationMode: 'market', unitKind: 'grams', risk: 'medium', planGroup: 'invest', coretaxSection: 'lainnya' });
  });

  it('counts shares in lots of 100', () => {
    expect(presetFor('stock')).toMatchObject({ unitKind: 'shares', lotSize: 100, risk: 'high', coretaxSection: 'investasi', coretaxCode: '0303' });
  });

  it('values property and vehicles from your own estimate', () => {
    expect(presetFor('property')).toMatchObject({ subtype: 'property', valuationMode: 'snapshot', unitKind: null, planGroup: 'use', coretaxSection: 'tidak_bergerak' });
    expect(presetFor('vehicle')).toMatchObject({ subtype: 'vehicle', valuationMode: 'snapshot', planGroup: 'use', coretaxSection: 'bergerak' });
  });

  it('keeps bank accounts on the ledger balance', () => {
    expect(presetFor('cash')).toMatchObject({ valuationMode: 'derived', planGroup: 'liquid', coretaxSection: 'kas', unitKind: null });
  });
});

describe('the fields each converter insists on', () => {
  const keysOf = (section: CoretaxSection) => CORETAX_SECTIONS[section].fields.map((f) => f.key);
  const requiredOf = (section: CoretaxSection) => CORETAX_SECTIONS[section].fields.filter((f) => f.required).map((f) => f.key);

  it('asks piutang for the country and the borrower identity number', () => {
    expect(keysOf('piutang')).toEqual(expect.arrayContaining(['loc', 'idno', 'name']));
    expect(requiredOf('piutang')).toEqual(expect.arrayContaining(['loc', 'idno', 'name']));
  });

  it('asks harta bergerak who owns it, by name and NPWP', () => {
    expect(keysOf('bergerak')).toEqual(expect.arrayContaining(['model', 'plate', 'own', 'ownerNpwp', 'ownerName']));
    expect(requiredOf('bergerak')).toEqual(expect.arrayContaining(['ownerNpwp', 'ownerName']));
  });

  it('requires an account number for kas, which DJP stars', () => {
    expect(requiredOf('kas')).toContain('acct');
  });

  it('requires the ownership proof and identity for a securities holding', () => {
    expect(requiredOf('investasi')).toEqual(expect.arrayContaining(['npwp', 'sid']));
  });

  it('requires the ownership proof for harta lainnya too', () => {
    expect(requiredOf('lainnya')).toContain('cert');
  });

  it('keeps every field a section already had', () => {
    expect(keysOf('tidak_bergerak')).toEqual(['loc', 'land', 'bldg', 'source', 'cert']);
    expect(keysOf('kas')).toEqual(['acct', 'owner', 'inst', 'loc']);
  });
});

describe('Coretax sections', () => {
  it('gives every field a label and a kind', () => {
    for (const [section, definition] of Object.entries(CORETAX_SECTIONS)) {
      expect(definition.label, section).toBeTruthy();
      expect(definition.fields.length, section).toBeGreaterThan(0);
      for (const field of definition.fields) {
        expect(field.label, `${section}.${field.key}`).toBeTruthy();
        expect(['text', 'npwp', 'country', 'number', 'year'], `${section}.${field.key}`).toContain(field.kind);
      }
    }
  });

  it('covers the six Bagian A tables', () => {
    const sections: CoretaxSection[] = ['kas', 'piutang', 'investasi', 'bergerak', 'tidak_bergerak', 'lainnya'];
    for (const section of sections) expect(CORETAX_SECTIONS[section]).toBeDefined();
  });
});

describe('validateCoretaxFields', () => {
  it('accepts a filled-in bank account', () => {
    const problems = validateCoretaxFields('kas', { acct: '••••4821', owner: 'Dimas Wijaya', inst: 'PT Bank Central Asia Tbk', loc: 'IDN' });
    expect(problems).toEqual([]);
  });

  it('rejects an NPWP that is not 16 digits', () => {
    const problems = validateCoretaxFields('investasi', { npwp: '12345', loc: 'IDN', inst: 'PT Contoh', sid: 'IDD1234' });
    expect(problems.map((p) => p.key)).toEqual(['npwp']);
    expect(problems[0]!.message).toMatch(/16/);
  });

  it('accepts an NPWP written with spaces', () => {
    expect(validateCoretaxFields('investasi', { npwp: '0012 3456 7801 2000', loc: 'IDN', inst: 'PT Contoh', sid: '' })).toEqual([]);
  });

  it('rejects a country that is not a three-letter code', () => {
    expect(validateCoretaxFields('kas', { loc: 'Indonesia' }).map((p) => p.key)).toEqual(['loc']);
  });

  it('rejects a size that is not a number', () => {
    expect(validateCoretaxFields('tidak_bergerak', { land: '120 meter' }).map((p) => p.key)).toEqual(['land']);
  });

  it('leaves empty values to missingCoretaxFields', () => {
    expect(validateCoretaxFields('tidak_bergerak', { loc: '', land: '', cert: '' })).toEqual([]);
  });

  it('reports a key the section does not have', () => {
    expect(validateCoretaxFields('kas', { nonsense: 'x' }).map((p) => p.key)).toEqual(['nonsense']);
  });
});

describe('missingCoretaxFields', () => {
  it('lists required keys that are empty or absent', () => {
    expect(missingCoretaxFields('tidak_bergerak', { loc: 'Jl. Contoh Raya No. 12', land: '120', bldg: '90', source: 'Utang (KPR)', cert: '' })).toEqual(['cert']);
  });

  it('is empty when everything required is filled in', () => {
    expect(missingCoretaxFields('lainnya', { cert: 'Antam certificates', info: 'Emas batangan Antam' })).toEqual([]);
  });

  it('ignores a key the section never asked for', () => {
    const filled = { acct: '1234567890', owner: 'Dimas Wijaya', inst: 'PT Bank Central Asia Tbk', loc: 'IDN', nickname: 'Gaji' };
    expect(missingCoretaxFields('kas', filled)).toEqual([]);
  });

  it('reports the account number, which the converter stars', () => {
    expect(missingCoretaxFields('kas', { owner: 'Dimas Wijaya', inst: 'PT Bank Central Asia Tbk', loc: 'IDN' })).toEqual(['acct']);
  });
});
