import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import './ui/styles.css';
import { App } from './ui/app';
import { preloadSprites } from './ui/dom';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app element');

preloadSprites();
new App(root).start();
