import { RenderParams, FeedbackParams, defaultFeedbackParams, defaultParams } from './renderer';

const SMOOTH_RATE = 0.02; // per frame, ~3s to settle

/** Lerp a single number toward target */
function lerp(current: number, target: number, rate: number): number {
  const diff = target - current;
  if (Math.abs(diff) < 0.0001) return target;
  return current + diff * rate;
}

/** Lerp a tuple toward target */
function lerpTuple(current: number[], target: number[], rate: number) {
  for (let i = 0; i < current.length; i++) {
    current[i] = lerp(current[i], target[i], rate);
  }
}

/** Active smooth reset targets, keyed by fb index or 'all' */
type SmoothTarget = {
  fb: Map<number, FeedbackParams>;
  channel1: boolean;
  postfx: boolean;
};

const smoothTargets: SmoothTarget = {
  fb: new Map(),
  channel1: false,
  postfx: false,
};

/** Instant reset a single FB */
export function resetFB(params: RenderParams, index: number) {
  smoothTargets.fb.delete(index);
  const def = defaultFeedbackParams(index);
  Object.assign(params.fb[index], def);
}

/** Instant reset all */
export function resetAll(params: RenderParams) {
  smoothTargets.fb.clear();
  smoothTargets.channel1 = false;
  smoothTargets.postfx = false;
  const def = defaultParams();
  Object.assign(params.channel1, def.channel1);
  for (let i = 0; i < 4; i++) {
    Object.assign(params.fb[i], def.fb[i]);
  }
  Object.assign(params.blur, def.blur);
  Object.assign(params.sharpen, def.sharpen);
}

/** Start smooth reset for a single FB */
export function smoothResetFB(params: RenderParams, index: number) {
  smoothTargets.fb.set(index, defaultFeedbackParams(index));
}

/** Start smooth reset for everything */
export function smoothResetAll(_params: RenderParams) {
  for (let i = 0; i < 4; i++) {
    smoothTargets.fb.set(i, defaultFeedbackParams(i));
  }
  smoothTargets.channel1 = true;
  smoothTargets.postfx = true;
}

/** Stop any smooth reset in progress for an FB (user touched a slider) */
export function cancelSmoothFB(index: number) {
  smoothTargets.fb.delete(index);
}

/** Call once per frame to advance smooth resets. Returns true if any are active. */
export function tickSmooth(params: RenderParams): boolean {
  let active = false;

  for (const [idx, target] of smoothTargets.fb) {
    const fb = params.fb[idx];
    fb.blend = lerp(fb.blend, target.blend, SMOOTH_RATE);
    fb.lumakey = lerp(fb.lumakey, target.lumakey, SMOOTH_RATE);
    fb.lumathresh = lerp(fb.lumathresh, target.lumathresh, SMOOTH_RATE);
    fb.rotate = lerp(fb.rotate, target.rotate, SMOOTH_RATE);
    fb.delay = Math.round(lerp(fb.delay, target.delay, SMOOTH_RATE));
    lerpTuple(fb.hsb, target.hsb, SMOOTH_RATE);
    lerpTuple(fb.huex, target.huex, SMOOTH_RATE);
    lerpTuple(fb.translate, target.translate, SMOOTH_RATE);
    // Snap discrete values when close
    fb.toroid = target.toroid;
    fb.hflip = target.hflip;
    fb.vflip = target.vflip;
    lerpTuple(fb.invert, target.invert, SMOOTH_RATE);

    // Check if settled
    const settled =
      Math.abs(fb.blend - target.blend) < 0.001 &&
      Math.abs(fb.rotate - target.rotate) < 0.001 &&
      Math.abs(fb.translate[0] - target.translate[0]) < 0.001 &&
      Math.abs(fb.translate[1] - target.translate[1]) < 0.001 &&
      Math.abs(fb.translate[2] - target.translate[2]) < 0.001;

    if (settled) {
      Object.assign(fb, target);
      smoothTargets.fb.delete(idx);
    } else {
      active = true;
    }
  }

  if (smoothTargets.channel1) {
    const def = defaultParams().channel1;
    const ch = params.channel1;
    ch.hue = lerp(ch.hue, def.hue, SMOOTH_RATE);
    ch.sat = lerp(ch.sat, def.sat, SMOOTH_RATE);
    ch.bright = lerp(ch.bright, def.bright, SMOOTH_RATE);
    ch.satPowmap = lerp(ch.satPowmap, def.satPowmap, SMOOTH_RATE);
    ch.brightPowmap = lerp(ch.brightPowmap, def.brightPowmap, SMOOTH_RATE);

    if (Math.abs(ch.hue - def.hue) < 0.001 && Math.abs(ch.sat - def.sat) < 0.001) {
      Object.assign(ch, def);
      smoothTargets.channel1 = false;
    } else {
      active = true;
    }
  }

  if (smoothTargets.postfx) {
    const def = defaultParams();
    params.blur.amount = lerp(params.blur.amount, def.blur.amount, SMOOTH_RATE);
    params.blur.radius = lerp(params.blur.radius, def.blur.radius, SMOOTH_RATE);
    params.sharpen.amount = lerp(params.sharpen.amount, def.sharpen.amount, SMOOTH_RATE);
    params.sharpen.boost = lerp(params.sharpen.boost, def.sharpen.boost, SMOOTH_RATE);
    params.sharpen.radius = lerp(params.sharpen.radius, def.sharpen.radius, SMOOTH_RATE);

    if (Math.abs(params.blur.amount - def.blur.amount) < 0.001) {
      Object.assign(params.blur, def.blur);
      Object.assign(params.sharpen, def.sharpen);
      smoothTargets.postfx = false;
    } else {
      active = true;
    }
  }

  return active;
}

export function isSmoothActive(): boolean {
  return smoothTargets.fb.size > 0 || smoothTargets.channel1 || smoothTargets.postfx;
}
