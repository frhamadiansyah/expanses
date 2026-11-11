/**
 * The string literals of a TypeScript source, comments left out: what a copy test reads to hold every sentence a
 * module can show to a rule (no "you", no sample numbers). Quoted strings as written; a template literal's text with
 * each `${…}` read as one space. A plain scanner, not a parser: enough for the copy modules, which hold no regular
 * expression literals with quotes in them.
 */
export function stringLiterals(source: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < n && source[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
    } else if (c === "'" || c === '"') {
      let text = '';
      i += 1;
      while (i < n && source[i] !== c) {
        if (source[i] === '\\') i += 1;
        text += source[i] ?? '';
        i += 1;
      }
      i += 1;
      out.push(text);
    } else if (c === '`') {
      let text = '';
      i += 1;
      while (i < n && source[i] !== '`') {
        if (source[i] === '\\') {
          text += source[i + 1] ?? '';
          i += 2;
        } else if (source[i] === '$' && source[i + 1] === '{') {
          // The expression, by its braces; the strings inside it (`${n === 1 ? 'row' : 'rows'}`) are read too.
          let depth = 1;
          const start = i + 2;
          i = start;
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') depth -= 1;
            i += 1;
          }
          out.push(...stringLiterals(source.slice(start, i - 1)));
          text += ' ';
        } else {
          text += source[i];
          i += 1;
        }
      }
      i += 1;
      out.push(text);
    } else {
      i += 1;
    }
  }
  return out;
}
