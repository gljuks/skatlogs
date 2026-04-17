#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_tex;
uniform vec2 u_resolution;
uniform float u_blur_amount;
uniform float u_blur_radius;

void main() {
    vec2 texel = 1.0 / u_resolution;
    float r = u_blur_radius;

    vec4 blur_kernel =
        texture(u_tex, vUv + vec2(r, r) * texel) +
        texture(u_tex, vUv + vec2(0.0, r) * texel) +
        texture(u_tex, vUv + vec2(-r, r) * texel) +
        texture(u_tex, vUv + vec2(-r, 0.0) * texel) +
        texture(u_tex, vUv + vec2(-r, -r) * texel) +
        texture(u_tex, vUv + vec2(0.0, -r) * texel) +
        texture(u_tex, vUv + vec2(r, -r) * texel) +
        texture(u_tex, vUv + vec2(r, 0.0) * texel);

    blur_kernel *= 0.125;

    vec4 original = texture(u_tex, vUv);
    fragColor = vec4(
        original.rgb * (1.0 - u_blur_amount) + blur_kernel.rgb * u_blur_amount,
        1.0
    );
}
