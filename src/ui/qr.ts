import qrcode from 'qrcode-generator';
import { h } from './dom';

// The QR code on the host's waiting screen: a friend points their phone camera at it to open the
// invite link. Drawn one canvas pixel per square and scaled up crisply, like the rest of the pixel art.

// Blank squares a scanner needs around the code.
const QUIET_ZONE = 4;

// The dark and light squares of a QR code for `text`, row by row, without the quiet zone.
// Error correction level M lets it still scan if a little of it is hidden or blurred.
export function qrModules(text: string): boolean[][] {
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => code.isDark(row, col)));
}

export function qrCode(text: string, label: string): HTMLElement {
  const modules = qrModules(text);
  const size = modules.length + QUIET_ZONE * 2;
  const canvas = h('canvas', 'qr-canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Dark ink on pale parchment: plenty of contrast for cameras, and it matches the sea charts.
    ctx.fillStyle = '#f4ecd6';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#142034';
    modules.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) ctx.fillRect(x + QUIET_ZONE, y + QUIET_ZONE, 1, 1);
      }),
    );
  }
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', label);
  return h('figure', 'invite-qr', canvas, h('figcaption', '', 'Scan with a phone camera to join'));
}
