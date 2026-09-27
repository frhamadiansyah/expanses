/*
 * Portable base64url, built on `TextEncoder`/`TextDecoder` and `btoa`/`atob` rather than Node's `Buffer` — the app
 * runs in the browser and in a native WebView (Capacitor) as well as in Node's test runner, and `Buffer` exists in
 * none of the first two. `btoa`/`atob` work on a "binary string" (one code unit per byte), so UTF-8 bytes are
 * expanded to that form first and collapsed back afterwards. Shared here so task 5's real AES-GCM/ECDSA sealer and
 * `KeyStore` reuse the exact same encoding `IdentitySealer` already uses.
 */

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
