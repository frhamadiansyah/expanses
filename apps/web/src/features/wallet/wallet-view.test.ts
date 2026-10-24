import { describe, expect, it } from 'vitest';
import { WALLET_VIEW_KEY, readWalletView, writeWalletView } from './wallet-view';

const memory = () => {
  const kept = new Map<string, string>();
  return {
    getItem: (key: string) => kept.get(key) ?? null,
    setItem: (key: string, value: string) => void kept.set(key, value),
    removeItem: (key: string) => void kept.delete(key),
    kept,
  };
};

describe('the Wallet view, remembered on the device', () => {
  it('reads as the stack where nothing was chosen', () => {
    expect(readWalletView(memory())).toBe('stack');
  });

  it('reads back the grid or the carousel once chosen, and forgets the stack rather than storing it', () => {
    const storage = memory();
    writeWalletView('grid', storage);
    expect(readWalletView(storage)).toBe('grid');
    writeWalletView('carousel', storage);
    expect(readWalletView(storage)).toBe('carousel');
    writeWalletView('stack', storage);
    expect(storage.kept.has(WALLET_VIEW_KEY)).toBe(false);
    expect(readWalletView(storage)).toBe('stack');
  });

  it('ignores a view it does not know, rather than laying the cards out as nothing', () => {
    const storage = memory();
    storage.setItem(WALLET_VIEW_KEY, 'wall');
    expect(readWalletView(storage)).toBe('stack');
    storage.setItem(WALLET_VIEW_KEY, '');
    expect(readWalletView(storage)).toBe('stack');
  });

  it('reads as the stack, and does not throw, where storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(readWalletView(refusing)).toBe('stack');
    expect(() => writeWalletView('grid', refusing)).not.toThrow();
    expect(() => writeWalletView('stack', refusing)).not.toThrow();
  });

  it('reads as the stack where there is no storage at all', () => {
    expect(readWalletView(undefined)).toBe('stack');
    expect(() => writeWalletView('grid', undefined)).not.toThrow();
  });
});
