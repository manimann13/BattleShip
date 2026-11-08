// Renders the menu artwork and title alone, for the 1200x630 link preview screenshot.
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/700.css';
import '../../src/ui/styles.css';
import { h, icon } from '../../src/ui/dom';
import { createMenuScene } from '../../src/ui/menuScene';

const scene = createMenuScene({ onImpact: () => {} });
document.querySelector('#app')?.append(
  h(
    'div',
    'menu menu-majestic',
    scene.element,
    h(
      'header',
      'title-block',
      h('h1', 'title', icon('icon-anchor', 'title-icon'), h('span', 'title-text', 'Battle Ship')),
      h('p', 'title-sub', 'Command the Seas'),
    ),
    h('p', 'og-tag', 'Play free in your browser: vs Computer, 2 Players or Online'),
  ),
);
scene.start();
