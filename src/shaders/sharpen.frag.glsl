#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_sharpen_amount;
uniform float u_sharpen_boost;
uniform float u_sharpen_radius;

vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 texel = 1.0 / u_resolution;
    float r = u_sharpen_radius;

    // Sample 8 neighbors brightness in HSV space
    float neighborBright =
        rgb2hsv(texture(u_tex, vUv + vec2(r, 0.0) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(-r, 0.0) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(0.0, r) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(0.0, -r) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(r, r) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(-r, r) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(r, -r) * texel).rgb).z +
        rgb2hsv(texture(u_tex, vUv + vec2(-r, -r) * texel).rgb).z;

    neighborBright /= 8.0;

    vec4 original = texture(u_tex, vUv);
    vec3 hsv = rgb2hsv(original.rgb);
    hsv.z -= u_sharpen_amount * neighborBright;

    if (u_sharpen_amount > 0.0) {
        hsv.z *= (1.0 + u_sharpen_amount + u_sharpen_boost);
    }

    hsv.z = clamp(hsv.z, 0.0, 1.0);
    fragColor = vec4(hsv2rgb(hsv), 1.0);
}
