import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACES } from './faces.generated';
import { PROGRAMME_FAMILIES, programmeFace, programmeFaceRef, programmeFamily, programmeTier } from './programmes';

/** Every face key, from the approved drawings in docs/card-art/membership. */
const DRAWN = readdirSync(new URL('../../../../../../docs/card-art/membership/', import.meta.url))
  .filter((file) => file.endsWith('.svg'))
  .map((file) => file.slice(0, -'.svg'.length))
  .sort();

describe('programmeFace: the membership card a programme is drawn as', () => {
  it('finds each family by its own name, whatever the case', () => {
    expect(programmeFace('KrisFlyer', null)).toBe('krisflyer');
    expect(programmeFace('krisflyer', null)).toBe('krisflyer');
    expect(programmeFace('KRISFLYER', null)).toBe('krisflyer');
    expect(programmeFace('Asia Miles', null)).toBe('asiamiles');
    expect(programmeFace('Marriott Bonvoy', null)).toBe('bonvoy');
    expect(programmeFace('ALL Accor', null)).toBe('accor');
    expect(programmeFace('GarudaMiles', null)).toBe('garudamiles');
    expect(programmeFace('JAL Mileage Bank', null)).toBe('jmb');
    expect(programmeFace('Privilege Club', null)).toBe('privilegeclub');
    expect(programmeFace('ANA Mileage Club', null)).toBe('ana');
  });

  it('finds a family by the other names it goes by', () => {
    expect(programmeFace('Kris Flyer', null)).toBe('krisflyer');
    expect(programmeFace('BCA KrisFlyer', null)).toBe('krisflyer');
    expect(programmeFace('Cathay', null)).toBe('asiamiles');
    expect(programmeFace('Cathay Pacific Asia Miles', null)).toBe('asiamiles');
    expect(programmeFace('AsiaMiles', null)).toBe('asiamiles');
    expect(programmeFace('Marco Polo Club', null)).toBe('asiamiles');
    expect(programmeFace('Bonvoy', null)).toBe('bonvoy');
    expect(programmeFace('Marriott', null)).toBe('bonvoy');
    expect(programmeFace('Accor', null)).toBe('accor');
    expect(programmeFace('Accor Plus', null)).toBe('accor');
    expect(programmeFace('Le Club AccorHotels', null)).toBe('accor');
    expect(programmeFace('Garuda', null)).toBe('garudamiles');
    expect(programmeFace('Garuda Miles', null)).toBe('garudamiles');
    expect(programmeFace('Garuda Indonesia GarudaMiles', null)).toBe('garudamiles');
    expect(programmeFace('JAL', null)).toBe('jmb');
    expect(programmeFace('JMB', null)).toBe('jmb');
    expect(programmeFace('Mileage Bank', null)).toBe('jmb');
    expect(programmeFace('Qatar Airways', null)).toBe('privilegeclub');
    expect(programmeFace('Qatar Avios', null)).toBe('privilegeclub');
    expect(programmeFace('Qatar Privilege Club', null)).toBe('privilegeclub');
    expect(programmeFace('ANA', null)).toBe('ana');
    expect(programmeFace('ANA Mileage', null)).toBe('ana');
  });

  it('matches whole words only', () => {
    // "ana" is not inside "Banana" or "Ananda", "jal" not inside "Jalan", "garuda" not inside "Garudafood".
    expect(programmeFace('Banana Rewards', null)).toBeNull();
    expect(programmeFace('Ananda points', null)).toBeNull();
    expect(programmeFace('Jalan-jalan fund', null)).toBeNull();
    expect(programmeFace('Garudafood', null)).toBeNull();
    expect(programmeFace('Cathayan', null)).toBeNull();
  });

  it('Avios alone is not Qatar’s: British Airways’ keeps the plain face', () => {
    expect(programmeFace('Avios', null)).toBeNull();
    expect(programmeFace('British Airways Avios', null)).toBeNull();
  });

  it('a name no family knows keeps the plain face', () => {
    expect(programmeFace("Livin' Poin", null)).toBeNull();
    expect(programmeFace('BCA Rewards', 'gold')).toBeNull();
    expect(programmeFace('Hilton Honors', null)).toBeNull();
    expect(programmeFace('', null)).toBeNull();
    expect(programmeFace('   ', null)).toBeNull();
    expect(programmeFace(null, null)).toBeNull();
    expect(programmeFace(undefined, 'gold')).toBeNull();
  });

  it('the tier picks the card within the family', () => {
    expect(programmeFace('KrisFlyer', 'member')).toBe('krisflyer');
    expect(programmeFace('KrisFlyer', 'silver')).toBe('krisflyer-silver');
    expect(programmeFace('KrisFlyer', 'gold')).toBe('krisflyer-gold');
    expect(programmeFace('Asia Miles', 'green')).toBe('asiamiles');
    expect(programmeFace('Asia Miles', 'silver')).toBe('asiamiles-silver');
    expect(programmeFace('Asia Miles', 'gold')).toBe('asiamiles-gold');
    expect(programmeFace('Asia Miles', 'diamond')).toBe('asiamiles-diamond');
    expect(programmeFace('Marriott Bonvoy', 'member')).toBe('bonvoy');
    expect(programmeFace('Marriott Bonvoy', 'silver')).toBe('bonvoy-silver');
    expect(programmeFace('Marriott Bonvoy', 'gold')).toBe('bonvoy-gold');
    expect(programmeFace('Marriott Bonvoy', 'platinum')).toBe('bonvoy-platinum');
    expect(programmeFace('Marriott Bonvoy', 'titanium')).toBe('bonvoy-titanium');
    expect(programmeFace('Marriott Bonvoy', 'ambassador')).toBe('bonvoy-ambassador');
    expect(programmeFace('ALL Accor', 'classic')).toBe('accor');
    expect(programmeFace('ALL Accor', 'silver')).toBe('accor-silver');
    expect(programmeFace('ALL Accor', 'gold')).toBe('accor-gold');
    expect(programmeFace('ALL Accor', 'platinum')).toBe('accor-platinum');
    expect(programmeFace('GarudaMiles', 'blue')).toBe('garudamiles');
    expect(programmeFace('GarudaMiles', 'silver')).toBe('garudamiles-silver');
    expect(programmeFace('GarudaMiles', 'gold')).toBe('garudamiles-gold');
    expect(programmeFace('GarudaMiles', 'platinum')).toBe('garudamiles-platinum');
    expect(programmeFace('JAL Mileage Bank', 'member')).toBe('jmb');
    expect(programmeFace('JAL Mileage Bank', 'crystal')).toBe('jmb-crystal');
    expect(programmeFace('JAL Mileage Bank', 'sapphire')).toBe('jmb-sapphire');
    expect(programmeFace('JAL Mileage Bank', 'diamond')).toBe('jmb-diamond');
    expect(programmeFace('Privilege Club', 'burgundy')).toBe('privilegeclub');
    expect(programmeFace('Privilege Club', 'silver')).toBe('privilegeclub-silver');
    expect(programmeFace('Privilege Club', 'gold')).toBe('privilegeclub-gold');
    expect(programmeFace('Privilege Club', 'platinum')).toBe('privilegeclub-platinum');
  });

  it('no tier, or one the family has no card for, is the family’s first card', () => {
    expect(programmeFace('KrisFlyer', null)).toBe('krisflyer');
    expect(programmeFace('KrisFlyer', undefined)).toBe('krisflyer');
    expect(programmeFace('KrisFlyer', 'diamond')).toBe('krisflyer');
    expect(programmeFace('KrisFlyer', 'GOLD')).toBe('krisflyer');
    expect(programmeFace('Marriott Bonvoy', 'unobtainium')).toBe('bonvoy');
    expect(programmeFace('ANA Mileage Club', 'gold')).toBe('ana');
    expect(programmeFace('JAL Mileage Bank', 'gold')).toBe('jmb');
  });

  it('hands CardFace a membership face named by the programme’s mark', () => {
    expect(programmeFaceRef('KrisFlyer', 'gold')).toEqual({ key: 'krisflyer-gold', kind: 'membership', mark: 'KrisFlyer' });
    expect(programmeFaceRef('Cathay', null)).toEqual({ key: 'asiamiles', kind: 'membership', mark: 'Asia Miles' });
    expect(programmeFaceRef('BCA Rewards', 'gold')).toBeNull();
  });
});

describe('the families and the drawings agree', () => {
  const keys = PROGRAMME_FAMILIES.flatMap((family) => family.tiers.map((tier) => tier.key)).sort();

  it('every tier of every family is a drawing, and every drawing is a tier', () => {
    expect(keys).toEqual(DRAWN);
    expect(Object.keys(FACES).sort()).toEqual(DRAWN);
    expect(DRAWN).toHaveLength(30);
  });

  it('each family’s first tier is its own key, and its tier words are short lowercase words, each once', () => {
    for (const family of PROGRAMME_FAMILIES) {
      expect(family.tiers[0]!.key).toBe(family.key);
      expect(programmeTier(family, null).key).toBe(family.key);
      for (const tier of family.tiers) expect(tier.id).toMatch(/^[a-z]{2,24}$/);
      expect(new Set(family.tiers.map((tier) => tier.id)).size).toBe(family.tiers.length);
    }
  });

  it('every family is found by each of its own names, and none of them finds another family', () => {
    for (const family of PROGRAMME_FAMILIES) {
      for (const name of family.names) expect(programmeFamily(name)?.key, name).toBe(family.key);
      expect(programmeFamily(family.mark)?.key, family.mark).toBe(family.key);
    }
  });
});

describe('the generated drawings', () => {
  it('carry no print layer, no placeholder print and no hidden leftovers', () => {
    for (const [key, face] of Object.entries(FACES)) {
      const whole = face.defs + face.under + face.brand + face.over;
      expect(whole, key).not.toContain('data-layer="print"');
      expect(whole, key).not.toContain('display="none"');
      expect(whole, key).not.toContain('•••• 1234');
      // The emboss filter only the placeholder name and digits used went with them.
      expect(whole, key).not.toMatch(/-emb"/);
    }
  });

  it('keep the brand layer, and only there', () => {
    for (const [key, face] of Object.entries(FACES)) {
      expect(face.brand, key).toMatch(/^<g data-layer="brand"/);
      expect(face.under + face.over, key).not.toContain('data-layer="brand"');
      expect(face.brand, key).toContain('<text');
    }
  });

  it('define each id once, and define every id they refer to', () => {
    for (const [key, face] of Object.entries(FACES)) {
      const whole = face.defs + face.under + face.brand + face.over;
      const ids = [...whole.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      expect(new Set(ids).size, key).toBe(ids.length);
      const refs = [...whole.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
      for (const ref of refs) expect(ids, `${key} → ${ref}`).toContain(ref);
    }
  });

  it('are SVG fragments that join into one balanced drawing, with or without the brand', () => {
    for (const [key, face] of Object.entries(FACES)) {
      for (const markup of [`<svg>${face.under}${face.brand}${face.over}</svg>`, `<svg>${face.under}${face.over}</svg>`]) {
        const opens = [...markup.matchAll(/<([a-zA-Z]+)\b[^>]*?(\/?)>/g)].filter((m) => m[2] !== '/').length;
        const closes = [...markup.matchAll(/<\/[a-zA-Z]+>/g)].length;
        expect(opens, key).toBe(closes);
      }
    }
  });

  it('say whether their brand prints light or dark', () => {
    expect(FACES['krisflyer']!.ink).toBe('light');
    expect(FACES['privilegeclub']!.ink).toBe('light');
    expect(FACES['privilegeclub-gold']!.ink).toBe('dark');
    expect(FACES['ana']!.ink).toBe('dark');
  });
});
