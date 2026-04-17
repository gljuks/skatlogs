/**
 * GLSL-rendered splash screen with bitmap font.
 * Renders text with CRT scanlines + glow aesthetic.
 * Dismissed on any click/key.
 */

const SPLASH_VERT = `#version 300 es
precision highp float;
void main() {
    vec2 verts[3] = vec2[3](vec2(-1,-1), vec2(3,-1), vec2(-1,3));
    gl_Position = vec4(verts[gl_VertexID], 0.0, 1.0);
}
`;

// Bitmap font: each char is 5x7 pixels packed into a uint (35 bits).
// We encode the font in the shader itself for zero dependencies.
const SPLASH_FRAG = `#version 300 es
precision highp float;
out vec4 fragColor;

uniform float u_time;
uniform vec2 u_resolution;
uniform sampler2D u_textTex;
uniform vec2 u_textSize; // cols, rows

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    uv.y = 1.0 - uv.y;

    // Correct for aspect ratio: each char cell should be ~1:2 (w:h)
    // textSize.x * cellW = textSize.y * cellH * aspect
    float screenAspect = u_resolution.x / u_resolution.y;
    float charAspect = 0.55; // desired width/height ratio per character
    float textAspect = (u_textSize.x * charAspect) / u_textSize.y;

    // Scale UV to center text with correct proportions
    vec2 suv = uv;
    if (screenAspect > textAspect) {
        // Screen wider than text: pillarbox
        float scale = textAspect / screenAspect;
        suv.x = (uv.x - 0.5) / scale + 0.5;
    } else {
        // Screen taller than text: letterbox
        float scale = screenAspect / textAspect;
        suv.y = (uv.y - 0.5) / scale + 0.5;
    }

    // Read text texture
    vec2 grid = suv * u_textSize;
    ivec2 cell = ivec2(floor(grid));
    if (cell.x < 0 || cell.y < 0 || cell.x >= int(u_textSize.x) || cell.y >= int(u_textSize.y)
        || suv.x < 0.0 || suv.x > 1.0 || suv.y < 0.0 || suv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Get char code from texture
    float charVal = texelFetch(u_textTex, ivec2(cell.x, cell.y), 0).r * 255.0;
    int charCode = int(charVal + 0.5);

    // Sub-cell position (0-1 within the character cell)
    vec2 sub = fract(grid);

    // Each character is 5 wide x 7 tall in a pixel grid
    int px = int(sub.x * 6.0); // 5 pixels + 1 gap
    int py = int(sub.y * 9.0); // 7 pixels + 2 gap
    if (px >= 5 || py >= 7) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        // Add scanlines
        float scan = 0.5 + 0.5 * sin(gl_FragCoord.y * 3.14159);
        fragColor.rgb *= 0.02 * scan;
        return;
    }

    // Bitmap font data - 5x7 glyphs for ASCII 32-127
    // Encoded as 7 rows of 5 bits each = 35 bits per char (fits in uint32 with top row in MSB)
    bool lit = false;

    // Space
    if (charCode == 32) lit = false;
    // Common chars via procedural bitmaps
    else {
        // We use a font texture approach: encode common chars
        int row = py;
        int col = px;

        // Lookup table approach: pack 5 bits per row, 7 rows = 35 bits
        // We'll define the most needed chars
        int bitmap[7];
        bitmap[0] = 0; bitmap[1] = 0; bitmap[2] = 0; bitmap[3] = 0;
        bitmap[4] = 0; bitmap[5] = 0; bitmap[6] = 0;

        // Numbers and uppercase letters
        if (charCode == 33) { // !
            bitmap[0]=4;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=0;bitmap[5]=4;bitmap[6]=0;
        } else if (charCode == 40) { // (
            bitmap[0]=2;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=2;
        } else if (charCode == 41) { // )
            bitmap[0]=8;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=8;
        } else if (charCode == 43) { // +
            bitmap[0]=0;bitmap[1]=4;bitmap[2]=4;bitmap[3]=31;bitmap[4]=4;bitmap[5]=4;bitmap[6]=0;
        } else if (charCode == 44) { // ,
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=0;bitmap[3]=0;bitmap[4]=0;bitmap[5]=4;bitmap[6]=8;
        } else if (charCode == 45) { // -
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=0;bitmap[3]=31;bitmap[4]=0;bitmap[5]=0;bitmap[6]=0;
        } else if (charCode == 46) { // .
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=0;bitmap[3]=0;bitmap[4]=0;bitmap[5]=4;bitmap[6]=0;
        } else if (charCode == 47) { // /
            bitmap[0]=1;bitmap[1]=1;bitmap[2]=2;bitmap[3]=4;bitmap[4]=8;bitmap[5]=16;bitmap[6]=16;
        } else if (charCode == 48) { // 0
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=19;bitmap[3]=21;bitmap[4]=25;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 49) { // 1
            bitmap[0]=4;bitmap[1]=12;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=14;
        } else if (charCode == 50) { // 2
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=1;bitmap[3]=6;bitmap[4]=8;bitmap[5]=16;bitmap[6]=31;
        } else if (charCode == 51) { // 3
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=1;bitmap[3]=6;bitmap[4]=1;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 52) { // 4
            bitmap[0]=2;bitmap[1]=6;bitmap[2]=10;bitmap[3]=18;bitmap[4]=31;bitmap[5]=2;bitmap[6]=2;
        } else if (charCode == 53) { // 5
            bitmap[0]=31;bitmap[1]=16;bitmap[2]=30;bitmap[3]=1;bitmap[4]=1;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 54) { // 6
            bitmap[0]=14;bitmap[1]=16;bitmap[2]=16;bitmap[3]=30;bitmap[4]=17;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 55) { // 7
            bitmap[0]=31;bitmap[1]=1;bitmap[2]=2;bitmap[3]=4;bitmap[4]=8;bitmap[5]=8;bitmap[6]=8;
        } else if (charCode == 56) { // 8
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=17;bitmap[3]=14;bitmap[4]=17;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 57) { // 9
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=17;bitmap[3]=15;bitmap[4]=1;bitmap[5]=1;bitmap[6]=14;
        } else if (charCode == 58) { // :
            bitmap[0]=0;bitmap[1]=4;bitmap[2]=0;bitmap[3]=0;bitmap[4]=0;bitmap[5]=4;bitmap[6]=0;
        } else if (charCode == 65) { // A
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=17;bitmap[3]=31;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 66) { // B
            bitmap[0]=30;bitmap[1]=17;bitmap[2]=17;bitmap[3]=30;bitmap[4]=17;bitmap[5]=17;bitmap[6]=30;
        } else if (charCode == 67) { // C
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=16;bitmap[3]=16;bitmap[4]=16;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 68) { // D
            bitmap[0]=30;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=30;
        } else if (charCode == 69) { // E
            bitmap[0]=31;bitmap[1]=16;bitmap[2]=16;bitmap[3]=30;bitmap[4]=16;bitmap[5]=16;bitmap[6]=31;
        } else if (charCode == 70) { // F
            bitmap[0]=31;bitmap[1]=16;bitmap[2]=16;bitmap[3]=30;bitmap[4]=16;bitmap[5]=16;bitmap[6]=16;
        } else if (charCode == 71) { // G
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=16;bitmap[3]=23;bitmap[4]=17;bitmap[5]=17;bitmap[6]=15;
        } else if (charCode == 72) { // H
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=17;bitmap[3]=31;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 73) { // I
            bitmap[0]=14;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=14;
        } else if (charCode == 74) { // J
            bitmap[0]=7;bitmap[1]=2;bitmap[2]=2;bitmap[3]=2;bitmap[4]=2;bitmap[5]=18;bitmap[6]=12;
        } else if (charCode == 75) { // K
            bitmap[0]=17;bitmap[1]=18;bitmap[2]=20;bitmap[3]=24;bitmap[4]=20;bitmap[5]=18;bitmap[6]=17;
        } else if (charCode == 76) { // L
            bitmap[0]=16;bitmap[1]=16;bitmap[2]=16;bitmap[3]=16;bitmap[4]=16;bitmap[5]=16;bitmap[6]=31;
        } else if (charCode == 77) { // M
            bitmap[0]=17;bitmap[1]=27;bitmap[2]=21;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 78) { // N
            bitmap[0]=17;bitmap[1]=25;bitmap[2]=21;bitmap[3]=19;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 79) { // O
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 80) { // P
            bitmap[0]=30;bitmap[1]=17;bitmap[2]=17;bitmap[3]=30;bitmap[4]=16;bitmap[5]=16;bitmap[6]=16;
        } else if (charCode == 81) { // Q
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=21;bitmap[5]=18;bitmap[6]=13;
        } else if (charCode == 82) { // R
            bitmap[0]=30;bitmap[1]=17;bitmap[2]=17;bitmap[3]=30;bitmap[4]=20;bitmap[5]=18;bitmap[6]=17;
        } else if (charCode == 83) { // S
            bitmap[0]=14;bitmap[1]=17;bitmap[2]=16;bitmap[3]=14;bitmap[4]=1;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 84) { // T
            bitmap[0]=31;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=4;
        } else if (charCode == 85) { // U
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 86) { // V
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=10;bitmap[5]=10;bitmap[6]=4;
        } else if (charCode == 87) { // W
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=17;bitmap[3]=17;bitmap[4]=21;bitmap[5]=27;bitmap[6]=17;
        } else if (charCode == 88) { // X
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=10;bitmap[3]=4;bitmap[4]=10;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 89) { // Y
            bitmap[0]=17;bitmap[1]=17;bitmap[2]=10;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=4;
        } else if (charCode == 90) { // Z
            bitmap[0]=31;bitmap[1]=1;bitmap[2]=2;bitmap[3]=4;bitmap[4]=8;bitmap[5]=16;bitmap[6]=31;
        }
        // lowercase
        else if (charCode == 97) { // a
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=14;bitmap[3]=1;bitmap[4]=15;bitmap[5]=17;bitmap[6]=15;
        } else if (charCode == 98) { // b
            bitmap[0]=16;bitmap[1]=16;bitmap[2]=30;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=30;
        } else if (charCode == 99) { // c
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=14;bitmap[3]=16;bitmap[4]=16;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 100) { // d
            bitmap[0]=1;bitmap[1]=1;bitmap[2]=15;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=15;
        } else if (charCode == 101) { // e
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=14;bitmap[3]=17;bitmap[4]=31;bitmap[5]=16;bitmap[6]=14;
        } else if (charCode == 102) { // f
            bitmap[0]=6;bitmap[1]=8;bitmap[2]=28;bitmap[3]=8;bitmap[4]=8;bitmap[5]=8;bitmap[6]=8;
        } else if (charCode == 103) { // g
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=15;bitmap[3]=17;bitmap[4]=15;bitmap[5]=1;bitmap[6]=14;
        } else if (charCode == 104) { // h
            bitmap[0]=16;bitmap[1]=16;bitmap[2]=30;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 105) { // i
            bitmap[0]=4;bitmap[1]=0;bitmap[2]=12;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=14;
        } else if (charCode == 106) { // j
            bitmap[0]=2;bitmap[1]=0;bitmap[2]=2;bitmap[3]=2;bitmap[4]=2;bitmap[5]=18;bitmap[6]=12;
        } else if (charCode == 107) { // k
            bitmap[0]=16;bitmap[1]=16;bitmap[2]=18;bitmap[3]=20;bitmap[4]=24;bitmap[5]=20;bitmap[6]=18;
        } else if (charCode == 108) { // l
            bitmap[0]=12;bitmap[1]=4;bitmap[2]=4;bitmap[3]=4;bitmap[4]=4;bitmap[5]=4;bitmap[6]=14;
        } else if (charCode == 109) { // m
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=26;bitmap[3]=21;bitmap[4]=21;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 110) { // n
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=30;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=17;
        } else if (charCode == 111) { // o
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=14;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=14;
        } else if (charCode == 112) { // p
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=30;bitmap[3]=17;bitmap[4]=30;bitmap[5]=16;bitmap[6]=16;
        } else if (charCode == 113) { // q
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=15;bitmap[3]=17;bitmap[4]=15;bitmap[5]=1;bitmap[6]=1;
        } else if (charCode == 114) { // r
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=22;bitmap[3]=24;bitmap[4]=16;bitmap[5]=16;bitmap[6]=16;
        } else if (charCode == 115) { // s
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=15;bitmap[3]=16;bitmap[4]=14;bitmap[5]=1;bitmap[6]=30;
        } else if (charCode == 116) { // t
            bitmap[0]=8;bitmap[1]=8;bitmap[2]=28;bitmap[3]=8;bitmap[4]=8;bitmap[5]=9;bitmap[6]=6;
        } else if (charCode == 117) { // u
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=17;bitmap[3]=17;bitmap[4]=17;bitmap[5]=17;bitmap[6]=15;
        } else if (charCode == 118) { // v
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=17;bitmap[3]=17;bitmap[4]=17;bitmap[5]=10;bitmap[6]=4;
        } else if (charCode == 119) { // w
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=17;bitmap[3]=17;bitmap[4]=21;bitmap[5]=21;bitmap[6]=10;
        } else if (charCode == 120) { // x
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=17;bitmap[3]=10;bitmap[4]=4;bitmap[5]=10;bitmap[6]=17;
        } else if (charCode == 121) { // y
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=17;bitmap[3]=17;bitmap[4]=15;bitmap[5]=1;bitmap[6]=14;
        } else if (charCode == 122) { // z
            bitmap[0]=0;bitmap[1]=0;bitmap[2]=31;bitmap[3]=2;bitmap[4]=4;bitmap[5]=8;bitmap[6]=31;
        }

        int bits = bitmap[row];
        // Bit order: MSB = left pixel (bit 4), LSB = right pixel (bit 0)
        lit = ((bits >> (4 - col)) & 1) == 1;
    }

    // Color
    float c = lit ? 1.0 : 0.0;

    // Glow: soften edges
    vec2 cellCenter = (vec2(cell) + 0.5) / u_textSize;
    float dist = length(uv - cellCenter);

    // Green phosphor color
    vec3 color = vec3(0.1, 1.0, 0.3) * c;

    // Add subtle glow around lit pixels
    if (!lit) {
        // Sample neighbors for glow
        float glow = 0.0;
        for (int dy = -1; dy <= 1; dy++) {
            for (int dx = -1; dx <= 1; dx++) {
                if (dx == 0 && dy == 0) continue;
                ivec2 nc = cell + ivec2(dx, dy);
                if (nc.x >= 0 && nc.y >= 0 && nc.x < int(u_textSize.x) && nc.y < int(u_textSize.y)) {
                    float nv = texelFetch(u_textTex, nc, 0).r * 255.0;
                    if (int(nv + 0.5) > 32) glow += 0.02;
                }
            }
        }
        color = vec3(0.0, glow, glow * 0.3);
    }

    // Scanlines
    float scan = 0.7 + 0.3 * sin(gl_FragCoord.y * 3.14159 * 1.5);
    color *= scan;

    // Vignette
    vec2 vc = uv - 0.5;
    float vig = 1.0 - dot(vc, vc) * 1.5;
    color *= max(vig, 0.0);

    // Slight chromatic shift
    float t = u_time * 0.5;
    float flicker = 0.95 + 0.05 * sin(t * 13.0);
    color *= flicker;

    // CRT curvature
    vec2 cuv = uv * 2.0 - 1.0;
    cuv *= 1.0 + 0.02 * dot(cuv, cuv);

    fragColor = vec4(color, 1.0);
}
`;

export function showSplash(onDismiss: () => void) {
  // Mount inside canvas-container so controls are visible
  const container = document.getElementById('canvas-container')!;

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:100;cursor:pointer;';
  container.style.position = 'relative';

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;';
  overlay.appendChild(canvas);

  container.appendChild(overlay);

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false })!;
  if (!gl) {
    overlay.remove();
    onDismiss();
    return;
  }

  // Compile shaders
  const vs = gl.createShader(gl.VERTEX_SHADER)!;
  gl.shaderSource(vs, SPLASH_VERT);
  gl.compileShader(vs);

  const fs = gl.createShader(gl.FRAGMENT_SHADER)!;
  gl.shaderSource(fs, SPLASH_FRAG);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
    console.error('Splash shader error:', gl.getShaderInfoLog(fs));
    overlay.remove();
    onDismiss();
    return;
  }

  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uRes = gl.getUniformLocation(prog, 'u_resolution');
  const uTextTex = gl.getUniformLocation(prog, 'u_textTex');
  const uTextSize = gl.getUniformLocation(prog, 'u_textSize');

  const vao = gl.createVertexArray()!;

  // Build text grid
  const lines = [
    '',
    '  SKATLOGS',
    '',
    '  Web port of Andrei Jay VIDEO WAAAVES and other stuff,',
    '  made by gljuks and claude',
    '',
    '  QUICK START:',
    '',
    '  1. Select an input source',
    '     Camera, Screen/Tab (youtube or live-coding visuals like hydra),',
    '     Phosphorm - Andreis audio viz rendered on oscilloscope display. ',
    '',
    '  2. Luma key in the feedback on your',
    '     input video, blend it in, as needed',
    '',
    '  3. Tweak rotation, zoom,',
    '     displacement, and color',
    '',
    '  4. Use keyboard shortcuts or',
    '     MIDI controllers for live',
    '     performance',
    '',
    '  Click anywhere to begin.',
  ];

  const cols = Math.max(...lines.map(l => l.length), 46);
  const rows = lines.length;

  // Pad lines to uniform width and create texture data
  const textData = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    const line = lines[y] || '';
    for (let x = 0; x < cols; x++) {
      textData[y * cols + x] = x < line.length ? line.charCodeAt(x) : 32;
    }
  }

  const textTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, textTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, cols, rows, 0, gl.RED, gl.UNSIGNED_BYTE, textData);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const start = performance.now();
  let animId = 0;
  let dismissed = false;

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }
  resize();
  window.addEventListener('resize', resize);

  function frame() {
    if (dismissed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);

    gl.uniform1f(uTime, (performance.now() - start) / 1000);
    gl.uniform2f(uRes, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textTex);
    gl.uniform1i(uTextTex, 0);
    gl.uniform2f(uTextSize, cols, rows);

    gl.bindVertexArray(vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    animId = requestAnimationFrame(frame);
  }
  animId = requestAnimationFrame(frame);

  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    cancelAnimationFrame(animId);
    window.removeEventListener('resize', resize);
    // Fade out
    overlay.style.transition = 'opacity 0.4s';
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.remove();
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteTexture(textTex);
      onDismiss();
    }, 400);
  }

  overlay.addEventListener('click', dismiss);
  window.addEventListener('keydown', dismiss, { once: true });
}
