import { describe, expect, it } from 'vitest';
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
