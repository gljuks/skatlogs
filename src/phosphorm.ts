/**
 * Phosphorm: Audio-reactive oscilloscope input source.
 * Generates Lissajous patterns from audio input (mic) or internal synthesis.
 * Uses phosphor decay (blur + fade) for persistence trails.
 */

import { createProgram, createFBO, resizeFBO } from './gl-utils';
import vertSrc from './shaders/fullscreen.vert.glsl?raw';

const PHOSPHOR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform float u_decay;

void main() {
    float x = 0.002;
    float y = 0.003;
    vec4 color = texture(u_tex, vUv)
               + texture(u_tex, vUv + vec2(x, y))
               + texture(u_tex, vUv + vec2(x, -y))
               + texture(u_tex, vUv + vec2(-x, y))
               + texture(u_tex, vUv + vec2(-x, -y));
    color.rgb *= u_decay;
    if (color.r < 0.008) color = vec4(0.0);
    fragColor = color;
}
`;

const DRAW_LINE_VERT = `#version 300 es
precision highp float;
in vec2 a_position;
uniform vec2 u_resolution;
void main() {
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const DRAW_LINE_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec3 u_color;
void main() {
    fragColor = vec4(u_color, 1.0);
}
`;

const SCOPE_DISPLAY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;

void main() {
    // Barrel distortion for CRT curvature
    vec2 c = vUv - 0.5;
    float r2 = dot(c, c);
    vec2 duv = c * (1.0 + 0.3 * r2) + 0.5;

    if (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Convert to monochrome intensity
    float raw = dot(texture(u_tex, duv).rgb, vec3(0.33));

    // Phosphor glow (soft bloom)
    vec2 px = 1.0 / u_resolution;
    float glow = 0.0;
    for (float i = -2.0; i <= 2.0; i += 1.0) {
        for (float j = -2.0; j <= 2.0; j += 1.0) {
            glow += dot(texture(u_tex, duv + vec2(i, j) * px * 2.0).rgb, vec3(0.33));
        }
    }
    glow /= 25.0;
    float intensity = raw + glow * 0.6;

    // Scanlines
    float scan = 0.7 + 0.3 * sin(duv.y * u_resolution.y * 3.14159);
    intensity *= scan;

    // Vignette
    float vig = 1.0 - dot(c, c) * 2.0;
    intensity *= max(vig, 0.0);

    // P1 phosphor green: bright green with warm falloff into darker tones
    vec3 color = vec3(intensity * 0.15, intensity * 1.0, intensity * 0.3)
               + vec3(0.0, pow(intensity, 0.5) * 0.15, 0.0);

    fragColor = vec4(color, 1.0);
}
`;

export interface PhosphoOsc {
  freq: number;
  amp: number;
  shape: number; // 0=sine, 1=saw, 2=triangle
  phaseModAmp: number;
  ampModFreq: number;
  ampModAmp: number;
}

export interface PhosphormParams {
  oscL1: PhosphoOsc;
  oscR1: PhosphoOsc;
  oscL2: PhosphoOsc;
  oscR2: PhosphoOsc;
  decay: number;      // 0-1, phosphor persistence (0.18 = original)
  lineColor: [number, number, number];
  useAudioInput: boolean;
  audioReactivity: number; // how much audio modulates oscillators
  scopeDisplay: boolean;   // enable oscilloscope CRT display emulation
}

export function defaultPhosphormParams(): PhosphormParams {
  return {
    oscL1: { freq: 3.0, amp: 0.8, shape: 0, phaseModAmp: 0, ampModFreq: 0, ampModAmp: 0 },
    oscR1: { freq: 2.0, amp: 0.8, shape: 0, phaseModAmp: 0, ampModFreq: 0, ampModAmp: 0 },
    oscL2: { freq: 0, amp: 0, shape: 0, phaseModAmp: 0, ampModFreq: 0, ampModAmp: 0 },
    oscR2: { freq: 0, amp: 0, shape: 0, phaseModAmp: 0, ampModFreq: 0, ampModAmp: 0 },
    decay: 0.18,
    lineColor: [0.2, 1.0, 0.4],
    useAudioInput: false,
    audioReactivity: 0.5,
    scopeDisplay: true,
  };
}

function oscValue(osc: PhosphoOsc, theta: number, ampMod: number): number {
  const phase = theta * osc.freq + osc.phaseModAmp * Math.sin(theta * 1.7);
  const am = 1.0 + osc.ampModAmp * Math.sin(theta * osc.ampModFreq);
  let v = 0;
  switch (osc.shape) {
    case 0: v = Math.sin(phase); break;
    case 1: v = ((phase / Math.PI) % 2 + 2) % 2 - 1; break; // saw
    case 2: v = Math.abs(((phase / Math.PI) % 2 + 2) % 2 - 1) * 2 - 1; break; // tri
  }
  return v * osc.amp * am * (1 + ampMod);
}

export class Phosphorm {
  private gl: WebGL2RenderingContext;
  private width: number;
  private height: number;

  private phosphorProg: WebGLProgram;
  private lineProg: WebGLProgram;
  private scopeProg: WebGLProgram;
  private fsVao: WebGLVertexArrayObject;

  private fbo0: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private fbo1: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private scopeFbo: { fbo: WebGLFramebuffer; tex: WebGLTexture };

  private lineVao: WebGLVertexArrayObject;
  private lineBuffer: WebGLBuffer;
  private lineData: Float32Array;

  private theta = 0;
  private readonly SAMPLES = 2048;

  // Audio analysis
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private audioData: Float32Array<ArrayBuffer> | null = null;
  private audioStream: MediaStream | null = null;

  // Cached uniform locations
  private phosphorDecayLoc: WebGLUniformLocation | null;
  private phosphorTexLoc: WebGLUniformLocation | null;
  private lineColorLoc: WebGLUniformLocation | null;
  private scopeTexLoc: WebGLUniformLocation | null;
  private scopeResLoc: WebGLUniformLocation | null;

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;

    this.phosphorProg = createProgram(gl, vertSrc, PHOSPHOR_FRAG);
    this.lineProg = createProgram(gl, DRAW_LINE_VERT, DRAW_LINE_FRAG);
    this.scopeProg = createProgram(gl, vertSrc, SCOPE_DISPLAY_FRAG);

    this.phosphorDecayLoc = gl.getUniformLocation(this.phosphorProg, 'u_decay');
    this.phosphorTexLoc = gl.getUniformLocation(this.phosphorProg, 'u_tex');
    this.lineColorLoc = gl.getUniformLocation(this.lineProg, 'u_color');
    this.scopeTexLoc = gl.getUniformLocation(this.scopeProg, 'u_tex');
    this.scopeResLoc = gl.getUniformLocation(this.scopeProg, 'u_resolution');

    this.fbo0 = createFBO(gl, width, height);
    this.fbo1 = createFBO(gl, width, height);
    this.scopeFbo = createFBO(gl, width, height);

    this.fsVao = gl.createVertexArray()!;

    // Line buffer
    this.lineData = new Float32Array(this.SAMPLES * 2);
    this.lineBuffer = gl.createBuffer()!;
    this.lineVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.lineData.byteLength, gl.DYNAMIC_DRAW);
    const posLoc = gl.getAttribLocation(this.lineProg, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }

  /** Start audio from mic */
  async startMicInput() {
    this.stopAudioInput();
    try {
      this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.connectAnalyser(this.audioStream);
    } catch (e) {
      console.warn('Mic audio failed:', e);
    }
  }

  /** Start audio from a browser tab via getDisplayMedia */
  async startTabAudio() {
    this.stopAudioInput();
    try {
      // Request tab share with audio - we only care about the audio track
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,  // required by spec, but we discard it
        audio: true,
      });
      // Stop the video track immediately - we only want audio
      for (const vt of stream.getVideoTracks()) vt.stop();

      if (stream.getAudioTracks().length === 0) {
        console.warn('No audio track - did you check "Share tab audio"?');
        return;
      }
      this.audioStream = stream;
      this.connectAnalyser(stream);
    } catch (e) {
      console.warn('Tab audio failed:', e);
    }
  }

  private connectAnalyser(stream: MediaStream) {
    this.audioCtx = new AudioContext();
    const source = this.audioCtx.createMediaStreamSource(stream);
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 2048;
    source.connect(this.analyser);
    this.audioData = new Float32Array(this.analyser.fftSize);
  }

  stopAudioInput() {
    if (this.audioStream) {
      this.audioStream.getTracks().forEach(t => t.stop());
      this.audioStream = null;
    }
    if (this.audioCtx) {
      this.audioCtx.close();
      this.audioCtx = null;
    }
    this.analyser = null;
    this.audioData = null;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    resizeFBO(this.gl, this.fbo0, width, height);
    resizeFBO(this.gl, this.fbo1, width, height);
    resizeFBO(this.gl, this.scopeFbo, width, height);
  }

  /** Render phosphorm to a texture and return it */
  render(params: PhosphormParams): WebGLTexture {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;

    // Get audio amplitude for modulation
    let audioAmp = 0;
    if (params.useAudioInput && this.analyser && this.audioData) {
      this.analyser.getFloatTimeDomainData(this.audioData);
      let rms = 0;
      for (let i = 0; i < this.audioData.length; i++) {
        rms += this.audioData[i] * this.audioData[i];
      }
      audioAmp = Math.sqrt(rms / this.audioData.length) * params.audioReactivity * 4;
    }

    // Generate Lissajous points
    const speed = 0.02;
    this.theta += speed;
    for (let i = 0; i < this.SAMPLES; i++) {
      const t = this.theta + (i / this.SAMPLES) * Math.PI * 8;
      const x = oscValue(params.oscL1, t, audioAmp) + oscValue(params.oscL2, t * 1.01, audioAmp * 0.5);
      const y = oscValue(params.oscR1, t, audioAmp) + oscValue(params.oscR2, t * 1.01, audioAmp * 0.5);
      this.lineData[i * 2] = Math.max(-1, Math.min(1, x));
      this.lineData[i * 2 + 1] = Math.max(-1, Math.min(1, y));
    }

    // Upload line data
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lineData);

    // Step 1: Apply phosphor decay to previous frame (fbo1 → fbo0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo0.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.phosphorProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo1.tex);
    gl.uniform1i(this.phosphorTexLoc, 0);
    gl.uniform1f(this.phosphorDecayLoc, params.decay);
    gl.bindVertexArray(this.fsVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Step 2: Draw new waveform on top
    gl.useProgram(this.lineProg);
    gl.uniform3fv(this.lineColorLoc, params.lineColor);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // Additive
    gl.bindVertexArray(this.lineVao);
    gl.drawArrays(gl.LINE_STRIP, 0, this.SAMPLES);
    gl.disable(gl.BLEND);

    // Step 3: Copy fbo0 → fbo1 for next frame
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo0.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo1.fbo);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);

    // Step 4: Oscilloscope display emulation
    if (params.scopeDisplay) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.scopeFbo.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.scopeProg);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fbo0.tex);
      gl.uniform1i(this.scopeTexLoc, 0);
      gl.uniform2f(this.scopeResLoc, w, h);
      gl.bindVertexArray(this.fsVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return this.scopeFbo.tex;
    }

    return this.fbo0.tex;
  }
}
