import type { RenderParams, FeedbackParams } from './renderer';
import { DEFAULT_PIPELINE } from './renderer';
import type { PhosphormParams } from './phosphorm';
import type { SpectralMeshParams } from './spectral-mesh';

export interface Preset {
  id: string;
  name: string;
  persist: boolean;
  data: {
    render: RenderParams;
    phosphorm: PhosphormParams;
    spectral: SpectralMeshParams;
  };
}

const STORAGE_KEY = 'skatlogs-presets';

function cloneFB(fb: FeedbackParams): FeedbackParams {
  return {
    ...fb,
    hsb: [...fb.hsb] as [number, number, number],
    huex: [...fb.huex] as [number, number, number],
    translate: [...fb.translate] as [number, number, number],
    invert: [...fb.invert] as [number, number, number],
  };
}

function cloneRenderParams(p: RenderParams): RenderParams {
  return {
    channel1: { ...p.channel1 },
    fb: [cloneFB(p.fb[0]), cloneFB(p.fb[1]), cloneFB(p.fb[2]), cloneFB(p.fb[3])],
    blur: { ...p.blur },
    sharpen: { ...p.sharpen },
    pipeline: [...p.pipeline],
    customShaders: p.customShaders.map(cs => ({ ...cs })),
  };
}

function clonePhosphormParams(p: PhosphormParams): PhosphormParams {
  return {
    oscL1: { ...p.oscL1 },
    oscR1: { ...p.oscR1 },
    oscL2: { ...p.oscL2 },
    oscR2: { ...p.oscR2 },
    decay: p.decay,
    lineColor: [...p.lineColor] as [number, number, number],
    useAudioInput: p.useAudioInput,
    audioReactivity: p.audioReactivity,
    scopeDisplay: p.scopeDisplay,
  };
}

function cloneSpectralParams(p: SpectralMeshParams): SpectralMeshParams {
  return { ...p };
}

export class PresetManager {
  private presets: Preset[] = [];
  private nextIndex = 1;

  constructor() {
    this.loadFromStorage();
  }

  save(
    name: string | null,
    persist: boolean,
    render: RenderParams,
    phosphorm: PhosphormParams,
    spectral: SpectralMeshParams,
  ): Preset {
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: name || `Preset ${this.nextIndex}`,
      persist,
      data: {
        render: cloneRenderParams(render),
        phosphorm: clonePhosphormParams(phosphorm),
        spectral: cloneSpectralParams(spectral),
      },
    };
    this.nextIndex++;
    this.presets.push(preset);
    if (persist) this.saveToStorage();
    return preset;
  }

  load(
    presetId: string,
    targetRender: RenderParams,
    targetPhosphorm: PhosphormParams,
    targetSpectral: SpectralMeshParams,
  ): boolean {
    const preset = this.presets.find(p => p.id === presetId);
    if (!preset) return false;

    const src = preset.data;

    // Mutate in place to preserve UI closures
    Object.assign(targetRender.channel1, src.render.channel1);
    for (let i = 0; i < 4; i++) {
      const fb = cloneFB(src.render.fb[i]);
      Object.assign(targetRender.fb[i], fb);
    }
    Object.assign(targetRender.blur, src.render.blur);
    Object.assign(targetRender.sharpen, src.render.sharpen);
    targetRender.pipeline = [...src.render.pipeline];
    targetRender.customShaders = src.render.customShaders.map(cs => ({ ...cs }));

    // Phosphorm
    const oscNames = ['oscL1', 'oscR1', 'oscL2', 'oscR2'] as const;
    for (const name of oscNames) {
      Object.assign(targetPhosphorm[name], src.phosphorm[name]);
    }
    targetPhosphorm.decay = src.phosphorm.decay;
    targetPhosphorm.lineColor = [...src.phosphorm.lineColor] as [number, number, number];
    targetPhosphorm.useAudioInput = src.phosphorm.useAudioInput;
    targetPhosphorm.audioReactivity = src.phosphorm.audioReactivity;

    // Spectral
    Object.assign(targetSpectral, src.spectral);

    return true;
  }

  delete(presetId: string) {
    this.presets = this.presets.filter(p => p.id !== presetId);
    this.saveToStorage();
  }

  getAll(): Preset[] {
    return this.presets;
  }

  private loadFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as { presets: Preset[]; nextIndex: number };
      this.presets = stored.presets || [];
      this.nextIndex = stored.nextIndex || this.presets.length + 1;
      // Backfill customShaders for presets saved before this field existed
      for (const p of this.presets) {
        if (!p.data.render.customShaders) {
          p.data.render.customShaders = [];
        }
        if (!p.data.render.pipeline) {
          p.data.render.pipeline = [...DEFAULT_PIPELINE];
        }
      }
    } catch {
      // ignore corrupt storage
    }
  }

  private saveToStorage() {
    const persistent = this.presets.filter(p => p.persist);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      presets: persistent,
      nextIndex: this.nextIndex,
    }));
  }
}
