import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { optionLabel } from './FormRow';

describe('optionLabel', () => {
  it('reads an option written in pieces as one line, never as an array with a comma', () => {
    const options = [
      createElement('option', { key: 'a', value: 'a' }, 'Stockbit RDN', ''),
      createElement('option', { key: 'b', value: 'b' }, 'Bibit', ' · held 5'),
    ];
    expect(optionLabel(options, 'a')).toBe('Stockbit RDN');
    expect(optionLabel(options, 'b')).toBe('Bibit · held 5');
  });
});
