import { Renderer, defaultParams } from './renderer';
import { InputManager } from './input-sources';
import { buildUI, syncSliders, tickSliderSmooth, tickSliderInputSmooth } from './ui';
import { tickSmooth, isSmoothActive } from './reset';
import { initKeyboard, tickKeyboard, isKeyboardActive } from './keyboard';
import { initMIDI } from './midi';
import { Phosphorm, defaultPhosphormParams } from './phosphorm';
import { SpectralMesh, defaultSpectralParams } from './spectral-mesh';
import { PresetManager } from './preset-manager';
import { AudioReactor, defaultAudioReactorParams } from './audio-reactor';
import { showSplash } from './splash';

async function main() {
  const canvas = document.getElementById('gl-canvas') as HTMLCanvasElement;
  const controlsEl = document.getElementById('controls')!;
  const fpsEl = document.getElementById('fps')!;

  let renderer: Renderer;
  try {
    renderer = new Renderer(canvas, 1280, 720);
  } catch (e) {
    console.error('Renderer init failed:', e);
    fpsEl.textContent = 'SHADER ERROR - check console';
    fpsEl.style.color = 'red';
    return;
  }

  const input = new InputManager();
  const params = defaultParams();
  const phosphormParams = defaultPhosphormParams();
  const spectralParams = defaultSpectralParams();

  const phosphorm = new Phosphorm(renderer.gl, 1280, 720);
  const spectralMesh = new SpectralMesh(renderer.gl, 1280, 720);

  const presetManager = new PresetManager();
  const audioReactor = new AudioReactor();
  const audioReactorParams = defaultAudioReactorParams();

  let inputMode: 'camera' | 'screen' | 'phosphorm' | 'test' | 'none' = 'none';

  buildUI(controlsEl, params, phosphormParams, spectralParams, {
    renderer,
    presetManager,
    audioReactor,
    audioReactorParams,
    onCameraSelect: async () => {
      try {
        await input.startCamera();
        renderer.useTestPattern = false;
        inputMode = 'camera';
      } catch (e) {
        console.error('Camera error:', e);
        alert('Could not access camera.');
      }
    },
    onScreenCapture: async () => {
      try {
        await input.startScreenCapture();
        renderer.useTestPattern = false;
        inputMode = 'screen';
      } catch (e) {
        console.error('Screen capture error:', e);
      }
    },
    onPhosphorm: async () => {
      input.stop();
      renderer.useTestPattern = false;
      inputMode = 'phosphorm';
    },
    onAudioTab: async () => {
      await phosphorm.startTabAudio();
    },
    onAudioMic: async () => {
      await phosphorm.startMicInput();
    },
    onAudioOff: () => {
      phosphorm.stopAudioInput();
    },
    onClear: () => renderer.clearAll(),
    onResize: (w: number, h: number) => {
      renderer.resize(w, h);
      phosphorm.resize(w, h);
      spectralMesh.resize(w, h);
    },
    onTestPattern: () => {
      renderer.useTestPattern = !renderer.useTestPattern;
      inputMode = renderer.useTestPattern ? 'test' : inputMode;
    },
  });

  initKeyboard(params, () => renderer.clearAll());

  // Show splash immediately (before MIDI await), start render loop on dismiss
  let frameCount = 0;
  let lastTime = performance.now();
  let syncCounter = 0;

  function loop() {
    if (inputMode === 'phosphorm') {
      const phosphorTex = phosphorm.render(phosphormParams);
      renderer.setInputFromTexture(phosphorTex);
    } else if (input.ready) {
      input.uploadToTexture(renderer.gl, renderer.inputTex);
    }

    tickKeyboard(params);
    tickSliderInputSmooth(params);
    audioReactor.analyze(audioReactorParams);
    audioReactor.tick(params, audioReactorParams);
    audioReactor.tickSpectral(spectralParams, audioReactorParams);

    const fbSmooth = isSmoothActive();
    const sliderSmooth = tickSliderSmooth(params);
    if (fbSmooth) tickSmooth(params);
    if (fbSmooth || sliderSmooth || isKeyboardActive()) {
      if (++syncCounter % 3 === 0) syncSliders(params);
    }

    renderer.render(params, spectralMesh, spectralParams);

    frameCount++;
    const now = performance.now();
    if (now - lastTime >= 1000) {
      fpsEl.textContent = `${frameCount} fps`;
      frameCount = 0;
      lastTime = now;
    }

    requestAnimationFrame(loop);
  }

  showSplash(() => requestAnimationFrame(loop));

  // MIDI init runs in background while splash is showing
  const midiStatusEl = document.getElementById('midi-status');
  try {
    const inputs = await initMIDI(params, () => syncSliders(params));
    if (midiStatusEl) {
      midiStatusEl.textContent = inputs.length > 0
        ? `MIDI: ${inputs.join(', ')}`
        : 'MIDI: no devices (plug in and reload)';
      if (inputs.length > 0) midiStatusEl.style.color = '#0a0';
    }
  } catch {
    if (midiStatusEl) midiStatusEl.textContent = 'MIDI: not supported';
  }
}

main();
