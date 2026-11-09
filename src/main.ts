import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './ui/styles.css';
import { App } from './ui/app';
import { preloadSprites } from './ui/dom';
import { lockZoom } from './ui/zoomLock';
import { wakeServer } from './net/connection';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app element');

// Never keep players on the loading screen longer than this, even if a sprite or font is slow.
const LOADER_TIMEOUT_MS = 6000;

const loader = document.querySelector<HTMLElement>('#loader');
const fill = loader?.querySelector<HTMLElement>('.loader-fill');
const sprites = preloadSprites((done) => {
  if (fill) fill.style.width = `${Math.max(4, Math.round(done * 100))}%`;
});
const fonts = document.fonts
  ? Promise.all([document.fonts.load('400 16px "Pixelify Sans"'), document.fonts.load('700 16px "Pixelify Sans"')])
  : Promise.resolve();

lockZoom();
// Online play needs the game server; start waking it now in case it's asleep.
wakeServer();
new App(root).start();

Promise.race([
  Promise.all([sprites, fonts.catch(() => undefined)]),
  new Promise((resolve) => setTimeout(resolve, LOADER_TIMEOUT_MS)),
]).then(() => {
  if (!loader) return;
  loader.classList.add('done');
  loader.addEventListener('transitionend', () => loader.remove(), { once: true });
  // Reduced motion has no transition, so remove it directly.
  setTimeout(() => loader.remove(), 600);
});

// The service worker lets the installed app open and play vs Computer offline. Production only:
// in development it would serve stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((error) => console.warn('Offline mode unavailable:', error));
  });
}
