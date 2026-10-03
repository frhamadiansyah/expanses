import { describe, expect, it } from 'vitest';
import { readCapture, WORDS } from '../src/index';
import { CORPUS, type CorpusCase } from './fixtures/capture-corpus';

describe('the capture corpus', () => {
  it('holds at least thirty notifications and eight images', () => {
    const notifications = CORPUS.filter((sample) => sample.capture.lines.length === 0).length;
    const images = CORPUS.length - notifications;
    expect(notifications).toBeGreaterThanOrEqual(30);
    expect(images).toBeGreaterThanOrEqual(8);
  });

  it.each(CORPUS.map((sample) => [sample.name, sample] as const))('%s', (_name, sample: CorpusCase) => {
    const reading = readCapture(sample.capture, WORDS, null);
    const expected = sample.expected;
    expect({ skipped: reading.skipped }).toEqual({ skipped: expected.skipped });
    expect(reading.amount === null ? null : { minor: reading.amount.value.minor, currency: reading.amount.value.currency }).toEqual(
      expected.amount ?? null,
    );
    if (expected.type !== undefined) expect(reading.type.value).toBe(expected.type);
    if (expected.name !== undefined) expect(reading.name?.value ?? null).toBe(expected.name);
    if (expected.occurredAt !== undefined) expect(reading.occurredAt?.value ?? null).toBe(expected.occurredAt);
    if (expected.accountHint !== undefined) expect(reading.accountHint).toBe(expected.accountHint);
    if (expected.line !== undefined) expect(reading.amount?.line ?? null).toBe(expected.line);
  });
});
