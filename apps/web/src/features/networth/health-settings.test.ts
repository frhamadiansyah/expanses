import { describe, expect, it } from 'vitest';
import { HEALTH_SETTINGS_KEY, readHealthSettings, writeHealthSettings } from './health-settings';

const memory = () => {
  const kept = new Map<string, string>();
  return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), kept };
};

describe('the ratios’ settings, remembered on the device', () => {
  it('reads the defaults where nothing was set: the planning guide, and the base left to the emergency goal', () => {
    expect(readHealthSettings(memory())).toEqual({ debtServiceBenchmarkBps: 3000 });
  });

  it('reads back what was written', () => {
    const storage = memory();
    writeHealthSettings({ emergencyBase: 'all', debtServiceBenchmarkBps: 3500 }, storage);
    expect(readHealthSettings(storage)).toEqual({ emergencyBase: 'all', debtServiceBenchmarkBps: 3500 });
  });

  it('ignores a base or a guide it does not know, rather than reading the ratios with it', () => {
    const storage = memory();
    storage.setItem(HEALTH_SETTINGS_KEY, JSON.stringify({ emergencyBase: 'some', debtServiceBenchmarkBps: -1 }));
    expect(readHealthSettings(storage)).toEqual({ debtServiceBenchmarkBps: 3000 });
    storage.setItem(HEALTH_SETTINGS_KEY, 'not json');
    expect(readHealthSettings(storage)).toEqual({ debtServiceBenchmarkBps: 3000 });
  });

  it('reads as the defaults, and does not throw, where storage refuses', () => {
    const refusing = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readHealthSettings(refusing)).toEqual({ debtServiceBenchmarkBps: 3000 });
    expect(() => writeHealthSettings({ emergencyBase: 'all', debtServiceBenchmarkBps: 3000 }, refusing)).not.toThrow();
  });
});
