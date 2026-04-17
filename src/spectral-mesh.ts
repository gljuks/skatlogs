/**
 * Spectral Mesh: Video displacement effect.
 * Renders video onto a deformable mesh grid where vertices are displaced
 * by brightness and cross-modulated LFOs.
 */

import { createProgram, createFBO, resizeFBO } from './gl-utils';

const MESH_VERT = `#version 300 es
precision highp float;

in vec2 a_position; // grid position 0-1
in vec2 a_texcoord;

out vec2 vUv;

uniform sampler2D u_tex;
uniform vec2 u_displace;     // x, y brightness displacement amount
uniform int u_bright_invert;

// Z oscillator
uniform float u_z_freq;
uniform float u_z_amp;
uniform float u_z_speed;     // accumulated theta
uniform int u_z_shape;

// X oscillator
uniform float u_x_freq;
uniform float u_x_amp;
uniform float u_x_speed;
uniform int u_x_shape;

// Y oscillator
uniform float u_y_freq;
uniform float u_y_amp;
uniform float u_y_speed;
uniform int u_y_shape;

// Cross-modulation
uniform int u_z_phasemod; // Z modulated by Y
uniform int u_x_phasemod; // X modulated by Z
uniform int u_y_phasemod; // Y modulated by X
uniform int u_z_ringmod;
uniform int u_x_ringmod;
uniform int u_y_ringmod;

float oscillate(float theta, int shape) {
    if (shape == 1) return sign(sin(theta));        // square
    if (shape == 2) return fract(theta / 6.28) * 2.0 - 1.0; // saw
    return sin(theta);                               // sine (default)
}

void main() {
    vUv = a_texcoord;

    vec4 color = texture(u_tex, a_texcoord);
    float bright = 0.33 * color.r + 0.5 * color.g + 0.16 * color.b;
    bright = 2.0 * log(1.0 + bright);
    if (u_bright_invert == 1) bright = 1.0 - bright;

    vec2 pos = a_position * 2.0 - 1.0; // map to -1..1

    // Z oscillator (radial zoom)
    float dist = length(pos);
    float x_lfo = u_x_amp * oscillate(u_x_speed + pos.y * u_x_freq, u_x_shape);
    float y_lfo = (u_y_amp + float(u_y_ringmod) * 0.01 * x_lfo) *
                  oscillate(u_y_speed + pos.x * u_y_freq + float(u_y_phasemod) * 0.01 * x_lfo, u_y_shape);

    float z_amp = u_z_amp + float(u_z_ringmod) * 0.0025 * y_lfo;
    float z_freq = u_z_speed + u_z_freq * dist + float(u_z_phasemod) * y_lfo;
    float z_lfo = z_amp * oscillate(z_freq, u_z_shape);
    pos *= (1.0 - z_lfo);

    // X oscillator (recompute with Z modulation)
    float x_amp = u_x_amp + float(u_x_ringmod) * 1000.0 * z_lfo;
    float x_freq2 = u_x_speed + pos.y * u_x_freq + float(u_x_phasemod) * 10.0 * z_lfo;
    x_lfo = x_amp * oscillate(x_freq2, u_x_shape);
    pos.x += u_displace.x * bright + x_lfo;

    // Y oscillator (with X modulation)
    float y_amp = u_y_amp + float(u_y_ringmod) * x_lfo;
    float y_freq2 = u_y_speed + pos.x * u_y_freq + float(u_y_phasemod) * 0.01 * x_lfo;
    y_lfo = y_amp * oscillate(y_freq2, u_y_shape);
    pos.y += u_displace.y * bright + y_lfo;

    gl_Position = vec4(pos, 0.0, 1.0);
}
`;

const MESH_FRAG = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform float u_luma_key;
uniform int u_luma_mode;   // 0=dark transparent, 1=bright transparent
uniform float u_bw;        // 0=color, 1=greyscale
uniform float u_invert;    // 0=normal, 1=inverted

void main() {
    vec4 color = texture(u_tex, vUv);
    float bright = 0.33 * color.r + 0.5 * color.g + 0.16 * color.b;

    // B&W
    color = mix(color, vec4(vec3(bright), 1.0), u_bw);
    // Invert
    color.rgb = mix(color.rgb, 1.0 - color.rgb, u_invert);

    // Luma key
    if (u_luma_mode == 0 && bright < u_luma_key) color.a = 0.0;
    if (u_luma_mode == 1 && bright > u_luma_key) color.a = 0.0;

    fragColor = color;
}
`;

export interface SpectralMeshParams {
  enabled: boolean;
  resolution: number;   // grid divisions (4-128)
  displaceX: number;    // brightness → X displacement
  displaceY: number;    // brightness → Y displacement
  brightInvert: boolean;
  // Oscillators
  zFreq: number; zAmp: number; zShape: number;
  xFreq: number; xAmp: number; xShape: number;
  yFreq: number; yAmp: number; yShape: number;
  // Cross-mod
  zPhaseMod: boolean; xPhaseMod: boolean; yPhaseMod: boolean;
  zRingMod: boolean;  xRingMod: boolean;  yRingMod: boolean;
  // Fragment
  lumaKey: number;
  lumaMode: number;   // 0=dark transp, 1=bright transp
  bw: number;
  invert: number;
  // Speed
  speed: number;
  // Mesh type: 0=triangles, 1=wireframe, 2=hlines, 3=vlines
  meshType: number;
}

export function defaultSpectralParams(): SpectralMeshParams {
  return {
    enabled: false,
    resolution: 32,
    displaceX: 0.0,
    displaceY: 0.0,
    brightInvert: false,
    zFreq: 2.0, zAmp: 0.0, zShape: 0,
    xFreq: 2.0, xAmp: 0.0, xShape: 0,
    yFreq: 2.0, yAmp: 0.0, yShape: 0,
    zPhaseMod: false, xPhaseMod: false, yPhaseMod: false,
    zRingMod: false,  xRingMod: false,  yRingMod: false,
    lumaKey: 0.0,
    lumaMode: 0,
    bw: 0.0,
    invert: 0.0,
    speed: 1.0,
    meshType: 0,
  };
}

export class SpectralMesh {
  private gl: WebGL2RenderingContext;
  private width: number;
  private height: number;
  private prog: WebGLProgram;
  private fbo: { fbo: WebGLFramebuffer; tex: WebGLTexture };

  private vao: WebGLVertexArrayObject;
  private posBuffer: WebGLBuffer;
  private uvBuffer: WebGLBuffer;
  private indexBuffer: WebGLBuffer;
  private indexCount = 0;
  private currentRes = 0;

  private theta = 0;

  // Cached uniforms
  private uLocs: Record<string, WebGLUniformLocation | null> = {};

  constructor(gl: WebGL2RenderingContext, width: number, height: number) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.prog = createProgram(gl, MESH_VERT, MESH_FRAG);

    const names = [
      'u_tex', 'u_displace', 'u_bright_invert',
      'u_z_freq', 'u_z_amp', 'u_z_speed', 'u_z_shape',
      'u_x_freq', 'u_x_amp', 'u_x_speed', 'u_x_shape',
      'u_y_freq', 'u_y_amp', 'u_y_speed', 'u_y_shape',
      'u_z_phasemod', 'u_x_phasemod', 'u_y_phasemod',
      'u_z_ringmod', 'u_x_ringmod', 'u_y_ringmod',
      'u_luma_key', 'u_luma_mode', 'u_bw', 'u_invert',
    ];
    for (const n of names) {
      this.uLocs[n] = gl.getUniformLocation(this.prog, n);
    }

    this.fbo = createFBO(gl, width, height);

    this.vao = gl.createVertexArray()!;
    this.posBuffer = gl.createBuffer()!;
    this.uvBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
  }

  private buildMesh(res: number) {
    if (res === this.currentRes) return;
    this.currentRes = res;
    const gl = this.gl;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y <= res; y++) {
      for (let x = 0; x <= res; x++) {
        const u = x / res;
        const v = y / res;
        positions.push(u, 1.0 - v); // flip Y so mesh renders right-side up in FBO
        uvs.push(u, 1.0 - v); // match position flip for correct texture sampling
      }
    }

    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * (res + 1) + x;
        indices.push(i, i + 1, i + res + 1);
        indices.push(i + 1, i + res + 2, i + res + 1);
      }
    }

    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(this.prog, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uvs), gl.STATIC_DRAW);
    const uvLoc = gl.getAttribLocation(this.prog, 'a_texcoord');
    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

    gl.bindVertexArray(null);
    this.indexCount = indices.length;
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
    resizeFBO(this.gl, this.fbo, this.width, this.height);
  }

  /** Render input texture through spectral mesh displacement, return result texture */
  render(inputTex: WebGLTexture, params: SpectralMeshParams): WebGLTexture {
    if (!params.enabled) return inputTex;

    const gl = this.gl;
    const res = Math.max(4, Math.min(128, Math.round(params.resolution)));
    this.buildMesh(res);

    this.theta += 0.016 * params.speed;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo.fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, inputTex);
    gl.uniform1i(this.uLocs['u_tex'], 0);

    gl.uniform2f(this.uLocs['u_displace'], params.displaceX, params.displaceY);
    gl.uniform1i(this.uLocs['u_bright_invert'], params.brightInvert ? 1 : 0);

    gl.uniform1f(this.uLocs['u_z_freq'], params.zFreq);
    gl.uniform1f(this.uLocs['u_z_amp'], params.zAmp);
    gl.uniform1f(this.uLocs['u_z_speed'], this.theta * params.zFreq);
    gl.uniform1i(this.uLocs['u_z_shape'], params.zShape);

    gl.uniform1f(this.uLocs['u_x_freq'], params.xFreq);
    gl.uniform1f(this.uLocs['u_x_amp'], params.xAmp);
    gl.uniform1f(this.uLocs['u_x_speed'], this.theta * params.xFreq);
    gl.uniform1i(this.uLocs['u_x_shape'], params.xShape);

    gl.uniform1f(this.uLocs['u_y_freq'], params.yFreq);
    gl.uniform1f(this.uLocs['u_y_amp'], params.yAmp);
    gl.uniform1f(this.uLocs['u_y_speed'], this.theta * params.yFreq);
    gl.uniform1i(this.uLocs['u_y_shape'], params.yShape);

    gl.uniform1i(this.uLocs['u_z_phasemod'], params.zPhaseMod ? 1 : 0);
    gl.uniform1i(this.uLocs['u_x_phasemod'], params.xPhaseMod ? 1 : 0);
    gl.uniform1i(this.uLocs['u_y_phasemod'], params.yPhaseMod ? 1 : 0);
    gl.uniform1i(this.uLocs['u_z_ringmod'], params.zRingMod ? 1 : 0);
    gl.uniform1i(this.uLocs['u_x_ringmod'], params.xRingMod ? 1 : 0);
    gl.uniform1i(this.uLocs['u_y_ringmod'], params.yRingMod ? 1 : 0);

    gl.uniform1f(this.uLocs['u_luma_key'], params.lumaKey);
    gl.uniform1i(this.uLocs['u_luma_mode'], params.lumaMode);
    gl.uniform1f(this.uLocs['u_bw'], params.bw);
    gl.uniform1f(this.uLocs['u_invert'], params.invert);

    // Draw mesh
    gl.bindVertexArray(this.vao);
    const mode = params.meshType === 1 ? gl.LINES :
                 params.meshType === 2 ? gl.LINES :
                 params.meshType === 3 ? gl.LINES :
                 gl.TRIANGLES;
    gl.drawElements(mode, this.indexCount, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    return this.fbo.tex;
  }
}
