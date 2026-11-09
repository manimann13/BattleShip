// The game window stays at 1x: no pinch, double-tap or keyboard zoom. The viewport meta tag and
// `touch-action: manipulation` cover most browsers; iOS Safari ignores `user-scalable=no`, and
// desktop browsers zoom on Ctrl/Cmd with + - 0 or a trackpad pinch, so those are stopped here.
export function lockZoom(): void {
  const stop = (event: Event) => event.preventDefault();

  // iOS Safari pinch gestures.
  for (const name of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(name, stop, { passive: false });
  }
  // Two-finger touches on any phone browser.
  document.addEventListener(
    'touchmove',
    (event) => {
      if (event.touches.length > 1) event.preventDefault();
    },
    { passive: false },
  );
  // Trackpad pinch and Ctrl + scroll wheel on laptops.
  window.addEventListener(
    'wheel',
    (event) => {
      if (event.ctrlKey) event.preventDefault();
    },
    { passive: false },
  );
  // Ctrl/Cmd with + - = or 0.
  window.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && ['+', '-', '=', '_', '0'].includes(event.key)) event.preventDefault();
  });
}
