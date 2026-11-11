import { describe, expect, it } from 'vitest';
import { stringLiterals } from './string-literals';

describe('the string literals of a source', () => {
  it('reads quoted and template strings, the strings inside a template’s expressions, and no comment', () => {
    const source = [
      "// a comment with 'quoted' words",
      '/* and a block one, "too" */',
      "const a = 'it\\'s here';",
      'const b = "double";',
      "const c = `${n} ${n === 1 ? 'row' : 'rows'} placed`;",
    ].join('\n');
    expect(stringLiterals(source)).toEqual(["it's here", 'double', 'row', 'rows', '    placed']);
  });
});
