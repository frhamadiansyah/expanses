// apps/web/scripts/debit-art.mjs — cuts the approved Wallet card drawings (docs/card-art/cards.json, one whole SVG per
// key as draw_cards.py made them) down to their art alone, and writes them as src/features/cards/debit-art/faces.generated.ts.
//
// The Python drew whole cards: background and pattern, then the bank's name, the chip, the contactless mark, the digits
// and the holder. The app draws that print itself (`CardFace`), in its own layout, so only the art under it is kept:
// the gradients it needs and the shapes inside the card's clip. What is read off each drawing besides the art is the
// ink it was printed in (light or dark), the bank's own colour where the name was not printed in that ink, and the
// chip's metal.
//
//   node scripts/debit-art.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../../../docs/card-art/cards.json', import.meta.url);
const target = new URL('../src/features/cards/debit-art/faces.generated.ts', import.meta.url);

/** The drawing's key → the app's face key. A tier of a bank is the bank's key and the tier's name. */
const KEYS = {
  mandiri: 'mandiri',
  gold: 'mandiri-gold',
  plat: 'mandiri-platinum',
  mandiriprio: 'mandiri-prioritas',
  bca: 'bca',
  bcagold: 'bca-gold',
  bcaplat: 'bca-platinum',
  bcaprio: 'bca-prioritas',
  bsi: 'bsi',
  bsigold: 'bsi-gold',
  bsiplat: 'bsi-platinum',
  cimb: 'cimb',
  cimbpref: 'cimb-preferred',
};
/** A catalogue credit card, redrawn in the same folder: not a debit face. */
const SKIPPED = new Set(['hsbc']);

/** Attributes a `<g>` passes down to its children unchanged, so a run of shapes sharing them can carry them once. */
const INHERITED = new Set(['fill', 'fill-opacity', 'stroke', 'stroke-opacity', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray']);

/** Shorter numbers that draw the same: no leading nought before a point, no noughts after it. */
function trimNumbers(text) {
  return text
    .replace(/(^|[^\d])0\.(\d)/g, '$1.$2')
    .replace(/(\.\d*?[1-9])0+(?=[^\d]|$)/g, '$1')
    .replace(/\.0+(?=[^\d.]|$)/g, '');
}

/** The top-level elements of a fragment, each as its whole text, nested ones kept whole. */
function elements(fragment) {
  const out = [];
  let at = 0;
  while (at < fragment.length) {
    const open = fragment.indexOf('<', at);
    if (open < 0) break;
    const tag = /^<([a-zA-Z]+)/.exec(fragment.slice(open))?.[1];
    const end = fragment.indexOf('>', open);
    if (fragment[end - 1] === '/') {
      out.push(fragment.slice(open, end + 1));
      at = end + 1;
      continue;
    }
    // An element with children: its close is the one that balances its own opens.
    let depth = 1;
    let cursor = end + 1;
    while (depth > 0) {
      const nextOpen = fragment.indexOf(`<${tag}`, cursor);
      const nextClose = fragment.indexOf(`</${tag}>`, cursor);
      if (nextOpen >= 0 && nextOpen < nextClose && /[\s>/]/.test(fragment[nextOpen + tag.length + 1])) {
        depth += 1;
        cursor = nextOpen + 1;
      } else {
        depth -= 1;
        cursor = nextClose + tag.length + 3;
      }
    }
    out.push(fragment.slice(open, cursor));
    at = cursor;
  }
  return out;
}

const attributesOf = (element) => new Map([...element.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const tagOf = (element) => /^<([a-zA-Z]+)/.exec(element)[1];

/**
 * Three or more shapes of one kind in a row, sharing a colour or a stroke, carry it once on a `<g>` around them: the
 * generated patterns (a band of dots, a field of facets, spun rings) are hundreds of elements repeating the same paint.
 */
function hoistShared(fragment) {
  const items = elements(fragment);
  const out = [];
  let i = 0;
  while (i < items.length) {
    const tag = tagOf(items[i]);
    let j = i;
    while (j < items.length && tagOf(items[j]) === tag && items[j].endsWith('/>')) j += 1;
    if (j - i < 3) {
      out.push(items[i]);
      i += 1;
      continue;
    }
    const run = items.slice(i, j);
    const first = attributesOf(run[0]);
    const shared = [...first].filter(([name, value]) => INHERITED.has(name) && run.every((el) => attributesOf(el).get(name) === value));
    if (shared.length === 0) {
      out.push(...run);
    } else {
      const strip = (el) => shared.reduce((text, [name, value]) => text.replace(` ${name}="${value}"`, ''), el);
      out.push(`<g ${shared.map(([name, value]) => `${name}="${value}"`).join(' ')}>${run.map(strip).join('')}</g>`);
    }
    i = j;
  }
  return out.join('');
}

/** Whether a hex colour prints light on its ground (white, silver) or dark (navy, brown). */
function inkOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? 'light' : 'dark';
}

const drawings = JSON.parse(readFileSync(source, 'utf8'));
const faces = {};
for (const [drawn, svg] of Object.entries(drawings)) {
  if (SKIPPED.has(drawn)) continue;
  const key = KEYS[drawn] ?? drawn;
  const head = /<defs>(.*?)<clipPath id="cl(\w+)">/s.exec(svg);
  if (!head) throw new Error(`${drawn}: no defs`);
  const [, defs, clip] = head;
  const body = new RegExp(`<g clip-path="url\\(#cl${clip}\\)">(.*)<rect width="340" height="214" fill="url\\(#sh${clip}\\)"/></g>`, 's').exec(svg);
  if (!body) throw new Error(`${drawn}: no art`);
  const ink = /font-size="15" letter-spacing="2\.6" fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
  const bank = /font-size="18" font-weight="700" letter-spacing="\.3" fill="(#[0-9a-f]{6})"/.exec(svg)?.[1];
  if (!ink || !bank) throw new Error(`${drawn}: no print colours`);
  const tidy = (text) => trimNumbers(text.replace(/\s*\n\s*/g, '').replace(/>\s+</g, '><'));
  const face = { defs: tidy(defs), art: hoistShared(tidy(body[1])), ink: inkOf(ink) };
  if (bank !== ink) face.bank = bank;
  if (svg.includes('url(#ch')) face.chip = svg.includes('#f6e3a1') ? 'gold' : 'silver';
  faces[key] = face;
}

// The markup is written between backticks, not JSON-escaped: it is all double quotes, and none of it is a backtick.
const field = ([name, value]) => `${name}: ${typeof value === 'string' && value.includes('"') ? `\`${value}\`` : JSON.stringify(value)}`;
const lines = Object.entries(faces).map(([key, face]) => `  '${key}': { ${Object.entries(face).map(field).join(', ')} },`);
writeFileSync(
  target,
  `// Generated by scripts/debit-art.mjs from docs/card-art/cards.json — do not edit by hand.
import type { FaceArt } from './face-art';

export const FACES: Record<string, FaceArt> = {
${lines.join('\n')}
};
`,
);
const total = Object.values(faces).reduce((sum, face) => sum + face.defs.length + face.art.length, 0);
console.log(`${Object.keys(faces).length} faces, ${Math.round(total / 1024)} KB of art`);
