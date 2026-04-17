/**
 * Audio Reactor: FFT-based audio analysis that modulates feedback buffer parameters.
 * Splits audio into 3 bands (low/mid/high) and applies smoothed modulation
 * to FB displacement, rotation, zoom, and color parameters.
 */

import type { RenderParams } from './renderer';
import type { SpectralMeshParams } from './spectral-mesh';

export interface AudioReactorParams {
  enabled: boolean;
  /** Per-band amount for each modulatable param (low, mid, high) */
  lowAmt: number;   // 0-1, how much low band affects params
  midAmt: number;
  highAmt: number;
  smoothing: number; // 0.5-0.99, exponential smoothing
  /** Which FB index to modulate (0-3) */
  targetFB: number;
  /** Which FB params to modulate */
  modRotate: boolean;
  modZoom: boolean;
  modX: boolean;
  modY: boolean;
  modHue: boolean;
  /** Spectral mesh modulation */
  meshDisplaceX: boolean;
  meshDisplaceY: boolean;
  meshZAmp: boolean;
  meshXAmp: boolean;
  meshYAmp: boolean;
  meshLumaKey: boolean;
}

export function defaultAudioReactorParams(): AudioReactorParams {
  return {
    enabled: false,
    lowAmt: 0.5,
    midAmt: 0.3,
    highAmt: 0.2,
    smoothing: 0.85,
    targetFB: 0,
    modRotate: true,
    modZoom: true,
    modX: false,
    modY: false,
    modHue: false,
    meshDisplaceX: false,
    meshDisplaceY: false,
    meshZAmp: true,
    meshXAmp: false,
    meshYAmp: false,
    meshLumaKey: false,
  };
}

export class AudioReactor {
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private freqData: Uint8Array<ArrayBuffer> | null = null;
  private stream: MediaStream | null = null;

  // Smoothed band values (0-1)
  lowSmoothed = 0;
  midSmoothed = 0;
  highSmoothed = 0;

  async startMic() {
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.connect(this.stream);
    } catch (e) {
      console.warn('AudioReactor mic failed:', e);
    }
  }

  async startTabAudio() {
    this.stop();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      for (const vt of stream.getVideoTracks()) vt.stop();
      if (stream.getAudioTracks().length === 0) {
        console.warn('No audio track');
        return;
      }
      this.stream = stream;
      this.connect(stream);
    } catch (e) {
      console.warn('AudioReactor tab audio failed:', e);
    }
  }

  private connect(stream: MediaStream) {
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.3;
    source.connect(this.analyser);
    this.freqData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.analyser = null;
    this.freqData = null;
    this.lowSmoothed = 0;
    this.midSmoothed = 0;
    this.highSmoothed = 0;
  }

  get active(): boolean {
    return this.analyser !== null;
  }

  /** Analyze FFT bands. Call once per frame before tick/tickSpectral. */
  analyze(arParams: AudioReactorParams) {
    if (!arParams.enabled || !this.analyser || !this.freqData) return;

    this.analyser.getByteFrequencyData(this.freqData);
    const bins = this.freqData.length; // typically 512

    // Split into 3 bands
    const lowEnd = Math.floor(bins * 0.1);   // ~0-50Hz region
    const midEnd = Math.floor(bins * 0.4);   // ~50-200Hz region

    let lowSum = 0, midSum = 0, highSum = 0;
    for (let i = 0; i < lowEnd; i++) lowSum += this.freqData[i];
    for (let i = lowEnd; i < midEnd; i++) midSum += this.freqData[i];
    for (let i = midEnd; i < bins; i++) highSum += this.freqData[i];

    const lowRaw = lowSum / (lowEnd * 255);
    const midRaw = midSum / ((midEnd - lowEnd) * 255);
    const highRaw = highSum / ((bins - midEnd) * 255);

    // Exponential smoothing
    const s = arParams.smoothing;
    this.lowSmoothed = s * this.lowSmoothed + (1 - s) * lowRaw;
    this.midSmoothed = s * this.midSmoothed + (1 - s) * midRaw;
    this.highSmoothed = s * this.highSmoothed + (1 - s) * highRaw;
  }

  /** Combined modulation amount from all bands */
  private mod(arParams: AudioReactorParams): number {
    return this.lowSmoothed * arParams.lowAmt
         + this.midSmoothed * arParams.midAmt
         + this.highSmoothed * arParams.highAmt;
  }

  /** Modulate feedback buffer params. Call after analyze(). */
  tick(params: RenderParams, arParams: AudioReactorParams) {
    if (!arParams.enabled || !this.active) return;
    const mod = this.mod(arParams);

    const fb = params.fb[arParams.targetFB];
    if (!fb) return;

    if (arParams.modRotate) fb.rotate += mod * 0.002;
    if (arParams.modZoom) fb.translate[2] += mod * 0.005;
    if (arParams.modX) fb.translate[0] += (mod - 0.15) * 0.003;
    if (arParams.modY) fb.translate[1] += (mod - 0.15) * 0.003;
    if (arParams.modHue) fb.hsb[0] += mod * 0.01;
  }

  /** Modulate spectral mesh params. Call after analyze(). */
  tickSpectral(sp: SpectralMeshParams, arParams: AudioReactorParams) {
    if (!arParams.enabled || !this.active) return;

    // Use individual bands for different axes (like auto_mesh)
    const low = this.lowSmoothed * arParams.lowAmt;
    const mid = this.midSmoothed * arParams.midAmt;
    const high = this.highSmoothed * arParams.highAmt;

    if (arParams.meshDisplaceX) sp.displaceX += (low + mid) * 0.15;
    if (arParams.meshDisplaceY) sp.displaceY += (mid + high) * 0.15;
    if (arParams.meshZAmp) sp.zAmp += low * 0.3;
    if (arParams.meshXAmp) sp.xAmp += mid * 0.2;
    if (arParams.meshYAmp) sp.yAmp += high * 0.2;
    if (arParams.meshLumaKey) sp.lumaKey = Math.min(1, sp.lumaKey + (low + mid + high) * 0.1);
  }
}
