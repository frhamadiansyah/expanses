import type { CaptureLine } from '@expanses/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { native } from './native';

describe('the capture bridge outside the iPhone app', () => {
  it('has nothing to drain and no holding area to report', async () => {
    expect(await native.drainCaptures()).toEqual({ captures: [] });
    expect(await native.holdingAreaStatus()).toEqual({ pending: 0, broken: 0 });
  });

  it('deletes a picture that was never there without complaining', async () => {
    await expect(native.deleteCaptureImage({ file: 'captures/missing.png' })).resolves.toBeUndefined();
  });

  it('refuses the camera and the picture reader, which only exist on the phone', async () => {
    await expect(native.scanReceipt()).rejects.toThrow('Not available here');
    await expect(native.readCaptureImage({ file: 'captures/missing.png' })).rejects.toThrow('Not available here');
  });
});

describe('reading a handed-over picture outside the iPhone app', () => {
  const l1: CaptureLine = { text: 'one', box: [0, 0, 1, 0.1], height: 0.1 };
  const l2: CaptureLine = { text: 'two', box: [0, 0.2, 1, 0.1], height: 0.1 };

  // Vitest runs in node: stand in for the e2e page's window.
  const page = (lines: CaptureLine[][]) => vi.stubGlobal('window', { __statementLines: lines });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('refuses outside an e2e build', async () => {
    page([[l1]]);
    await expect(native.recognizeImage({ base64: 'x' })).rejects.toThrow('Not available here');
  });

  it('hands the e2e readings back in order, then runs dry', async () => {
    vi.stubEnv('VITE_E2E', '1');
    page([[l1], [l2]]);
    expect(await native.recognizeImage({ base64: 'x' })).toEqual({ lines: [l1] });
    expect(await native.recognizeImage({ base64: 'x' })).toEqual({ lines: [l2] });
    await expect(native.recognizeImage({ base64: 'x' })).rejects.toThrow('Not available here');
  });
});
