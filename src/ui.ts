import { RenderParams, FeedbackParams, defaultFeedbackParams, defaultParams, PipelineStage, DEFAULT_PIPELINE, DEFAULT_CUSTOM_SHADER, CRT_SHADER, Renderer } from './renderer';
import { resetFB, resetAll, smoothResetFB, smoothResetAll, cancelSmoothFB } from './reset';
import { PhosphormParams, defaultPhosphormParams } from './phosphorm';
import { SpectralMeshParams, defaultSpectralParams } from './spectral-mesh';
import { PresetManager } from './preset-manager';
import { AudioReactor, AudioReactorParams, defaultAudioReactorParams } from './audio-reactor';

function popOutControls(container: HTMLElement) {
  const win = window.open('', 'controls', 'width=340,height=800,menubar=no,toolbar=no,location=no');
  if (!win) return;

  win.document.title = 'skatlogs - controls';

  // Copy styles from parent
  const parentStyles = document.querySelectorAll('style');
  for (const s of parentStyles) {
    const style = win.document.createElement('style');
    style.textContent = s.textContent;
    win.document.head.appendChild(style);
  }
  // Add base styles for the pop-out body
  const baseStyle = win.document.createElement('style');
  baseStyle.textContent = 'body{background:#111;color:#0f0;font-family:monospace;font-size:11px;margin:0;padding:10px;overflow-y:auto;}';
  win.document.head.appendChild(baseStyle);

  // Move all children to the new window
  while (container.firstChild) {
    win.document.body.appendChild(container.firstChild);
  }

  // Hide the container in the main window
  container.style.display = 'none';
  // Expand canvas to full width
  (container.parentElement?.querySelector('#canvas-container') as HTMLElement | null)?.style.setProperty('flex', '1');

  win.addEventListener('beforeunload', () => {
    // Move children back
    while (win.document.body.firstChild) {
      container.appendChild(win.document.body.firstChild);
    }
    container.style.display = '';
  });
}

type SliderDef = {
  label: string;
  key: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  get: (p: RenderParams) => number;
  set: (p: RenderParams, v: number) => void;
};

/** Registry for live sync during smooth resets */
const sliderRegistry: { def: SliderDef; input: HTMLInputElement; valSpan: HTMLSpanElement }[] = [];

/** Active per-slider smooth resets: key → target value */
const sliderSmoothTargets = new Map<string, { def: SliderDef; target: number }>();
const SLIDER_SMOOTH_RATE = 0.03;

/** Slider input smoothing: lerp actual param values toward slider targets */
const sliderInputTargets = new Map<string, { def: SliderDef; target: number }>();
const SLIDER_INPUT_SMOOTH = 0.15; // 0=instant, higher=smoother

function fbSliders(index: number): SliderDef[] {
  const prefix = `FB${index}`;
  const get = (p: RenderParams) => p.fb[index];
  const def = defaultFeedbackParams(index);
  return [
    { label: 'Blend', key: `${prefix}_blend`, min: 0, max: 1, step: 0.01, defaultVal: def.blend,
      get: p => get(p).blend, set: (p, v) => { get(p).blend = v; } },
    { label: 'LumaKey', key: `${prefix}_lumakey`, min: 0, max: 1, step: 0.01, defaultVal: def.lumakey,
      get: p => get(p).lumakey, set: (p, v) => { get(p).lumakey = v; } },
    { label: 'LumaThresh', key: `${prefix}_lumathresh`, min: 0, max: 1, step: 0.01, defaultVal: def.lumathresh,
      get: p => get(p).lumathresh, set: (p, v) => { get(p).lumathresh = v; } },
    { label: 'Delay', key: `${prefix}_delay`, min: 1, max: 29, step: 1, defaultVal: def.delay,
      get: p => get(p).delay, set: (p, v) => { get(p).delay = v; } },
    { label: 'Zoom', key: `${prefix}_zoom`, min: 0.1, max: 3.0, step: 0.01, defaultVal: def.translate[2],
      get: p => get(p).translate[2], set: (p, v) => { get(p).translate[2] = v; } },
    { label: 'X Displace', key: `${prefix}_tx`, min: -1, max: 1, step: 0.005, defaultVal: def.translate[0],
      get: p => get(p).translate[0], set: (p, v) => { get(p).translate[0] = v; } },
    { label: 'Y Displace', key: `${prefix}_ty`, min: -1, max: 1, step: 0.005, defaultVal: def.translate[1],
      get: p => get(p).translate[1], set: (p, v) => { get(p).translate[1] = v; } },
    { label: 'Rotate', key: `${prefix}_rot`, min: -3.14, max: 3.14, step: 0.005, defaultVal: def.rotate,
      get: p => get(p).rotate, set: (p, v) => { get(p).rotate = v; } },
    { label: 'Hue Mult', key: `${prefix}_hue`, min: 0, max: 3, step: 0.01, defaultVal: def.hsb[0],
      get: p => get(p).hsb[0], set: (p, v) => { get(p).hsb[0] = v; } },
    { label: 'Sat Mult', key: `${prefix}_sat`, min: 0, max: 3, step: 0.01, defaultVal: def.hsb[1],
      get: p => get(p).hsb[1], set: (p, v) => { get(p).hsb[1] = v; } },
    { label: 'Bright Mult', key: `${prefix}_brt`, min: 0, max: 3, step: 0.01, defaultVal: def.hsb[2],
      get: p => get(p).hsb[2], set: (p, v) => { get(p).hsb[2] = v; } },
    { label: 'Hue Mod', key: `${prefix}_hmod`, min: 0, max: 2, step: 0.01, defaultVal: def.huex[0],
      get: p => get(p).huex[0], set: (p, v) => { get(p).huex[0] = v; } },
    { label: 'Hue Offset', key: `${prefix}_hoff`, min: 0, max: 1, step: 0.01, defaultVal: def.huex[1],
      get: p => get(p).huex[1], set: (p, v) => { get(p).huex[1] = v; } },
    { label: 'Hue LFO', key: `${prefix}_hlfo`, min: 0, max: 1, step: 0.01, defaultVal: def.huex[2],
      get: p => get(p).huex[2], set: (p, v) => { get(p).huex[2] = v; } },
  ];
}

function makeSlider(container: HTMLElement, def: SliderDef, params: RenderParams, onUserInput?: () => void): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'ctrl-row';

  const label = document.createElement('label');
  label.textContent = def.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(def.get(params));

  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = Number(input.value).toFixed(2);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = v.toFixed(2);
    // Cancel any smooth reset for this slider
    sliderSmoothTargets.delete(def.key);
    // Use input smoothing for gradual change
    sliderInputTargets.set(def.key, { def, target: v });
    if (onUserInput) onUserInput();
  });

  // Double-click label: smooth reset this single slider to default
  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    sliderSmoothTargets.set(def.key, { def, target: def.defaultVal });
  });

  // Right-click label: instant reset this slider
  label.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    def.set(params, def.defaultVal);
    input.value = String(def.defaultVal);
    val.textContent = def.defaultVal.toFixed(2);
    sliderSmoothTargets.delete(def.key);
  });

  label.style.cursor = 'pointer';
  label.title = 'Double-click: smooth reset | Right-click: instant reset';

  row.append(label, input, val);
  container.appendChild(row);

  sliderRegistry.push({ def, input, valSpan: val });
  return input;
}

function makeToggleRow(container: HTMLElement, fb: FeedbackParams) {
  const row = document.createElement('div');
  row.className = 'ctrl-row';
  const lbl = document.createElement('label');
  lbl.textContent = 'Modes';
  row.appendChild(lbl);

  const toroidBtn = document.createElement('button');
  const toroidLabels = ['Off', 'Wrap', 'Mirror'];
  toroidBtn.textContent = `Wrap: ${toroidLabels[fb.toroid]}`;
  toroidBtn.addEventListener('click', () => {
    fb.toroid = (fb.toroid + 1) % 3;
    toroidBtn.textContent = `Wrap: ${toroidLabels[fb.toroid]}`;
  });
  row.appendChild(toroidBtn);

  const hBtn = document.createElement('button');
  hBtn.textContent = 'HFlip';
  hBtn.className = fb.hflip ? 'active' : '';
  hBtn.addEventListener('click', () => {
    fb.hflip = fb.hflip ? 0 : 1;
    hBtn.className = fb.hflip ? 'active' : '';
  });
  row.appendChild(hBtn);

  const vBtn = document.createElement('button');
  vBtn.textContent = 'VFlip';
  vBtn.className = fb.vflip ? 'active' : '';
  vBtn.addEventListener('click', () => {
    fb.vflip = fb.vflip ? 0 : 1;
    vBtn.className = fb.vflip ? 'active' : '';
  });
  row.appendChild(vBtn);

  container.appendChild(row);
}

export interface UICallbacks {
  onCameraSelect: () => void;
  onScreenCapture: () => void;
  onPhosphorm: () => void;
  onAudioTab: () => void;
  onAudioMic: () => void;
  onAudioOff: () => void;
  onClear: () => void;
  onTestPattern: () => void;
  onResize?: (w: number, h: number) => void;
  renderer?: Renderer;
  presetManager?: PresetManager;
  audioReactor?: AudioReactor;
  audioReactorParams?: AudioReactorParams;
}

/** Sync all slider positions to current param values */
export function syncSliders(params: RenderParams) {
  for (const { def, input, valSpan } of sliderRegistry) {
    const v = def.get(params);
    input.value = String(v);
    valSpan.textContent = v.toFixed(2);
  }
}

/** Tick slider input smoothing. Call every frame. */
export function tickSliderInputSmooth(params: RenderParams): void {
  for (const [key, { def, target }] of sliderInputTargets) {
    const current = def.get(params);
    const diff = target - current;
    if (Math.abs(diff) < 0.0005) {
      def.set(params, target);
      sliderInputTargets.delete(key);
    } else {
      def.set(params, current + diff * SLIDER_INPUT_SMOOTH);
    }
  }
}

/** Tick per-slider smooth resets. Returns true if any active. */
export function tickSliderSmooth(params: RenderParams): boolean {
  if (sliderSmoothTargets.size === 0) return false;

  for (const [key, { def, target }] of sliderSmoothTargets) {
    const current = def.get(params);
    const diff = target - current;
    if (Math.abs(diff) < 0.001) {
      def.set(params, target);
      sliderSmoothTargets.delete(key);
    } else {
      def.set(params, current + diff * SLIDER_SMOOTH_RATE);
    }
  }
  return sliderSmoothTargets.size > 0;
}

type GenericSliderDef<T> = {
  label: string;
  key: string;
  min: number;
  max: number;
  step: number;
  defaultVal: number;
  get: (p: T) => number;
  set: (p: T, v: number) => void;
};

/** Registry for generic sliders (phosphorm, spectral) to enable sync on reset */
const genericSliderRegistry: { key: string; sync: () => void }[] = [];

function syncGenericSliders(prefix: string) {
  for (const entry of genericSliderRegistry) {
    if (entry.key.startsWith(prefix)) entry.sync();
  }
}

function makeGenericSlider<T>(container: HTMLElement, def: GenericSliderDef<T>, params: T): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'ctrl-row';

  const label = document.createElement('label');
  label.textContent = def.label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(def.min);
  input.max = String(def.max);
  input.step = String(def.step);
  input.value = String(def.get(params));

  const val = document.createElement('span');
  val.className = 'val';
  val.textContent = Number(input.value).toFixed(2);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    def.set(params, v);
    val.textContent = v.toFixed(2);
  });

  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    def.set(params, def.defaultVal);
    input.value = String(def.defaultVal);
    val.textContent = def.defaultVal.toFixed(2);
  });

  label.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    def.set(params, def.defaultVal);
    input.value = String(def.defaultVal);
    val.textContent = def.defaultVal.toFixed(2);
  });

  label.style.cursor = 'pointer';
  label.title = 'Double-click: smooth reset | Right-click: instant reset';

  row.append(label, input, val);
  container.appendChild(row);

  genericSliderRegistry.push({
    key: def.key,
    sync: () => {
      const v = def.get(params);
      input.value = String(v);
      val.textContent = v.toFixed(2);
    },
  });

  return input;
}

function makeToggleButton(container: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void) {
  const btn = document.createElement('button');
  btn.textContent = label;
  btn.className = get() ? 'active' : '';
  btn.addEventListener('click', () => {
    set(!get());
    btn.className = get() ? 'active' : '';
  });
  container.appendChild(btn);
  return btn;
}

export function buildUI(container: HTMLElement, params: RenderParams, phosphormParams: PhosphormParams, spectralParams: SpectralMeshParams, callbacks: UICallbacks) {
  container.innerHTML = '';
  sliderRegistry.length = 0;
  sliderSmoothTargets.clear();
  sliderInputTargets.clear();
  genericSliderRegistry.length = 0;

  // --- Input Source ---
  const sec = document.createElement('div');
  sec.className = 'section';
  const h = document.createElement('h3');
  h.textContent = 'INPUT SOURCE';
  sec.appendChild(h);

  const btnRow = document.createElement('div');
  btnRow.className = 'input-row';
  btnRow.style.flexWrap = 'wrap';

  for (const [label, cb] of [
    ['Camera', callbacks.onCameraSelect],
    ['Screen/Tab', callbacks.onScreenCapture],
    ['Clear FBs', callbacks.onClear],
    ['Test Pattern', callbacks.onTestPattern],
  ] as [string, () => void][]) {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.addEventListener('click', cb);
    btnRow.appendChild(btn);
  }

  // Phosphorm button with centered overlay popup
  {
    const phBtn = document.createElement('button');
    phBtn.textContent = 'Phosphorm';

    const overlay = document.createElement('div');
    overlay.style.cssText = 'display:none;position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.7);z-index:30;align-items:center;justify-content:center;';

    const dialog = document.createElement('div');
    dialog.style.cssText = 'background:#1a1a1a;border:1px solid #0f0;padding:20px 24px;text-align:center;min-width:220px;';

    const title = document.createElement('div');
    title.textContent = 'Phosphorm Audio';
    title.style.cssText = 'color:#0f0;font-size:14px;margin-bottom:12px;';
    dialog.appendChild(title);

    for (const [label, desc, cb] of [
      ['No Audio', 'Internal oscillators only', async () => { phosphormParams.useAudioInput = false; await callbacks.onPhosphorm(); callbacks.onAudioOff(); }],
      ['Tab Audio', 'Capture audio from a browser tab', async () => { phosphormParams.useAudioInput = true; await callbacks.onPhosphorm(); await callbacks.onAudioTab(); }],
      ['Mic', 'Use microphone input', async () => { phosphormParams.useAudioInput = true; await callbacks.onPhosphorm(); await callbacks.onAudioMic(); }],
    ] as [string, string, () => void][]) {
      const opt = document.createElement('button');
      opt.style.cssText = 'display:block;width:100%;padding:8px 12px;margin:4px 0;font-size:12px;text-align:left;';
      opt.innerHTML = `<span style="color:#0f0">${label}</span> <span style="color:#666;font-size:10px;">${desc}</span>`;
      opt.addEventListener('click', () => {
        overlay.style.display = 'none';
        cb();
      });
      dialog.appendChild(opt);
    }

    overlay.appendChild(dialog);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.style.display = 'none';
    });
    document.body.appendChild(overlay);

    phBtn.addEventListener('click', () => {
      overlay.style.display = 'flex';
    });

    btnRow.appendChild(phBtn);
  }

  sec.appendChild(btnRow);

  // Global Reset row
  const resetRow = document.createElement('div');
  resetRow.className = 'input-row';
  resetRow.style.flexWrap = 'wrap';

  const resetAllBtn = document.createElement('button');
  resetAllBtn.textContent = 'Reset All';
  resetAllBtn.style.background = '#300';
  resetAllBtn.addEventListener('click', () => { resetAll(params); syncSliders(params); });

  const smoothAllBtn = document.createElement('button');
  smoothAllBtn.textContent = 'Smooth Reset All';
  smoothAllBtn.style.background = '#230';
  smoothAllBtn.addEventListener('click', () => smoothResetAll(params));

  resetRow.append(resetAllBtn, smoothAllBtn);
  sec.appendChild(resetRow);

  // Resolution + Pop-out row
  const resRow = document.createElement('div');
  resRow.className = 'input-row';
  resRow.style.flexWrap = 'wrap';

  const resLabel = document.createElement('label');
  resLabel.textContent = 'Resolution';
  resLabel.style.cssText = 'color:#888;font-size:10px;margin-right:4px;';
  resRow.appendChild(resLabel);

  const resSelect = document.createElement('select');
  resSelect.style.cssText = 'width:auto;font-size:10px;padding:2px 4px;';
  const resolutions = [
    [640, 360, '640x360'],
    [960, 540, '960x540'],
    [1280, 720, '1280x720'],
    [1920, 1080, '1920x1080'],
  ] as [number, number, string][];
  for (const [w, h, label] of resolutions) {
    const opt = document.createElement('option');
    opt.value = `${w}x${h}`;
    opt.textContent = label;
    if (w === 1280) opt.selected = true;
    resSelect.appendChild(opt);
  }
  resSelect.addEventListener('change', () => {
    const [w, h] = resSelect.value.split('x').map(Number);
    if (callbacks.onResize) callbacks.onResize(w, h);
  });
  resRow.appendChild(resSelect);

  const popOutBtn = document.createElement('button');
  popOutBtn.textContent = 'Pop Out';
  popOutBtn.style.cssText = 'font-size:10px;padding:2px 8px;margin-left:auto;';
  popOutBtn.addEventListener('click', () => {
    popOutControls(container);
  });
  resRow.appendChild(popOutBtn);

  sec.appendChild(resRow);

  // Help hint
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#555;font-size:9px;margin:4px 0;';
  hint.textContent = 'Double-click slider: smooth reset | Right-click: instant reset';
  sec.appendChild(hint);

  // MIDI status
  const midiStatus = document.createElement('div');
  midiStatus.id = 'midi-status';
  midiStatus.style.cssText = 'color:#555;font-size:9px;margin:2px 0;';
  midiStatus.textContent = 'MIDI: scanning...';
  sec.appendChild(midiStatus);

  container.appendChild(sec);

  // --- Presets ---
  if (callbacks.presetManager) {
    const pm = callbacks.presetManager;
    const s = document.createElement('div');
    s.className = 'section';
    const title = document.createElement('h3');
    title.textContent = 'PRESETS';
    s.appendChild(title);

    const saveRow = document.createElement('div');
    saveRow.className = 'ctrl-row';
    saveRow.style.cssText = 'display:flex;gap:4px;align-items:center;flex-wrap:wrap;';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = `Preset ${pm.getAll().length + 1}`;
    nameInput.style.cssText = 'flex:1;font-size:10px;padding:4px;background:#222;color:#ccc;border:1px solid #444;min-width:80px;';

    const persistCheck = document.createElement('input');
    persistCheck.type = 'checkbox';
    persistCheck.id = 'preset-persist';
    persistCheck.checked = true;
    const persistLabel = document.createElement('label');
    persistLabel.htmlFor = 'preset-persist';
    persistLabel.textContent = 'Keep';
    persistLabel.style.cssText = 'font-size:9px;cursor:pointer;';
    persistLabel.title = 'Persist in localStorage across reloads';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'font-size:10px;padding:2px 8px;';
    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || null;
      pm.save(name, persistCheck.checked, params, phosphormParams, spectralParams);
      nameInput.value = '';
      nameInput.placeholder = `Preset ${pm.getAll().length + 1}`;
      rebuildPresetList();
    });

    saveRow.append(nameInput, persistCheck, persistLabel, saveBtn);
    s.appendChild(saveRow);

    const listContainer = document.createElement('div');
    listContainer.style.cssText = 'margin-top:4px;';
    s.appendChild(listContainer);

    function rebuildPresetList() {
      listContainer.innerHTML = '';
      const presets = pm.getAll();
      for (const preset of presets) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;padding:2px 0;';

        if (preset.persist) {
          const badge = document.createElement('span');
          badge.textContent = '\u25CF';
          badge.style.cssText = 'color:#0a0;font-size:8px;';
          badge.title = 'Persisted';
          row.appendChild(badge);
        }

        const nameBtn = document.createElement('button');
        nameBtn.textContent = preset.name;
        nameBtn.style.cssText = 'flex:1;font-size:10px;padding:2px 6px;text-align:left;';
        nameBtn.addEventListener('click', () => {
          pm.load(preset.id, params, phosphormParams, spectralParams);
          syncSliders(params);
          // Recompile custom shaders if renderer available
          if (callbacks.renderer) {
            for (const cs of params.customShaders) {
              callbacks.renderer.compileCustomShader(cs.id, cs.source);
            }
          }
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'X';
        delBtn.style.cssText = 'font-size:9px;padding:2px 5px;background:#300;min-width:0;';
        delBtn.addEventListener('click', () => {
          pm.delete(preset.id);
          rebuildPresetList();
        });

        row.append(nameBtn, delBtn);
        listContainer.appendChild(row);
      }
    }

    rebuildPresetList();
    container.appendChild(s);
  }

  // --- Channel 1 ---
  {
    const s = document.createElement('div');
    s.className = 'section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0;';

    const title = document.createElement('h3');
    title.textContent = 'CHANNEL 1 (INPUT)';
    title.style.cssText = 'flex:1;margin:0;';

    const ch1ResetBtn = document.createElement('button');
    ch1ResetBtn.textContent = 'Reset';
    ch1ResetBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#300;';
    ch1ResetBtn.addEventListener('click', () => {
      const def = defaultParams().channel1;
      Object.assign(params.channel1, def);
      syncSliders(params);
    });

    const ch1SmoothBtn = document.createElement('button');
    ch1SmoothBtn.textContent = 'Smooth';
    ch1SmoothBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#230;';
    ch1SmoothBtn.addEventListener('click', () => {
      // Smooth reset all ch1 sliders via per-slider smooth
      const defCh = defaultParams().channel1;
      const keys: [string, number][] = [
        ['ch1_hue', defCh.hue], ['ch1_sat', defCh.sat], ['ch1_bright', defCh.bright],
        ['ch1_spow', defCh.satPowmap], ['ch1_bpow', defCh.brightPowmap],
      ];
      for (const entry of sliderRegistry) {
        const match = keys.find(([k]) => k === entry.def.key);
        if (match) {
          sliderSmoothTargets.set(match[0], { def: entry.def, target: match[1] });
        }
      }
    });

    headerRow.append(title, ch1ResetBtn, ch1SmoothBtn);
    s.appendChild(headerRow);

    const defCh = defaultParams().channel1;
    const ch1Sliders: SliderDef[] = [
      { label: 'Hue', key: 'ch1_hue', min: -5, max: 5, step: 0.01, defaultVal: defCh.hue,
        get: p => p.channel1.hue, set: (p, v) => { p.channel1.hue = v; } },
      { label: 'Saturation', key: 'ch1_sat', min: -5, max: 5, step: 0.01, defaultVal: defCh.sat,
        get: p => p.channel1.sat, set: (p, v) => { p.channel1.sat = v; } },
      { label: 'Brightness', key: 'ch1_bright', min: -5, max: 5, step: 0.01, defaultVal: defCh.bright,
        get: p => p.channel1.bright, set: (p, v) => { p.channel1.bright = v; } },
      { label: 'Sat Powmap', key: 'ch1_spow', min: 0.1, max: 5, step: 0.01, defaultVal: defCh.satPowmap,
        get: p => p.channel1.satPowmap, set: (p, v) => { p.channel1.satPowmap = v; } },
      { label: 'Brt Powmap', key: 'ch1_bpow', min: 0.1, max: 5, step: 0.01, defaultVal: defCh.brightPowmap,
        get: p => p.channel1.brightPowmap, set: (p, v) => { p.channel1.brightPowmap = v; } },
    ];

    ch1Sliders.forEach(d => makeSlider(s, d, params));
    container.appendChild(s);
  }

  // --- Feedback Buffers ---
  for (let i = 0; i < 4; i++) {
    const s = document.createElement('div');
    s.className = 'section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0;';

    const title = document.createElement('h3');
    title.textContent = `FB ${i}`;
    title.style.cssText = 'cursor:pointer;flex:1;margin:0;';

    const fbResetBtn = document.createElement('button');
    fbResetBtn.textContent = 'Reset';
    fbResetBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#300;';
    fbResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      resetFB(params, i);
      syncSliders(params);
    });

    const fbSmoothBtn = document.createElement('button');
    fbSmoothBtn.textContent = 'Smooth';
    fbSmoothBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#230;';
    fbSmoothBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      smoothResetFB(params, i);
    });

    headerRow.append(title, fbResetBtn, fbSmoothBtn);

    const content = document.createElement('div');
    if (i > 0) content.style.display = 'none';
    title.addEventListener('click', () => {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });

    s.appendChild(headerRow);
    const onUserInput = () => cancelSmoothFB(i);
    fbSliders(i).forEach(d => makeSlider(content, d, params, onUserInput));
    makeToggleRow(content, params.fb[i]);
    s.appendChild(content);
    container.appendChild(s);
  }

  // --- Post FX ---
  {
    const s = document.createElement('div');
    s.className = 'section';
    const title = document.createElement('h3');
    title.textContent = 'POST FX';
    s.appendChild(title);

    const defP = defaultParams();
    const postSliders: SliderDef[] = [
      { label: 'Blur Amt', key: 'blur_amt', min: 0, max: 1, step: 0.01, defaultVal: defP.blur.amount,
        get: p => p.blur.amount, set: (p, v) => { p.blur.amount = v; } },
      { label: 'Blur Rad', key: 'blur_rad', min: 0, max: 20, step: 0.1, defaultVal: defP.blur.radius,
        get: p => p.blur.radius, set: (p, v) => { p.blur.radius = v; } },
      { label: 'Sharp Amt', key: 'sharp_amt', min: 0, max: 2, step: 0.01, defaultVal: defP.sharpen.amount,
        get: p => p.sharpen.amount, set: (p, v) => { p.sharpen.amount = v; } },
      { label: 'Sharp Boost', key: 'sharp_boost', min: 0, max: 2, step: 0.01, defaultVal: defP.sharpen.boost,
        get: p => p.sharpen.boost, set: (p, v) => { p.sharpen.boost = v; } },
      { label: 'Sharp Rad', key: 'sharp_rad', min: 0, max: 20, step: 0.1, defaultVal: defP.sharpen.radius,
        get: p => p.sharpen.radius, set: (p, v) => { p.sharpen.radius = v; } },
    ];

    postSliders.forEach(d => makeSlider(s, d, params));
    container.appendChild(s);
  }

  // --- Audio Reactor ---
  if (callbacks.audioReactor && callbacks.audioReactorParams) {
    const ar = callbacks.audioReactor;
    const arP = callbacks.audioReactorParams;
    const s = document.createElement('div');
    s.className = 'section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0;';
    const title = document.createElement('h3');
    title.textContent = 'AUDIO REACTOR';
    title.style.cssText = 'cursor:pointer;flex:1;margin:0;';
    const content = document.createElement('div');
    content.style.display = 'none';
    title.addEventListener('click', () => {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });
    headerRow.appendChild(title);
    s.appendChild(headerRow);

    // Audio source buttons
    const srcRow = document.createElement('div');
    srcRow.className = 'ctrl-row';
    const srcLbl = document.createElement('label');
    srcLbl.textContent = 'Source';
    srcRow.appendChild(srcLbl);

    const statusSpan = document.createElement('span');
    statusSpan.style.cssText = 'color:#555;font-size:9px;margin-left:4px;';
    statusSpan.textContent = 'Off';

    const micBtn = document.createElement('button');
    micBtn.textContent = 'Mic';
    micBtn.addEventListener('click', async () => {
      await ar.startMic();
      arP.enabled = true;
      statusSpan.textContent = ar.active ? 'Mic active' : 'Failed';
      statusSpan.style.color = ar.active ? '#0a0' : '#f33';
    });

    const tabBtn = document.createElement('button');
    tabBtn.textContent = 'Tab Audio';
    tabBtn.addEventListener('click', async () => {
      await ar.startTabAudio();
      arP.enabled = true;
      statusSpan.textContent = ar.active ? 'Tab active' : 'Failed';
      statusSpan.style.color = ar.active ? '#0a0' : '#f33';
    });

    const offBtn = document.createElement('button');
    offBtn.textContent = 'Off';
    offBtn.addEventListener('click', () => {
      ar.stop();
      arP.enabled = false;
      statusSpan.textContent = 'Off';
      statusSpan.style.color = '#555';
    });

    srcRow.append(micBtn, tabBtn, offBtn, statusSpan);
    content.appendChild(srcRow);

    // Target FB selector
    const fbRow = document.createElement('div');
    fbRow.className = 'ctrl-row';
    const fbLbl = document.createElement('label');
    fbLbl.textContent = 'Target FB';
    fbRow.appendChild(fbLbl);
    for (let i = 0; i < 4; i++) {
      const btn = document.createElement('button');
      btn.textContent = `FB${i}`;
      btn.className = arP.targetFB === i ? 'active' : '';
      btn.addEventListener('click', () => {
        arP.targetFB = i;
        fbRow.querySelectorAll('button').forEach((b, j) => {
          b.className = j === i ? 'active' : '';
        });
      });
      fbRow.appendChild(btn);
    }
    content.appendChild(fbRow);

    // Modulation targets
    const modRow = document.createElement('div');
    modRow.className = 'ctrl-row';
    modRow.style.flexWrap = 'wrap';
    const modLbl = document.createElement('label');
    modLbl.textContent = 'Modulate';
    modRow.appendChild(modLbl);
    const modTargets: [string, keyof AudioReactorParams][] = [
      ['Rotate', 'modRotate'], ['Zoom', 'modZoom'], ['X', 'modX'], ['Y', 'modY'], ['Hue', 'modHue'],
    ];
    for (const [label, key] of modTargets) {
      makeToggleButton(modRow, label, () => arP[key] as boolean, v => { (arP as any)[key] = v; });
    }
    content.appendChild(modRow);

    // Spectral Mesh modulation targets
    const meshModH = document.createElement('div');
    meshModH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    meshModH.textContent = 'Spectral Mesh';
    content.appendChild(meshModH);

    const meshModRow = document.createElement('div');
    meshModRow.className = 'ctrl-row';
    meshModRow.style.flexWrap = 'wrap';
    const meshTargets: [string, keyof AudioReactorParams][] = [
      ['Displace X', 'meshDisplaceX'], ['Displace Y', 'meshDisplaceY'],
      ['Z Amp', 'meshZAmp'], ['X Amp', 'meshXAmp'], ['Y Amp', 'meshYAmp'],
      ['Luma Key', 'meshLumaKey'],
    ];
    for (const [label, key] of meshTargets) {
      makeToggleButton(meshModRow, label, () => arP[key] as boolean, v => { (arP as any)[key] = v; });
    }
    content.appendChild(meshModRow);

    // Band amount sliders
    const arDef = defaultAudioReactorParams();
    const arSliders: GenericSliderDef<AudioReactorParams>[] = [
      { label: 'Low Amt', key: 'ar_low', min: 0, max: 2, step: 0.01, defaultVal: arDef.lowAmt,
        get: p => p.lowAmt, set: (p, v) => { p.lowAmt = v; } },
      { label: 'Mid Amt', key: 'ar_mid', min: 0, max: 2, step: 0.01, defaultVal: arDef.midAmt,
        get: p => p.midAmt, set: (p, v) => { p.midAmt = v; } },
      { label: 'High Amt', key: 'ar_high', min: 0, max: 2, step: 0.01, defaultVal: arDef.highAmt,
        get: p => p.highAmt, set: (p, v) => { p.highAmt = v; } },
      { label: 'Smoothing', key: 'ar_smooth', min: 0.5, max: 0.99, step: 0.01, defaultVal: arDef.smoothing,
        get: p => p.smoothing, set: (p, v) => { p.smoothing = v; } },
    ];
    arSliders.forEach(d => makeGenericSlider(content, d, arP));

    s.appendChild(content);
    container.appendChild(s);
  }

  // --- Pipeline Order ---
  let rebuildPipelineRow: () => void;
  {
    const s = document.createElement('div');
    s.className = 'section';
    const title = document.createElement('h3');
    title.textContent = 'PIPELINE ORDER';
    title.style.cursor = 'pointer';
    s.appendChild(title);

    const pipeContent = document.createElement('div');
    pipeContent.style.display = 'none';
    title.addEventListener('click', () => {
      pipeContent.style.display = pipeContent.style.display === 'none' ? '' : 'none';
    });

    const row = document.createElement('div');
    row.className = 'ctrl-row';
    row.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;';

    const builtinLabels: Record<string, string> = {
      spectral: 'Spectral',
      mixer: 'Mixer',
      blur: 'Blur',
      sharpen: 'Sharpen',
    };

    function getStageLabel(stage: PipelineStage): string {
      if (builtinLabels[stage]) return builtinLabels[stage];
      const cs = params.customShaders.find(s => s.id === stage);
      return cs ? cs.name : stage;
    }

    rebuildPipelineRow = () => {
      row.innerHTML = '';
      params.pipeline.forEach((stage, idx) => {
        const group = document.createElement('div');
        group.style.cssText = 'display:flex;align-items:center;gap:1px;';

        const upBtn = document.createElement('button');
        upBtn.textContent = '\u25B2';
        upBtn.style.cssText = 'font-size:9px;padding:2px 4px;min-width:0;';
        upBtn.disabled = idx === 0;
        upBtn.addEventListener('click', () => {
          [params.pipeline[idx - 1], params.pipeline[idx]] = [params.pipeline[idx], params.pipeline[idx - 1]];
          rebuildPipelineRow();
        });

        const label = document.createElement('button');
        label.textContent = getStageLabel(stage);
        label.style.cssText = 'font-size:10px;padding:2px 6px;min-width:0;cursor:default;';

        const downBtn = document.createElement('button');
        downBtn.textContent = '\u25BC';
        downBtn.style.cssText = 'font-size:9px;padding:2px 4px;min-width:0;';
        downBtn.disabled = idx === params.pipeline.length - 1;
        downBtn.addEventListener('click', () => {
          [params.pipeline[idx], params.pipeline[idx + 1]] = [params.pipeline[idx + 1], params.pipeline[idx]];
          rebuildPipelineRow();
        });

        group.append(upBtn, label, downBtn);
        row.appendChild(group);
      });

      // Reset button
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Reset';
      resetBtn.style.cssText = 'font-size:9px;padding:2px 6px;margin-left:4px;background:#300;';
      resetBtn.addEventListener('click', () => {
        params.pipeline = [...DEFAULT_PIPELINE];
        rebuildPipelineRow();
      });
      row.appendChild(resetBtn);
    };

    rebuildPipelineRow();
    pipeContent.appendChild(row);
    s.appendChild(pipeContent);
    container.appendChild(s);
  }

  // --- Custom Shaders ---
  if (callbacks.renderer) {
    const renderer = callbacks.renderer;
    const s = document.createElement('div');
    s.className = 'section';
    const sTitle = document.createElement('h3');
    sTitle.textContent = 'CUSTOM SHADERS';
    sTitle.style.cursor = 'pointer';
    const sContent = document.createElement('div');
    sContent.style.display = 'none';
    sTitle.addEventListener('click', () => {
      sContent.style.display = sContent.style.display === 'none' ? '' : 'none';
    });
    s.appendChild(sTitle);

    const addBtn = document.createElement('button');
    addBtn.textContent = '+ Add Shader';
    addBtn.style.cssText = 'font-size:10px;padding:2px 8px;margin-bottom:4px;';
    addBtn.addEventListener('click', () => {
      const id = `custom_${Date.now()}`;
      params.customShaders.push({
        id,
        name: `Shader ${params.customShaders.length + 1}`,
        source: DEFAULT_CUSTOM_SHADER,
      });
      renderer.compileCustomShader(id, DEFAULT_CUSTOM_SHADER);
      rebuildShaderList();
    });
    const crtBtn = document.createElement('button');
    crtBtn.textContent = '+ CRT Effect';
    crtBtn.style.cssText = 'font-size:10px;padding:2px 8px;margin-bottom:4px;margin-left:4px;';
    crtBtn.addEventListener('click', () => {
      const id = `custom_${Date.now()}`;
      params.customShaders.push({ id, name: 'CRT', source: CRT_SHADER });
      renderer.compileCustomShader(id, CRT_SHADER);
      params.pipeline.push(id);
      rebuildPipelineRow();
      rebuildShaderList();
    });

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:0;margin-bottom:4px;';
    btnRow.append(addBtn, crtBtn);
    sContent.appendChild(btnRow);

    const shaderListEl = document.createElement('div');
    sContent.appendChild(shaderListEl);

    function rebuildShaderList() {
      shaderListEl.innerHTML = '';
      params.customShaders.forEach((shader, idx) => {
        const box = document.createElement('div');
        box.style.cssText = 'margin:6px 0;padding:6px;background:#1a1a1a;border:1px solid #333;';

        // Header: name + buttons
        const hdr = document.createElement('div');
        hdr.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px;';

        const nameIn = document.createElement('input');
        nameIn.type = 'text';
        nameIn.value = shader.name;
        nameIn.style.cssText = 'flex:1;font-size:10px;padding:3px;background:#222;color:#ccc;border:1px solid #444;';
        nameIn.addEventListener('input', () => {
          shader.name = nameIn.value;
          rebuildPipelineRow();
        });

        const pipeBtn = document.createElement('button');
        const inPipeline = params.pipeline.includes(shader.id);
        pipeBtn.textContent = inPipeline ? 'In Pipeline' : '+ Pipeline';
        pipeBtn.style.cssText = `font-size:9px;padding:2px 6px;${inPipeline ? 'background:#040;' : ''}`;
        pipeBtn.addEventListener('click', () => {
          if (!params.pipeline.includes(shader.id)) {
            params.pipeline.push(shader.id);
          } else {
            params.pipeline = params.pipeline.filter(s => s !== shader.id);
          }
          rebuildPipelineRow();
          rebuildShaderList();
        });

        const delBtn = document.createElement('button');
        delBtn.textContent = 'Del';
        delBtn.style.cssText = 'font-size:9px;padding:2px 6px;background:#500;';
        delBtn.addEventListener('click', () => {
          params.pipeline = params.pipeline.filter(s => s !== shader.id);
          renderer.deleteCustomShader(shader.id);
          params.customShaders.splice(idx, 1);
          rebuildPipelineRow();
          rebuildShaderList();
        });

        hdr.append(nameIn, pipeBtn, delBtn);
        box.appendChild(hdr);

        // Textarea
        const ta = document.createElement('textarea');
        ta.value = shader.source;
        ta.style.cssText = 'width:100%;height:180px;font-family:monospace;font-size:9px;background:#111;color:#ccc;border:1px solid #333;resize:vertical;box-sizing:border-box;';
        ta.spellcheck = false;
        let compileTimer = 0;
        ta.addEventListener('input', () => {
          shader.source = ta.value;
          clearTimeout(compileTimer);
          compileTimer = window.setTimeout(() => {
            const result = renderer.compileCustomShader(shader.id, shader.source);
            if (result.success) {
              errDiv.textContent = 'Compiled OK';
              errDiv.style.color = '#0a0';
            } else {
              errDiv.textContent = result.error || 'Compile error';
              errDiv.style.color = '#f33';
            }
          }, 500);
        });
        box.appendChild(ta);

        // Error display
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'font-size:9px;margin-top:2px;white-space:pre-wrap;';
        const existingErr = renderer.getCustomShaderError(shader.id);
        if (existingErr) {
          errDiv.textContent = existingErr;
          errDiv.style.color = '#f33';
        } else {
          errDiv.textContent = 'Compiled OK';
          errDiv.style.color = '#0a0';
        }
        box.appendChild(errDiv);

        shaderListEl.appendChild(box);
      });
    }

    rebuildShaderList();
    s.appendChild(sContent);
    container.appendChild(s);
  }

  // --- Phosphorm ---
  {
    const s = document.createElement('div');
    s.className = 'section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0;';

    const title = document.createElement('h3');
    title.textContent = 'PHOSPHORM';
    title.style.cssText = 'cursor:pointer;flex:1;margin:0;';
    const content = document.createElement('div');
    content.style.display = 'none';
    title.addEventListener('click', () => {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });

    const phResetBtn = document.createElement('button');
    phResetBtn.textContent = 'Reset';
    phResetBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#300;';
    phResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Object.assign(phosphormParams, defaultPhosphormParams());
      syncGenericSliders('ph_');
    });

    headerRow.append(title, phResetBtn);
    s.appendChild(headerRow);

    const pDef = defaultPhosphormParams();

    // Audio input buttons
    const audioRow = document.createElement('div');
    audioRow.className = 'ctrl-row';
    const audioLbl = document.createElement('label');
    audioLbl.textContent = 'Audio';
    audioRow.appendChild(audioLbl);

    const tabBtn = document.createElement('button');
    tabBtn.textContent = 'Tab Audio';
    tabBtn.addEventListener('click', () => {
      phosphormParams.useAudioInput = true;
      tabBtn.className = 'active';
      micBtn.className = '';
      callbacks.onAudioTab();
    });

    const micBtn = document.createElement('button');
    micBtn.textContent = 'Mic';
    micBtn.addEventListener('click', () => {
      phosphormParams.useAudioInput = true;
      micBtn.className = 'active';
      tabBtn.className = '';
      callbacks.onAudioMic();
    });

    const offBtn = document.createElement('button');
    offBtn.textContent = 'Off';
    offBtn.addEventListener('click', () => {
      phosphormParams.useAudioInput = false;
      tabBtn.className = '';
      micBtn.className = '';
      callbacks.onAudioOff();
    });

    audioRow.append(tabBtn, micBtn, offBtn);
    content.appendChild(audioRow);

    // Scope display toggle
    const scopeRow = document.createElement('div');
    scopeRow.className = 'ctrl-row';
    const scopeLbl = document.createElement('label');
    scopeLbl.textContent = 'Display';
    scopeRow.appendChild(scopeLbl);
    makeToggleButton(scopeRow, 'Scope CRT', () => phosphormParams.scopeDisplay, v => { phosphormParams.scopeDisplay = v; });
    content.appendChild(scopeRow);

    const oscNames = ['oscL1', 'oscR1', 'oscL2', 'oscR2'] as const;
    const oscLabels = ['Osc L1', 'Osc R1', 'Osc L2', 'Osc R2'];

    for (let i = 0; i < 4; i++) {
      const name = oscNames[i];
      const oscH = document.createElement('div');
      oscH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
      oscH.textContent = oscLabels[i];
      content.appendChild(oscH);

      const dOsc = pDef[name];
      const sliders: GenericSliderDef<PhosphormParams>[] = [
        { label: 'Freq', key: `ph_${name}_freq`, min: 0, max: 20, step: 0.1, defaultVal: dOsc.freq,
          get: p => p[name].freq, set: (p, v) => { p[name].freq = v; } },
        { label: 'Amp', key: `ph_${name}_amp`, min: 0, max: 2, step: 0.01, defaultVal: dOsc.amp,
          get: p => p[name].amp, set: (p, v) => { p[name].amp = v; } },
        { label: 'Shape', key: `ph_${name}_shape`, min: 0, max: 2, step: 1, defaultVal: dOsc.shape,
          get: p => p[name].shape, set: (p, v) => { p[name].shape = Math.round(v); } },
        { label: 'Phase Mod', key: `ph_${name}_pm`, min: 0, max: 10, step: 0.1, defaultVal: dOsc.phaseModAmp,
          get: p => p[name].phaseModAmp, set: (p, v) => { p[name].phaseModAmp = v; } },
        { label: 'AM Freq', key: `ph_${name}_amf`, min: 0, max: 10, step: 0.1, defaultVal: dOsc.ampModFreq,
          get: p => p[name].ampModFreq, set: (p, v) => { p[name].ampModFreq = v; } },
        { label: 'AM Amp', key: `ph_${name}_ama`, min: 0, max: 2, step: 0.01, defaultVal: dOsc.ampModAmp,
          get: p => p[name].ampModAmp, set: (p, v) => { p[name].ampModAmp = v; } },
      ];
      sliders.forEach(d => makeGenericSlider(content, d, phosphormParams));
    }

    // Decay, audio reactivity, line color
    const globalSliders: GenericSliderDef<PhosphormParams>[] = [
      { label: 'Decay', key: 'ph_decay', min: 0, max: 0.25, step: 0.001, defaultVal: pDef.decay,
        get: p => p.decay, set: (p, v) => { p.decay = v; } },
      { label: 'Audio React', key: 'ph_areact', min: 0, max: 2, step: 0.01, defaultVal: pDef.audioReactivity,
        get: p => p.audioReactivity, set: (p, v) => { p.audioReactivity = v; } },
      { label: 'Color R', key: 'ph_cr', min: 0, max: 1, step: 0.01, defaultVal: pDef.lineColor[0],
        get: p => p.lineColor[0], set: (p, v) => { p.lineColor[0] = v; } },
      { label: 'Color G', key: 'ph_cg', min: 0, max: 1, step: 0.01, defaultVal: pDef.lineColor[1],
        get: p => p.lineColor[1], set: (p, v) => { p.lineColor[1] = v; } },
      { label: 'Color B', key: 'ph_cb', min: 0, max: 1, step: 0.01, defaultVal: pDef.lineColor[2],
        get: p => p.lineColor[2], set: (p, v) => { p.lineColor[2] = v; } },
    ];
    globalSliders.forEach(d => makeGenericSlider(content, d, phosphormParams));

    s.appendChild(content);
    container.appendChild(s);
  }

  // --- Spectral Mesh ---
  {
    const s = document.createElement('div');
    s.className = 'section';

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex;align-items:center;gap:4px;margin:4px 0;';

    const title = document.createElement('h3');
    title.textContent = 'SPECTRAL MESH';
    title.style.cssText = 'cursor:pointer;flex:1;margin:0;';
    const content = document.createElement('div');
    content.style.display = 'none';
    title.addEventListener('click', () => {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });

    const smResetBtn = document.createElement('button');
    smResetBtn.textContent = 'Reset';
    smResetBtn.style.cssText = 'font-size:10px;padding:2px 6px;background:#300;';
    smResetBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      Object.assign(spectralParams, defaultSpectralParams());
      syncGenericSliders('sm_');
    });

    headerRow.append(title, smResetBtn);
    s.appendChild(headerRow);

    const sDef = defaultSpectralParams();

    // Enable toggle
    const enableRow = document.createElement('div');
    enableRow.className = 'ctrl-row';
    const enableLbl = document.createElement('label');
    enableLbl.textContent = 'Enable';
    enableRow.appendChild(enableLbl);
    makeToggleButton(enableRow, 'On/Off', () => spectralParams.enabled, v => { spectralParams.enabled = v; });
    content.appendChild(enableRow);

    // Mesh type toggle
    const meshTypeRow = document.createElement('div');
    meshTypeRow.className = 'ctrl-row';
    const meshLbl = document.createElement('label');
    meshLbl.textContent = 'Mesh';
    meshTypeRow.appendChild(meshLbl);
    const meshLabels = ['Triangles', 'Wireframe', 'H-Lines', 'V-Lines'];
    const meshBtn = document.createElement('button');
    meshBtn.textContent = meshLabels[spectralParams.meshType];
    meshBtn.addEventListener('click', () => {
      spectralParams.meshType = (spectralParams.meshType + 1) % 4;
      meshBtn.textContent = meshLabels[spectralParams.meshType];
    });
    meshTypeRow.appendChild(meshBtn);
    content.appendChild(meshTypeRow);

    // Grid + displacement
    const mainSliders: GenericSliderDef<SpectralMeshParams>[] = [
      { label: 'Resolution', key: 'sm_res', min: 4, max: 128, step: 1, defaultVal: sDef.resolution,
        get: p => p.resolution, set: (p, v) => { p.resolution = Math.round(v); } },
      { label: 'Displace X', key: 'sm_dx', min: -2, max: 2, step: 0.01, defaultVal: sDef.displaceX,
        get: p => p.displaceX, set: (p, v) => { p.displaceX = v; } },
      { label: 'Displace Y', key: 'sm_dy', min: -2, max: 2, step: 0.01, defaultVal: sDef.displaceY,
        get: p => p.displaceY, set: (p, v) => { p.displaceY = v; } },
      { label: 'Speed', key: 'sm_speed', min: 0, max: 5, step: 0.01, defaultVal: sDef.speed,
        get: p => p.speed, set: (p, v) => { p.speed = v; } },
    ];
    mainSliders.forEach(d => makeGenericSlider(content, d, spectralParams));

    // Brightness invert
    const biRow = document.createElement('div');
    biRow.className = 'ctrl-row';
    const biLbl = document.createElement('label');
    biLbl.textContent = 'Bright';
    biRow.appendChild(biLbl);
    makeToggleButton(biRow, 'Invert Bright', () => spectralParams.brightInvert, v => { spectralParams.brightInvert = v; });
    content.appendChild(biRow);

    // Z oscillator
    const zH = document.createElement('div');
    zH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    zH.textContent = 'Z Oscillator (Zoom)';
    content.appendChild(zH);

    const zSliders: GenericSliderDef<SpectralMeshParams>[] = [
      { label: 'Z Freq', key: 'sm_zf', min: 0, max: 20, step: 0.1, defaultVal: sDef.zFreq,
        get: p => p.zFreq, set: (p, v) => { p.zFreq = v; } },
      { label: 'Z Amp', key: 'sm_za', min: 0, max: 2, step: 0.01, defaultVal: sDef.zAmp,
        get: p => p.zAmp, set: (p, v) => { p.zAmp = v; } },
      { label: 'Z Shape', key: 'sm_zs', min: 0, max: 2, step: 1, defaultVal: sDef.zShape,
        get: p => p.zShape, set: (p, v) => { p.zShape = Math.round(v); } },
    ];
    zSliders.forEach(d => makeGenericSlider(content, d, spectralParams));

    // X oscillator
    const xH = document.createElement('div');
    xH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    xH.textContent = 'X Oscillator';
    content.appendChild(xH);

    const xSliders: GenericSliderDef<SpectralMeshParams>[] = [
      { label: 'X Freq', key: 'sm_xf', min: 0, max: 20, step: 0.1, defaultVal: sDef.xFreq,
        get: p => p.xFreq, set: (p, v) => { p.xFreq = v; } },
      { label: 'X Amp', key: 'sm_xa', min: 0, max: 2, step: 0.01, defaultVal: sDef.xAmp,
        get: p => p.xAmp, set: (p, v) => { p.xAmp = v; } },
      { label: 'X Shape', key: 'sm_xs', min: 0, max: 2, step: 1, defaultVal: sDef.xShape,
        get: p => p.xShape, set: (p, v) => { p.xShape = Math.round(v); } },
    ];
    xSliders.forEach(d => makeGenericSlider(content, d, spectralParams));

    // Y oscillator
    const yH = document.createElement('div');
    yH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    yH.textContent = 'Y Oscillator';
    content.appendChild(yH);

    const ySliders: GenericSliderDef<SpectralMeshParams>[] = [
      { label: 'Y Freq', key: 'sm_yf', min: 0, max: 20, step: 0.1, defaultVal: sDef.yFreq,
        get: p => p.yFreq, set: (p, v) => { p.yFreq = v; } },
      { label: 'Y Amp', key: 'sm_ya', min: 0, max: 2, step: 0.01, defaultVal: sDef.yAmp,
        get: p => p.yAmp, set: (p, v) => { p.yAmp = v; } },
      { label: 'Y Shape', key: 'sm_ys', min: 0, max: 2, step: 1, defaultVal: sDef.yShape,
        get: p => p.yShape, set: (p, v) => { p.yShape = Math.round(v); } },
    ];
    ySliders.forEach(d => makeGenericSlider(content, d, spectralParams));

    // Cross-modulation toggles
    const modH = document.createElement('div');
    modH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    modH.textContent = 'Cross-Modulation';
    content.appendChild(modH);

    const modRow = document.createElement('div');
    modRow.className = 'ctrl-row';
    modRow.style.flexWrap = 'wrap';
    makeToggleButton(modRow, 'Z Phase', () => spectralParams.zPhaseMod, v => { spectralParams.zPhaseMod = v; });
    makeToggleButton(modRow, 'X Phase', () => spectralParams.xPhaseMod, v => { spectralParams.xPhaseMod = v; });
    makeToggleButton(modRow, 'Y Phase', () => spectralParams.yPhaseMod, v => { spectralParams.yPhaseMod = v; });
    makeToggleButton(modRow, 'Z Ring', () => spectralParams.zRingMod, v => { spectralParams.zRingMod = v; });
    makeToggleButton(modRow, 'X Ring', () => spectralParams.xRingMod, v => { spectralParams.xRingMod = v; });
    makeToggleButton(modRow, 'Y Ring', () => spectralParams.yRingMod, v => { spectralParams.yRingMod = v; });
    content.appendChild(modRow);

    // Fragment controls
    const fragH = document.createElement('div');
    fragH.style.cssText = 'color:#888;font-size:10px;margin:6px 0 2px;';
    fragH.textContent = 'Fragment';
    content.appendChild(fragH);

    const fragSliders: GenericSliderDef<SpectralMeshParams>[] = [
      { label: 'Luma Key', key: 'sm_lk', min: 0, max: 1, step: 0.01, defaultVal: sDef.lumaKey,
        get: p => p.lumaKey, set: (p, v) => { p.lumaKey = v; } },
      { label: 'Luma Mode', key: 'sm_lm', min: 0, max: 1, step: 1, defaultVal: sDef.lumaMode,
        get: p => p.lumaMode, set: (p, v) => { p.lumaMode = Math.round(v); } },
      { label: 'B&W', key: 'sm_bw', min: 0, max: 1, step: 0.01, defaultVal: sDef.bw,
        get: p => p.bw, set: (p, v) => { p.bw = v; } },
      { label: 'Invert', key: 'sm_inv', min: 0, max: 1, step: 0.01, defaultVal: sDef.invert,
        get: p => p.invert, set: (p, v) => { p.invert = v; } },
    ];
    fragSliders.forEach(d => makeGenericSlider(content, d, spectralParams));

    s.appendChild(content);
    container.appendChild(s);
  }

  // --- Keyboard shortcuts ---
  {
    const s = document.createElement('div');
    s.className = 'section';
    const title = document.createElement('h3');
    title.textContent = 'KEYBOARD';
    title.style.cursor = 'pointer';
    const content = document.createElement('div');
    content.style.display = 'none';
    title.addEventListener('click', () => {
      content.style.display = content.style.display === 'none' ? '' : 'none';
    });
    content.innerHTML = `
      <div style="color:#666;font-size:9px;line-height:1.4">
      <b>FB0:</b> A/Z rot | F/V x | G/B y | H/N zoom | [/] blend<br>
      <b>FB1:</b> J/M rot | K/, x | L/. y<br>
      <b>Ch1:</b> T/Y hue | U/I sat | O/P bright<br>
      <b>FX:</b> Q/W blur | E/R sharpen<br>
      <b>1</b> clear FBs | <b>3</b> reset transforms
      </div>
    `;
    s.append(title, content);
    container.appendChild(s);
  }
}
