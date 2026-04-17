import { RenderParams } from './renderer';

/** Keyboard state - tracks which keys are held */
const held = new Set<string>();

/** Keyboard control bindings matching original VIDEO_WAAAVES mappings.
 *  Keys increment/decrement FB0/FB1 transform params while held. */
export function initKeyboard(params: RenderParams, onClear: () => void) {
  window.addEventListener('keydown', (e) => {
    // Don't capture when typing in an input
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;
    held.add(e.key.toLowerCase());

    // Instant actions
    switch (e.key) {
      case '1': onClear(); break;
      case '3': // Reset FB0 transforms
        params.fb[0].rotate = 0;
        params.fb[0].translate = [0, 0, 1];
        params.fb[1].rotate = 0;
        params.fb[1].translate = [0, 0, 1];
        break;
    }
  });

  window.addEventListener('keyup', (e) => {
    held.delete(e.key.toLowerCase());
  });

  // Blur clears held keys (prevents stuck keys when window loses focus)
  window.addEventListener('blur', () => held.clear());
}

/** Returns true if any keys are currently held */
export function isKeyboardActive(): boolean {
  return held.size > 0;
}

/** Call every frame to apply held-key increments */
export function tickKeyboard(params: RenderParams) {
  const fb0 = params.fb[0];
  const fb1 = params.fb[1];

  // FB0 rotation (a/z, s/x, d/c) - original uses 0.0001 but that's for 30fps,
  // we run at 60fps so halve it. Actually these accumulate so keep small.
  const rotStep = 0.0002;
  if (held.has('a')) fb0.rotate += rotStep;
  if (held.has('z')) fb0.rotate -= rotStep;

  // FB0 X/Y displacement (f/v, g/b)
  const dispStep = 0.0002;
  if (held.has('f')) fb0.translate[0] += dispStep;
  if (held.has('v')) fb0.translate[0] -= dispStep;
  if (held.has('g')) fb0.translate[1] += dispStep;
  if (held.has('b')) fb0.translate[1] -= dispStep;

  // FB0 zoom (h/n)
  const zoomStep = 0.001;
  if (held.has('h')) fb0.translate[2] += zoomStep;
  if (held.has('n')) fb0.translate[2] -= zoomStep;

  // FB1 rotation (s mapped to both - use shift variants or separate keys)
  // Map: j/m = FB1 rotate, k/, = FB1 X, l/. = FB1 Y
  if (held.has('j')) fb1.rotate += rotStep;
  if (held.has('m')) fb1.rotate -= rotStep;
  if (held.has('k')) fb1.translate[0] += dispStep;
  if (held.has(',')) fb1.translate[0] -= dispStep;
  if (held.has('l')) fb1.translate[1] += dispStep;
  if (held.has('.')) fb1.translate[1] -= dispStep;

  // Blur/sharpen (q/w = blur, e/r = sharpen)
  if (held.has('q')) params.blur.amount = Math.min(1, params.blur.amount + 0.005);
  if (held.has('w')) params.blur.amount = Math.max(0, params.blur.amount - 0.005);
  if (held.has('e')) params.sharpen.amount = Math.min(2, params.sharpen.amount + 0.005);
  if (held.has('r')) params.sharpen.amount = Math.max(0, params.sharpen.amount - 0.005);

  // Channel HSB (u/i = hue, o/p = sat, t/y = bright)
  if (held.has('t')) params.channel1.hue += 0.01;
  if (held.has('y')) params.channel1.hue -= 0.01;
  if (held.has('u')) params.channel1.sat += 0.01;
  if (held.has('i')) params.channel1.sat -= 0.01;
  if (held.has('o')) params.channel1.bright += 0.01;
  if (held.has('p')) params.channel1.bright -= 0.01;

  // FB0 blend ([ / ])
  if (held.has('[')) fb0.blend = Math.min(1, fb0.blend + 0.005);
  if (held.has(']')) fb0.blend = Math.max(0, fb0.blend - 0.005);
}
