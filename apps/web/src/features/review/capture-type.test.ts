import type { CaptureSource } from '@expanses/db';
import { describe, expect, it } from 'vitest';
import { CAPTURE_TYPES, captureTypeOf, messageTypeOf } from './capture-type';

const app = (key: string): Pick<CaptureSource, 'keyKind' | 'key'> => ({ keyKind: 'app', key });

describe('what kind of capture a draft was', () => {
  it('tells a text message by the phone’s Messages app', () => {
    expect(captureTypeOf({ source: 'notification' }, app('com.apple.MobileSMS'))).toBe('sms');
    expect(captureTypeOf({ source: 'notification' }, app('com.apple.mobilesms'))).toBe('sms');
    expect(messageTypeOf('Messages')).toBe('sms');
  });

  it('tells a WhatsApp message by its app, whatever case it was handed over in', () => {
    expect(captureTypeOf({ source: 'notification' }, app('net.whatsapp.WhatsApp'))).toBe('whatsapp');
    expect(messageTypeOf('WHATSAPP')).toBe('whatsapp');
  });

  it('calls every other app’s message a notification', () => {
    expect(captureTypeOf({ source: 'notification' }, app('com.example.pay'))).toBe('notification');
    expect(captureTypeOf({ source: 'notification' }, app('BANKNUSA'))).toBe('notification');
    // A source found by a screen's layout knows no app, and no source at all knows less.
    expect(captureTypeOf({ source: 'notification' }, { keyKind: 'fingerprint', key: '["mobilesms"]' })).toBe('notification');
    expect(captureTypeOf({ source: 'notification' }, null)).toBe('notification');
  });

  it('names a picture by the door it came in by', () => {
    expect(captureTypeOf({ source: 'screen' }, null)).toBe('screenshot');
    expect(captureTypeOf({ source: 'photo' }, null)).toBe('photo');
  });

  it('has nothing to say about a draft that was not captured', () => {
    expect(captureTypeOf({ source: 'csv' }, null)).toBeNull();
    expect(captureTypeOf({ source: 'manual' }, null)).toBeNull();
  });

  it('keeps a word and a glyph for every kind, those still to come included', () => {
    expect(Object.fromEntries(Object.entries(CAPTURE_TYPES).map(([type, { word }]) => [type, word]))).toEqual({
      sms: 'SMS',
      whatsapp: 'WhatsApp',
      notification: 'Notification',
      email: 'Email',
      screenshot: 'Screenshot',
      photo: 'Photo',
      nfc: 'NFC',
    });
    for (const { Icon } of Object.values(CAPTURE_TYPES)) expect(Icon).toBeTruthy();
  });
});
