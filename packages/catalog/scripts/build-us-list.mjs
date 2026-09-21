// packages/catalog/scripts/build-us-list.mjs — node build-us-list.mjs <nasdaqlisted.txt> <otherlisted.txt> <asOf>
import { readFileSync, writeFileSync } from 'node:fs';

const [, , nasdaqFile, otherFile, asOf] = process.argv;
if (!nasdaqFile || !otherFile || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('usage: build-us-list.mjs <nasdaqlisted> <otherlisted> <YYYY-MM-DD>');
const EXCHANGES = { N: 'NYSE', A: 'NYSE AMERICAN', P: 'NYSE ARCA', Z: 'CBOE BZX', V: 'IEX' };
const LEFT_OUT = /\b(warrants?|rights?|units?|subordinated|notes? due|depositary shares? representing .*preferred)\b/i;
const TICKER = /^[A-Z]{1,5}(\.[A-Z]{1,2})?$/;
// Not ordinary holdings, by the exchanges' own flags (the owner's ruling): a test issue ("Test Issue" Y), and a warrant,
// a right or a unit — on Nasdaq a fifth letter W, R or U; in CQS a .WS / .W / .RT / .R / .U suffix. The name filter
// above catches most of them; these catch the rest whatever their names say. Real stocks and ETFs are never cut.
const NASDAQ_NOT_ORDINARY = /^[A-Z]{4}[WRU]$/;
const CQS_NOT_ORDINARY = /\.(WS|W|RT|R|U)$/;

function table(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/).filter((line) => line && !line.startsWith('File Creation Time'));
  const [head, ...body] = lines;
  const keys = head.split('|');
  return body.map((line) => Object.fromEntries(line.split('|').map((value, i) => [keys[i], value])));
}
const clean = (title) => title.split(' - ')[0].replace(/\s+(Common Stock|Ordinary Shares|Common Shares)$/i, '').trim();

const rows = [];
const seen = new Set();
const add = (ticker, title, market, etf) => {
  const key = `${market}:${ticker}`;
  if (!TICKER.test(ticker) || !title || LEFT_OUT.test(title) || seen.has(key)) return;
  seen.add(key);
  rows.push([ticker, clean(title), market, etf === 'Y' ? 'e' : 's']);
};
for (const r of table(nasdaqFile)) if (r['Test Issue'] === 'N' && !NASDAQ_NOT_ORDINARY.test(r.Symbol)) add(r.Symbol, r['Security Name'], 'NASDAQ', r.ETF);
for (const r of table(otherFile)) if (r['Test Issue'] === 'N' && EXCHANGES[r.Exchange] && !CQS_NOT_ORDINARY.test(r['CQS Symbol'])) add(r['ACT Symbol'], r['Security Name'], EXCHANGES[r.Exchange], r.ETF);
rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
writeFileSync(new URL('../securities/us.json', import.meta.url), `${JSON.stringify({ asOf, rows })}\n`);
console.log(`us.json: ${rows.length} rows as of ${asOf}`);
