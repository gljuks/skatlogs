#version 300 es
precision highp float;

// Fullscreen triangle - no vertex buffer needed
// Invoke with gl.drawArrays(gl.TRIANGLES, 0, 3)
out vec2 vUv;

void main() {
    float x = float((gl_VertexID & 1) << 2);
    float y = float((gl_VertexID & 2) << 1);
    vUv = vec2(x * 0.5, y * 0.5);
    gl_Position = vec4(x - 1.0, y - 1.0, 0.0, 1.0);
}
