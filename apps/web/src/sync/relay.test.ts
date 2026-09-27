import { describe, expect, it } from 'vitest';
import { RELAY_URL } from './relay';

describe('RELAY_URL', () => {
  it('is the local relay unless VITE_RELAY_URL says otherwise', () => {
    expect(RELAY_URL).toBe(import.meta.env.VITE_RELAY_URL || 'http://localhost:8787');
  });
});
