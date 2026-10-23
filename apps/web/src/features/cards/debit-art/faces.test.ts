import { INDONESIAN_BANKS } from '@expanses/core';
import { describe, expect, it } from 'vitest';
import { faceFor, faceNamed, holderLine, TIERS, tieredKey } from './faces';
import { FACES } from './faces.generated';

describe('faceNamed: the face a bank or app name finds', () => {
  it('finds a bank by the name the tax report stores, by its short name, and whatever the case', () => {
    expect(faceNamed('Bank Mandiri')?.key).toBe('mandiri');
    expect(faceNamed('Mandiri')?.key).toBe('mandiri');
    expect(faceNamed('MANDIRI PAYROLL')?.key).toBe('mandiri');
    expect(faceNamed('bank central asia')?.key).toBe('bca');
    expect(faceNamed('BCA Tahapan')?.key).toBe('bca');
    expect(faceNamed('CIMB Niaga')?.key).toBe('cimb');
    expect(faceNamed('cimb')?.key).toBe('cimb');
    expect(faceNamed('Jenius')?.key).toBe('jenius');
    expect(faceNamed('Bank SMBC Indonesia')?.key).toBe('jenius');
    expect(faceNamed('SMBC')?.key).toBe('jenius');
    expect(faceNamed('blu')?.key).toBe('blu');
    expect(faceNamed('BCA Digital')?.key).toBe('blu');
    expect(faceNamed('SeaBank')?.key).toBe('seabank');
  });

  it('the longest name found wins, so a bank inside another name is not mistaken for it', () => {
    // "BCA Digital" is blu, not BCA; "BCA Syariah" is a bank with no face, and is not BCA either.
    expect(faceNamed('blu by BCA Digital')?.key).toBe('blu');
    expect(faceNamed('BCA Syariah')).toBeNull();
    // Mandiri's prepaid card over Mandiri's debit card.
    expect(faceNamed('Mandiri e-money')?.key).toBe('emoney');
    expect(faceNamed('mandiri e-money')?.kind).toBe('emoney');
  });

  it('matches whole words only: "GoPay" is not inside "GoPayLater", nor "BRI" inside "Brizzi"', () => {
    expect(faceNamed('GoPay')?.key).toBe('gopay');
    expect(faceNamed('GoPayLater', ['paylater'])?.key).toBe('gopaylater');
    expect(faceNamed('GoPayLater')).toBeNull();
    expect(faceNamed('Brizzi')?.key).toBe('brizzi');
    expect(faceNamed('BRIZZI BRI')?.key).toBe('brizzi');
    expect(faceNamed('Bribery fund')).toBeNull();
  });

  it('knows the wallets and prepaid cards by name, with their kinds', () => {
    expect(faceNamed('OVO')).toMatchObject({ key: 'ovo', kind: 'ewallet', mark: 'OVO' });
    expect(faceNamed('ShopeePay')?.key).toBe('shopeepay');
    expect(faceNamed('DANA')?.kind).toBe('ewallet');
    expect(faceNamed('LinkAja')?.key).toBe('linkaja');
    expect(faceNamed('Flazz')).toMatchObject({ key: 'flazz', kind: 'emoney' });
    expect(faceNamed('BNI TapCash')?.key).toBe('tapcash');
    expect(faceNamed('JakCard')?.key).toBe('jakcard');
  });

  it('a PayLater line is found only when asked for, so a bank account is never drawn as one', () => {
    expect(faceNamed('Kredivo')).toBeNull();
    expect(faceNamed('Kredivo', ['paylater'])).toMatchObject({ key: 'kredivo', kind: 'paylater' });
    expect(faceNamed('SPayLater', ['paylater'])?.key).toBe('spaylater');
    expect(faceNamed('Shopee PayLater', ['paylater'])?.key).toBe('spaylater');
    expect(faceNamed('Akulaku', ['paylater'])?.key).toBe('akulaku');
    // And asked for a PayLater face, a bank's name finds nothing.
    expect(faceNamed('Bank Mandiri', ['paylater'])).toBeNull();
  });

  it('finds nothing in a name it does not know, or in no name at all', () => {
    expect(faceNamed('Bank One')).toBeNull();
    expect(faceNamed('Everyday')).toBeNull();
    expect(faceNamed('')).toBeNull();
    expect(faceNamed('   ')).toBeNull();
    expect(faceNamed(null)).toBeNull();
    expect(faceNamed(undefined)).toBeNull();
  });
});

describe('faceFor: the first of an account’s names that finds a face', () => {
  it('reads the bank first and the account’s own name after it', () => {
    expect(faceFor(['Bank Mandiri', 'OVO'])?.key).toBe('mandiri');
    expect(faceFor([null, 'Payroll'])).toBeNull();
    expect(faceFor([undefined, 'Bank One', 'Rainy day'])).toBeNull();
    // A bank with no face does not stop the account's name from finding one: Bank DKI's prepaid card.
    expect(faceFor(['Bank DKI', 'JakCard'])?.key).toBe('jakcard');
    expect(faceFor([])).toBeNull();
  });
});

describe('tiers', () => {
  it('a bank with tiers carries them in its own words; a bank without has none', () => {
    expect(faceNamed('Bank Mandiri')?.tiers?.map((t) => t.id)).toEqual(['standard', 'gold', 'platinum', 'prioritas']);
    expect(faceNamed('BCA')?.tiers?.map((t) => t.label)).toEqual(['Paspor blue', 'Paspor gold', 'Paspor platinum', 'Prioritas']);
    expect(faceNamed('BSI')?.tiers?.map((t) => t.id)).toEqual(['silver', 'gold', 'platinum']);
    expect(faceNamed('CIMB')?.tiers?.map((t) => t.id)).toEqual(['standard', 'preferred']);
    expect(faceNamed('BRI')?.tiers).toBeUndefined();
  });

  it('tieredKey: the tier’s art, else the bank’s own when the tier is unset or not one of the bank’s', () => {
    const mandiri = faceNamed('Bank Mandiri')!;
    expect(tieredKey(mandiri, null)).toBe('mandiri');
    expect(tieredKey(mandiri, undefined)).toBe('mandiri');
    expect(tieredKey(mandiri, 'standard')).toBe('mandiri');
    expect(tieredKey(mandiri, 'gold')).toBe('mandiri-gold');
    expect(tieredKey(mandiri, 'prioritas')).toBe('mandiri-prioritas');
    expect(tieredKey(mandiri, 'preferred')).toBe('mandiri');
    expect(tieredKey(faceNamed('BCA')!, 'prioritas')).toBe('bca-prioritas');
    expect(tieredKey(faceNamed('CIMB')!, 'preferred')).toBe('cimb-preferred');
    expect(tieredKey(faceNamed('BRI')!, 'gold')).toBe('bri');
  });

  it('every face a name can find, at every tier, has art drawn for it', () => {
    const names = [...INDONESIAN_BANKS.map((b) => b.name), 'OVO', 'ShopeePay', 'GoPay', 'DANA', 'LinkAja', 'Mandiri e-money', 'Flazz', 'Brizzi', 'TapCash', 'JakCard'];
    const found = names.map((name) => faceNamed(name)).filter((face) => face !== null);
    expect(found.length).toBeGreaterThan(30);
    for (const face of found) {
      expect(FACES[face.key], face.key).toBeDefined();
      for (const tier of face.tiers ?? []) expect(FACES[tier.key], tier.key).toBeDefined();
    }
    for (const face of ['Kredivo', 'Akulaku', 'SPayLater', 'GoPayLater'].map((name) => faceNamed(name, ['paylater'])!)) expect(FACES[face.key], face.key).toBeDefined();
    for (const key of Object.keys(TIERS)) expect(FACES[key], key).toBeDefined();
  });

  it('the art carries what the print needs: an ink, and a chip only on a debit face', () => {
    for (const [key, art] of Object.entries(FACES)) {
      expect(['light', 'dark'], key).toContain(art.ink);
      expect(art.art, key).toContain('<rect width="340" height="214"');
      expect(art.art, key).not.toContain('<text x="22"');
    }
    expect(FACES.mandiri!.chip).toBe('silver');
    expect(FACES['mandiri-gold']!.chip).toBe('gold');
    expect(FACES.mandiri!.bank).toBe('#173f86');
    expect(FACES.ovo!.chip).toBeUndefined();
    expect(FACES.maybank!.ink).toBe('dark');
  });
});

describe('holderLine', () => {
  it('names what a face without a holder is, and leaves a debit card to its holder', () => {
    expect(holderLine('ewallet')).toBe('E-WALLET');
    expect(holderLine('emoney')).toBe('E-MONEY');
    expect(holderLine('paylater')).toBe('PAYLATER');
    expect(holderLine('debit')).toBeNull();
  });
});
