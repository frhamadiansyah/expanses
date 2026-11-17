import { Capacitor } from '@capacitor/core';

/**
 * The Mac app is the iPhone app's own code built for the Mac (Mac Catalyst), so Capacitor says "ios" there too. The
 * native shell marks the page before any of its code runs (`webViewConfiguration`, ios/App/App/AppViewController.swift),
 * and this reads the mark.
 */
export const isMacApp = (): boolean => Capacitor.isNativePlatform() && (globalThis as { __cicisMac?: unknown }).__cicisMac === true;

/**
 * The iPhone app: native and not on a Mac. What only a phone has asks this — the widget, NFC, the capture shortcuts
 * and share sheet, turning the screen sideways — so the Mac app leaves each of them out.
 */
export const isPhoneApp = (): boolean => Capacitor.isNativePlatform() && !isMacApp();
