#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform float u_time;

void main() {
    vec2 uv = vUv;
    float r = 0.5 + 0.5 * sin(uv.x * 10.0 + u_time);
    float g = 0.5 + 0.5 * sin(uv.y * 10.0 + u_time * 1.3);
    float b = 0.5 + 0.5 * sin((uv.x + uv.y) * 8.0 + u_time * 0.7);
    fragColor = vec4(r, g, b, 1.0);
}
