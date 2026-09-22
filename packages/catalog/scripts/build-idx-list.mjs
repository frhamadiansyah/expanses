// packages/catalog/scripts/build-idx-list.mjs — node build-idx-list.mjs <daftar-saham.xlsx|.csv> <asOf YYYY-MM-DD>
//
// The source is IDX's own "Daftar Saham" export (idx.co.id → Data Pasar → Data Saham → Daftar Saham), as the exchange
// hands it out (.xlsx) or saved as CSV. Only the columns Kode and Nama Perusahaan are read. The file stays outside git;
// the idx.json this writes is committed. Every row comes from the file: nothing here adds, renames or fixes a ticker.
//
// Run from the repo root, e.g.:
//   node packages/catalog/scripts/build-idx-list.mjs .superpowers/sources/daftar-saham-20260922.xlsx 2026-09-22
import { readFileSync, writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const [, , file, asOf] = process.argv;
if (!file || !/^\d{4}-\d{2}-\d{2}$/.test(asOf ?? '')) throw new Error('usage: build-idx-list.mjs <xlsx|csv> <YYYY-MM-DD>');
// SheetJS reads both the exchange's .xlsx and a CSV saved from it (comma or semicolon separated).
const book = XLSX.read(readFileSync(file), { type: 'buffer', raw: false });
const sheet = book.Sheets[book.SheetNames[0]];
const [header = [], ...body] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
const code = header.findIndex((h) => String(h).trim() === 'Kode');
const name = header.findIndex((h) => String(h).trim() === 'Nama Perusahaan');
if (code < 0 || name < 0) throw new Error('The file needs the columns Kode and Nama Perusahaan');
const seen = new Set();
const rows = [];
let skipped = 0;
for (const cells of body) {
  const ticker = String(cells[code] ?? '').trim().toUpperCase();
  const title = String(cells[name] ?? '').trim().replace(/\s+/g, ' ');
  if (!/^[A-Z]{4}$/.test(ticker) || !title || seen.has(ticker)) {
    if (ticker || title) skipped++;
    continue;
  }
  seen.add(ticker);
  rows.push([ticker, title, 'IDX', 's']);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));
writeFileSync(new URL('../securities/idx.json', import.meta.url), `${JSON.stringify({ asOf, rows })}\n`);
console.log(`idx.json: ${rows.length} rows as of ${asOf}${skipped ? ` (${skipped} rows left out: not a 4-letter code, no name, or listed twice)` : ''}`);
