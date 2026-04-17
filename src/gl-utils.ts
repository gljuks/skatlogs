/** Compile a shader from source */
export function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

/** Link a program from vertex + fragment shaders */
export function createProgram(gl: WebGL2RenderingContext, vertSrc: string, fragSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    throw new Error(`Program link error: ${info}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return prog;
}

/** Create an RGBA FBO at the given size */
export function createFBO(gl: WebGL2RenderingContext, width: number, height: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  return { fbo, tex };
}

/** Resize an existing FBO's texture in-place */
export function resizeFBO(gl: WebGL2RenderingContext, fbo: { fbo: WebGLFramebuffer; tex: WebGLTexture }, width: number, height: number) {
  gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

/** Helper to set uniform by type */
export function setUniforms(gl: WebGL2RenderingContext, prog: WebGLProgram, uniforms: Record<string, number | number[]>) {
  for (const [name, value] of Object.entries(uniforms)) {
    const loc = gl.getUniformLocation(prog, name);
    if (loc === null) continue;
    if (typeof value === 'number') {
      // Check if it's an int uniform by name convention
      if (name.startsWith('u_ch1_') && (name.includes('wrap') || name.includes('invert')) ||
          name.includes('_toroid') || name.includes('_hflip') || name.includes('_vflip')) {
        gl.uniform1i(loc, value);
      } else {
        gl.uniform1f(loc, value);
      }
    } else if (value.length === 2) {
      gl.uniform2fv(loc, value);
    } else if (value.length === 3) {
      gl.uniform3fv(loc, value);
    }
  }
}
