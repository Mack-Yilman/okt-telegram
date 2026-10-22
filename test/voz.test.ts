import { describe, expect, it } from 'vitest';
import { base64 } from '../src/voz';

describe('base64', () => {
  it('coincide con btoa para bytes arbitrarios, incluidos audios de varios MB', () => {
    for (const n of [0, 1, 2, 3, 1000, 3 * 1024 * 1024 + 7]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256);
      let binario = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      expect(base64(bytes.buffer)).toBe(btoa(binario));
    }
  });
});
