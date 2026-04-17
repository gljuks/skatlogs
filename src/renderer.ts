import { createProgram, createFBO, resizeFBO } from './gl-utils';
import vertSrc from './shaders/fullscreen.vert.glsl?raw';
import mixerFragSrc from './shaders/mixer.frag.glsl?raw';
import blurFragSrc from './shaders/blur.frag.glsl?raw';
import sharpenFragSrc from './shaders/sharpen.frag.glsl?raw';
import passthroughFragSrc from './shaders/passthrough.frag.glsl?raw';
import testpatternFragSrc from './shaders/testpattern.frag.glsl?raw';
import type { SpectralMesh, SpectralMeshParams } from './spectral-mesh';

const MAX_DELAY = 30;

export type PipelineStage = 'spectral' | 'mixer' | 'blur' | 'sharpen' | string;
export const DEFAULT_PIPELINE: PipelineStage[] = ['spectral', 'mixer', 'blur', 'sharpen'];

export interface CustomShaderDef {
  id: string;
  name: string;
  source: string;
}

export const CRT_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_time;

vec2 barrel(vec2 uv, float amt) {
    vec2 c = uv - 0.5;
    float r2 = dot(c, c);
    return c * (1.0 + amt * r2) + 0.5;
}

void main() {
    // Barrel distortion
    vec2 duv = barrel(vUv, 0.4);

    // Out of bounds = black
    if (duv.x < 0.0 || duv.x > 1.0 || duv.y < 0.0 || duv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Chromatic aberration
    float aberr = 0.003;
    float r = texture(u_tex, barrel(vUv, 0.4 + aberr)).r;
    float g = texture(u_tex, duv).g;
    float b = texture(u_tex, barrel(vUv, 0.4 - aberr)).b;
    vec3 color = vec3(r, g, b);

    // Phosphor glow (simple cross blur)
    vec2 px = 1.0 / u_resolution;
    vec3 glow = vec3(0.0);
    glow += texture(u_tex, duv + vec2(px.x * 2.0, 0.0)).rgb;
    glow += texture(u_tex, duv - vec2(px.x * 2.0, 0.0)).rgb;
    glow += texture(u_tex, duv + vec2(0.0, px.y * 2.0)).rgb;
    glow += texture(u_tex, duv - vec2(0.0, px.y * 2.0)).rgb;
    color += glow * 0.06;

    // Scanlines
    float scanline = sin(duv.y * u_resolution.y * 3.14159) * 0.5 + 0.5;
    color *= 0.7 + 0.3 * scanline;

    // Phosphor mask (RGB subpixels)
    float mask = mod(gl_FragCoord.x, 3.0);
    if (mask < 1.0) color *= vec3(1.2, 0.9, 0.9);
    else if (mask < 2.0) color *= vec3(0.9, 1.2, 0.9);
    else color *= vec3(0.9, 0.9, 1.2);

    // Vignette
    vec2 vc = duv - 0.5;
    color *= 1.0 - dot(vc, vc) * 1.2;

    // Flicker
    color *= 0.97 + 0.03 * sin(u_time * 8.0);

    fragColor = vec4(color, 1.0);
}
`;

export const DEFAULT_CUSTOM_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
    fragColor = texture(u_tex, vUv);
}
`;

export interface FeedbackParams {
  blend: number;
  lumakey: number;
  lumathresh: number;
  hsb: [number, number, number];
  huex: [number, number, number];
  translate: [number, number, number];
  rotate: number;
  toroid: number;
  hflip: number;
  vflip: number;
  invert: [number, number, number];
  delay: number;
}

export interface ChannelParams {
  hue: number;
  sat: number;
  bright: number;
  satPowmap: number;
  brightPowmap: number;
  satWrap: number;
  brightWrap: number;
  hueInvert: number;
  satInvert: number;
  brightInvert: number;
}

export interface RenderParams {
  channel1: ChannelParams;
  fb: [FeedbackParams, FeedbackParams, FeedbackParams, FeedbackParams];
  blur: { amount: number; radius: number };
  sharpen: { amount: number; boost: number; radius: number };
  pipeline: PipelineStage[];
  customShaders: CustomShaderDef[];
}

export function defaultFeedbackParams(index: number): FeedbackParams {
  return {
    blend: index === 0 ? 0.5 : 0.0,
    lumakey: 0.5,
    lumathresh: 0.0,
    hsb: [1.0, 1.0, 1.0],
    huex: [1.0, 0.0, 0.0],
    translate: [0.0, 0.0, 1.0],
    rotate: 0.0,
    toroid: 1,
    hflip: 0,
    vflip: 0,
    invert: [0, 0, 0],
    delay: 1,
  };
}

export function defaultParams(): RenderParams {
  return {
    channel1: {
      hue: 1.0, sat: 1.0, bright: 1.0,
      satPowmap: 1.0, brightPowmap: 1.0,
      satWrap: 0, brightWrap: 0,
      hueInvert: 0, satInvert: 0, brightInvert: 0,
    },
    fb: [
      defaultFeedbackParams(0),
      defaultFeedbackParams(1),
      defaultFeedbackParams(2),
      defaultFeedbackParams(3),
    ],
    blur: { amount: 0.0, radius: 2.0 },
    sharpen: { amount: 0.0, boost: 0.0, radius: 2.0 },
    pipeline: [...DEFAULT_PIPELINE],
    customShaders: [],
  };
}

/** Cache uniform locations at init to avoid per-frame lookups */
type UniformCache = Map<string, WebGLUniformLocation | null>;

function cacheUniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, names: string[]): UniformCache {
  const cache: UniformCache = new Map();
  for (const name of names) {
    cache.set(name, gl.getUniformLocation(prog, name));
  }
  return cache;
}

function tryCreateProgram(gl: WebGL2RenderingContext, name: string, vert: string, frag: string): WebGLProgram {
  console.log(`Compiling ${name}...`);
  const prog = createProgram(gl, vert, frag);
  console.log(`  ${name} OK`);
  return prog;
}

export class Renderer {
  gl: WebGL2RenderingContext;
  width: number;
  height: number;

  private mixerProg: WebGLProgram;
  private blurProg: WebGLProgram;
  private sharpenProg: WebGLProgram;
  private passthroughProg: WebGLProgram;
  private testPatternProg: WebGLProgram;

  // Cached uniform locations
  private mixerU: UniformCache;
  private blurU: UniformCache;
  private sharpenU: UniformCache;
  private passU: UniformCache;
  private testU: UniformCache;

  inputTex: WebGLTexture;

  private mixerFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private blurFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private sharpenFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture };
  private auxFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture };

  // Custom shader runtime state
  private customProgs = new Map<string, WebGLProgram>();
  private customUniforms = new Map<string, UniformCache>();
  private customFBOs = new Map<string, { fbo: WebGLFramebuffer; tex: WebGLTexture }>();
  private customErrors = new Map<string, string>();

  private pastFrames: { fbo: WebGLFramebuffer; tex: WebGLTexture }[];
  private frameCount = 0;
  private startTime = performance.now();

  private vao: WebGLVertexArrayObject;

  useTestPattern = false;

  constructor(canvas: HTMLCanvasElement, width = 1280, height = 720) {
    this.width = width;
    this.height = height;
    canvas.width = width;
    canvas.height = height;

    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;

    console.log('WebGL2:', gl.getParameter(gl.RENDERER));

    this.mixerProg = tryCreateProgram(gl, 'mixer', vertSrc, mixerFragSrc);
    this.blurProg = tryCreateProgram(gl, 'blur', vertSrc, blurFragSrc);
    this.sharpenProg = tryCreateProgram(gl, 'sharpen', vertSrc, sharpenFragSrc);
    this.passthroughProg = tryCreateProgram(gl, 'passthrough', vertSrc, passthroughFragSrc);
    this.testPatternProg = tryCreateProgram(gl, 'testpattern', vertSrc, testpatternFragSrc);

    // Cache all uniform locations
    const fbUniformNames: string[] = [];
    for (let i = 0; i < 4; i++) {
      const p = `u_fb${i}`;
      fbUniformNames.push(p);
      for (const s of ['_blend', '_lumakey', '_lumathresh', '_hsb', '_huex', '_translate', '_rotate', '_toroid', '_hflip', '_vflip', '_invert']) {
        fbUniformNames.push(p + s);
      }
    }
    this.mixerU = cacheUniforms(gl, this.mixerProg, [
      'u_input', 'u_resolution',
      'u_ch1_hue', 'u_ch1_sat', 'u_ch1_bright',
      'u_ch1_sat_powmap', 'u_ch1_bright_powmap',
      'u_ch1_sat_wrap', 'u_ch1_bright_wrap',
      'u_ch1_hue_invert', 'u_ch1_sat_invert', 'u_ch1_bright_invert',
      ...fbUniformNames,
    ]);
    this.blurU = cacheUniforms(gl, this.blurProg, ['u_tex', 'u_resolution', 'u_blur_amount', 'u_blur_radius']);
    this.sharpenU = cacheUniforms(gl, this.sharpenProg, ['u_tex', 'u_resolution', 'u_sharpen_amount', 'u_sharpen_boost', 'u_sharpen_radius']);
    this.passU = cacheUniforms(gl, this.passthroughProg, ['u_tex']);
    this.testU = cacheUniforms(gl, this.testPatternProg, ['u_time']);

    // Input texture
    this.inputTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.mixerFBO = createFBO(gl, width, height);
    this.blurFBO = createFBO(gl, width, height);
    this.sharpenFBO = createFBO(gl, width, height);
    this.auxFBO = createFBO(gl, width, height);

    this.pastFrames = [];
    for (let i = 0; i < MAX_DELAY; i++) {
      this.pastFrames.push(createFBO(gl, width, height));
    }

    this.vao = gl.createVertexArray()!;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
  }

  private draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }

  private bindTex(unit: number, tex: WebGLTexture) {
    this.gl.activeTexture(this.gl.TEXTURE0 + unit);
    this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
  }

  private u(cache: UniformCache, name: string): WebGLUniformLocation | null {
    return cache.get(name) ?? null;
  }

  private getDelayedFrame(delay: number): WebGLTexture {
    const idx = ((this.frameCount - delay) % MAX_DELAY + MAX_DELAY) % MAX_DELAY;
    return this.pastFrames[idx].tex;
  }

  private inputFbo: WebGLFramebuffer | null = null;

  /** Copy another texture's content into inputTex */
  setInputFromTexture(srcTex: WebGLTexture) {
    const gl = this.gl;
    // Re-allocate inputTex to renderer dimensions (screen capture may have resized it)
    gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    if (!this.inputFbo) {
      this.inputFbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.inputFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.inputTex, 0);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.inputFbo);
    }
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.passthroughProg);
    this.bindTex(0, srcTex);
    gl.uniform1i(this.u(this.passU, 'u_tex'), 0);
    this.draw();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(params: RenderParams, spectralMesh?: SpectralMesh, spectralParams?: SpectralMeshParams) {
    if (this.useTestPattern) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(this.testPatternProg);
      gl.uniform1f(this.u(this.testU, 'u_time'), (performance.now() - this.startTime) / 1000.0);
      this.draw();
      return;
    }

    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    const mu = this.mixerU;

    // --- Configurable pipeline ---
    // Feedback-producing stages (spectral, mixer, blur, sharpen) are stored to
    // the delay buffer. Custom shaders run after and are display-only — they
    // don't feed back, so effects like CRT barrel distortion won't accumulate.
    let currentTex: WebGLTexture = this.inputTex;
    let currentFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
    let feedbackFBO: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null;
    let feedbackStored = false;

    for (const stage of params.pipeline) {
      const isCustom = typeof stage === 'string' && stage.startsWith('custom_');

      // Before the first custom shader, snapshot into the delay buffer
      if (isCustom && !feedbackStored) {
        feedbackStored = true;
        if (!currentFBO) {
          currentFBO = this.auxFBO;
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.auxFBO.fbo);
          gl.viewport(0, 0, w, h);
          gl.useProgram(this.passthroughProg);
          this.bindTex(0, currentTex);
          gl.uniform1i(this.u(this.passU, 'u_tex'), 0);
          this.draw();
        }
        feedbackFBO = currentFBO;
        const storeIdx = this.frameCount % MAX_DELAY;
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, currentFBO.fbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pastFrames[storeIdx].fbo);
        gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      }

      switch (stage) {
        case 'spectral':
          if (spectralMesh && spectralParams && spectralParams.enabled) {
            currentTex = spectralMesh.render(currentTex, spectralParams);
            currentFBO = null; // spectral returns a raw texture, no FBO
          }
          break;

        case 'mixer':
          currentTex = this.runMixer(currentTex, params);
          currentFBO = this.mixerFBO;
          break;

        case 'blur':
          if (params.blur.amount > 0.001) {
            currentTex = this.runBlur(currentTex, params);
            currentFBO = this.blurFBO;
          }
          break;

        case 'sharpen':
          if (params.sharpen.amount > 0.001) {
            currentTex = this.runSharpen(currentTex, params);
            currentFBO = this.sharpenFBO;
          }
          break;

        default:
          if (isCustom) {
            const prog = this.customProgs.get(stage);
            const uniforms = this.customUniforms.get(stage);
            const fbo = this.customFBOs.get(stage);
            if (prog && uniforms && fbo) {
              currentTex = this.runCustomShader(currentTex, prog, uniforms, fbo);
              currentFBO = fbo;
            }
          }
          break;
      }
    }

    // If no custom shaders ran, store feedback from the last built-in stage
    if (!feedbackStored) {
      if (!currentFBO) {
        currentFBO = this.auxFBO;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.auxFBO.fbo);
        gl.viewport(0, 0, w, h);
        gl.useProgram(this.passthroughProg);
        this.bindTex(0, currentTex);
        gl.uniform1i(this.u(this.passU, 'u_tex'), 0);
        this.draw();
      }
      const storeIdx = this.frameCount % MAX_DELAY;
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, currentFBO.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.pastFrames[storeIdx].fbo);
      gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    }

    // --- Output to screen (from final pipeline stage, including custom shaders) ---
    if (!currentFBO) {
      currentFBO = this.auxFBO;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.auxFBO.fbo);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.passthroughProg);
      this.bindTex(0, currentTex);
      gl.uniform1i(this.u(this.passU, 'u_tex'), 0);
      this.draw();
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, currentFBO.fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.COLOR_BUFFER_BIT, gl.LINEAR);

    this.frameCount++;
  }

  private runMixer(inputTex: WebGLTexture, params: RenderParams): WebGLTexture {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    const mu = this.mixerU;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mixerFBO.fbo);
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.mixerProg);

    this.bindTex(0, inputTex);
    gl.uniform1i(this.u(mu, 'u_input'), 0);

    for (let i = 0; i < 4; i++) {
      const fb = params.fb[i];
      this.bindTex(1 + i, this.getDelayedFrame(Math.max(1, Math.round(fb.delay))));
      gl.uniform1i(this.u(mu, `u_fb${i}`), 1 + i);
    }

    gl.uniform2f(this.u(mu, 'u_resolution'), w, h);

    const ch1 = params.channel1;
    gl.uniform1f(this.u(mu, 'u_ch1_hue'), ch1.hue);
    gl.uniform1f(this.u(mu, 'u_ch1_sat'), ch1.sat);
    gl.uniform1f(this.u(mu, 'u_ch1_bright'), ch1.bright);
    gl.uniform1f(this.u(mu, 'u_ch1_sat_powmap'), ch1.satPowmap);
    gl.uniform1f(this.u(mu, 'u_ch1_bright_powmap'), ch1.brightPowmap);
    gl.uniform1i(this.u(mu, 'u_ch1_sat_wrap'), ch1.satWrap);
    gl.uniform1i(this.u(mu, 'u_ch1_bright_wrap'), ch1.brightWrap);
    gl.uniform1i(this.u(mu, 'u_ch1_hue_invert'), ch1.hueInvert);
    gl.uniform1i(this.u(mu, 'u_ch1_sat_invert'), ch1.satInvert);
    gl.uniform1i(this.u(mu, 'u_ch1_bright_invert'), ch1.brightInvert);

    for (let i = 0; i < 4; i++) {
      const fb = params.fb[i];
      const p = `u_fb${i}_`;
      gl.uniform1f(this.u(mu, p + 'blend'), fb.blend);
      gl.uniform1f(this.u(mu, p + 'lumakey'), fb.lumakey);
      gl.uniform1f(this.u(mu, p + 'lumathresh'), fb.lumathresh);
      gl.uniform3fv(this.u(mu, p + 'hsb'), fb.hsb);
      gl.uniform3fv(this.u(mu, p + 'huex'), fb.huex);
      gl.uniform3fv(this.u(mu, p + 'translate'), fb.translate);
      gl.uniform1f(this.u(mu, p + 'rotate'), fb.rotate);
      gl.uniform1i(this.u(mu, p + 'toroid'), fb.toroid);
      gl.uniform1i(this.u(mu, p + 'hflip'), fb.hflip);
      gl.uniform1i(this.u(mu, p + 'vflip'), fb.vflip);
      gl.uniform3fv(this.u(mu, p + 'invert'), fb.invert);
    }

    this.draw();
    return this.mixerFBO.tex;
  }

  private runBlur(inputTex: WebGLTexture, params: RenderParams): WebGLTexture {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.blurProg);
    this.bindTex(0, inputTex);
    gl.uniform1i(this.u(this.blurU, 'u_tex'), 0);
    gl.uniform2f(this.u(this.blurU, 'u_resolution'), this.width, this.height);
    gl.uniform1f(this.u(this.blurU, 'u_blur_amount'), params.blur.amount);
    gl.uniform1f(this.u(this.blurU, 'u_blur_radius'), params.blur.radius);
    this.draw();
    return this.blurFBO.tex;
  }

  private runSharpen(inputTex: WebGLTexture, params: RenderParams): WebGLTexture {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharpenFBO.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.sharpenProg);
    this.bindTex(0, inputTex);
    gl.uniform1i(this.u(this.sharpenU, 'u_tex'), 0);
    gl.uniform2f(this.u(this.sharpenU, 'u_resolution'), this.width, this.height);
    gl.uniform1f(this.u(this.sharpenU, 'u_sharpen_amount'), params.sharpen.amount);
    gl.uniform1f(this.u(this.sharpenU, 'u_sharpen_boost'), params.sharpen.boost);
    gl.uniform1f(this.u(this.sharpenU, 'u_sharpen_radius'), params.sharpen.radius);
    this.draw();
    return this.sharpenFBO.tex;
  }

  private runCustomShader(
    inputTex: WebGLTexture,
    prog: WebGLProgram,
    uniforms: UniformCache,
    fbo: { fbo: WebGLFramebuffer; tex: WebGLTexture },
  ): WebGLTexture {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(prog);
    this.bindTex(0, inputTex);
    gl.uniform1i(this.u(uniforms, 'u_tex'), 0);
    gl.uniform2f(this.u(uniforms, 'u_resolution'), this.width, this.height);
    gl.uniform1f(this.u(uniforms, 'u_time'), (performance.now() - this.startTime) / 1000.0);
    this.draw();
    return fbo.tex;
  }

  compileCustomShader(id: string, source: string): { success: boolean; error?: string } {
    const gl = this.gl;

    const oldProg = this.customProgs.get(id);
    if (oldProg) gl.deleteProgram(oldProg);

    // Auto-prepend version/precision if missing (vertex shader is #version 300 es)
    let fragSrc = source.trim();
    if (!fragSrc.startsWith('#version')) {
      fragSrc = '#version 300 es\nprecision highp float;\n' + fragSrc;
    }

    try {
      const prog = createProgram(gl, vertSrc, fragSrc);
      const uniforms = cacheUniforms(gl, prog, ['u_tex', 'u_resolution', 'u_time']);
      if (!this.customFBOs.has(id)) {
        this.customFBOs.set(id, createFBO(gl, this.width, this.height));
      }
      this.customProgs.set(id, prog);
      this.customUniforms.set(id, uniforms);
      this.customErrors.delete(id);
      return { success: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.customErrors.set(id, error);
      this.customProgs.delete(id);
      this.customUniforms.delete(id);
      return { success: false, error };
    }
  }

  getCustomShaderError(id: string): string | undefined {
    return this.customErrors.get(id);
  }

  deleteCustomShader(id: string) {
    const gl = this.gl;
    const prog = this.customProgs.get(id);
    if (prog) gl.deleteProgram(prog);
    const fbo = this.customFBOs.get(id);
    if (fbo) {
      gl.deleteFramebuffer(fbo.fbo);
      gl.deleteTexture(fbo.tex);
    }
    this.customProgs.delete(id);
    this.customUniforms.delete(id);
    this.customFBOs.delete(id);
    this.customErrors.delete(id);
  }

  resize(width: number, height: number) {
    const gl = this.gl;
    this.width = width;
    this.height = height;
    gl.canvas.width = width;
    gl.canvas.height = height;

    // Re-allocate inputTex
    gl.bindTexture(gl.TEXTURE_2D, this.inputTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    // Re-allocate all FBOs
    resizeFBO(gl, this.mixerFBO, width, height);
    resizeFBO(gl, this.blurFBO, width, height);
    resizeFBO(gl, this.sharpenFBO, width, height);
    resizeFBO(gl, this.auxFBO, width, height);

    for (const pf of this.pastFrames) {
      resizeFBO(gl, pf, width, height);
    }

    // Re-allocate custom shader FBOs
    for (const [, fbo] of this.customFBOs) {
      resizeFBO(gl, fbo, width, height);
    }

    this.clearAll();
  }

  clearAll() {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 1);
    for (const pf of this.pastFrames) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, pf.fbo);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.mixerFBO.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurFBO.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sharpenFBO.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.auxFBO.fbo);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.frameCount = 0;
  }
}
