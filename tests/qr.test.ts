import { describe, expect, it } from 'vitest';
import { qrModules } from '../src/ui/qr';

describe('invite QR code', () => {
  const link = 'https://battleship-7pbl.onrender.com/?join=ABCD';

  it('is a square grid of a valid QR size', () => {
    const modules = qrModules(link);
    const size = modules.length;
    expect(modules.every((row) => row.length === size)).toBe(true);
    // QR sizes are 21, 25, 29... squares; this short link fits in a small one.
    expect((size - 21) % 4).toBe(0);
    expect(size).toBeLessThanOrEqual(37);
  });

  it('has the three corner finder squares a camera looks for', () => {
    const modules = qrModules(link);
    const last = modules.length - 1;
    for (const [row, col] of [[0, 0], [0, last - 6], [last - 6, 0]]) {
      // A finder is a dark 7x7 ring with a light ring inside and a dark 3x3 centre.
      expect(modules[row][col]).toBe(true);
      expect(modules[row + 6][col + 6]).toBe(true);
      expect(modules[row + 1][col + 1]).toBe(false);
      expect(modules[row + 3][col + 3]).toBe(true);
    }
  });

  it('changes with the game code', () => {
    expect(qrModules(link)).not.toEqual(qrModules(link.replace('ABCD', 'WXYZ')));
  });
});
