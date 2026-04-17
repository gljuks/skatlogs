#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D u_input;
uniform sampler2D u_fb0;
uniform sampler2D u_fb1;
uniform sampler2D u_fb2;
uniform sampler2D u_fb3;

uniform vec2 u_resolution;

// Channel 1 HSB
uniform float u_ch1_hue;
uniform float u_ch1_sat;
uniform float u_ch1_bright;
uniform float u_ch1_sat_powmap;
uniform float u_ch1_bright_powmap;
uniform int u_ch1_sat_wrap;
uniform int u_ch1_bright_wrap;
uniform int u_ch1_hue_invert;
uniform int u_ch1_sat_invert;
uniform int u_ch1_bright_invert;

// FB0
uniform float u_fb0_blend;
uniform float u_fb0_lumakey;
uniform float u_fb0_lumathresh;
uniform vec3 u_fb0_hsb;
uniform vec3 u_fb0_huex;
uniform vec3 u_fb0_translate;
uniform float u_fb0_rotate;
uniform int u_fb0_toroid;
uniform int u_fb0_hflip;
uniform int u_fb0_vflip;
uniform vec3 u_fb0_invert;

// FB1
uniform float u_fb1_blend;
uniform float u_fb1_lumakey;
uniform float u_fb1_lumathresh;
uniform vec3 u_fb1_hsb;
uniform vec3 u_fb1_huex;
uniform vec3 u_fb1_translate;
uniform float u_fb1_rotate;
uniform int u_fb1_toroid;
uniform int u_fb1_hflip;
uniform int u_fb1_vflip;
uniform vec3 u_fb1_invert;

// FB2
uniform float u_fb2_blend;
uniform float u_fb2_lumakey;
uniform float u_fb2_lumathresh;
uniform vec3 u_fb2_hsb;
uniform vec3 u_fb2_huex;
uniform vec3 u_fb2_translate;
uniform float u_fb2_rotate;
uniform int u_fb2_toroid;
uniform int u_fb2_hflip;
uniform int u_fb2_vflip;
uniform vec3 u_fb2_invert;

// FB3
uniform float u_fb3_blend;
uniform float u_fb3_lumakey;
uniform float u_fb3_lumathresh;
uniform vec3 u_fb3_hsb;
uniform vec3 u_fb3_huex;
uniform vec3 u_fb3_translate;
uniform float u_fb3_rotate;
uniform int u_fb3_toroid;
uniform int u_fb3_hflip;
uniform int u_fb3_vflip;
uniform vec3 u_fb3_invert;


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

vec3 channelHSB(vec3 c, float hue_x, float sat_x, float bright_x,
                float sat_powmap, float bright_powmap,
                int sat_wrap, int bright_wrap,
                int hue_inv, int sat_inv, int bright_inv) {
    c.x *= hue_x;
    c.y *= sat_x;
    c.z *= bright_x;

    if (c.x < 0.0) c.x = (hue_inv == 0) ? 1.0 - abs(c.x) : abs(1.0 - abs(c.x));
    if (c.y < 0.0) c.y = (sat_inv == 0) ? 1.0 - abs(c.y) : abs(1.0 - abs(c.y));
    if (c.z < 0.0) c.z = (bright_inv == 0) ? 1.0 - abs(c.z) : abs(1.0 - abs(c.z));

    if (sat_wrap == 1) {
        if (abs(c.y) > 1.0) c.y = fract(c.y);
    } else {
        c.y = min(c.y, 1.0);
    }
    if (bright_wrap == 1) {
        if (abs(c.z) > 1.0) c.z = fract(c.z);
    } else {
        c.z = min(c.z, 1.0);
    }

    c.x = fract(c.x);
    c.y = pow(max(c.y, 0.0), sat_powmap);
    c.z = pow(max(c.z, 0.0), bright_powmap);
    return c;
}

vec3 fbHSB(vec3 c, vec3 hsbx, vec3 huex, vec3 invertSw) {
    c.r = abs(c.r * hsbx.r + huex.z * sin(c.r / 3.14));
    c.r = fract(mod(c.r, max(huex.x, 0.001)) + huex.y);
    c.g *= hsbx.g;
    c.b *= hsbx.b;
    c.g = clamp(c.g, 0.0, 1.0);
    c.b = clamp(c.b, 0.0, 1.0);
    if (invertSw.r > 0.5) c.r = 1.0 - c.r;
    if (invertSw.g > 0.5) c.g = 1.0 - c.g;
    if (invertSw.b > 0.5) c.b = 1.0 - c.b;
    if (abs(c.x) > 1.0) c.x = abs(fract(c.x));
    c.y = clamp(c.y, 0.0, 1.0);
    c.z = clamp(c.z, 0.0, 1.0);
    return c;
}

vec2 rotateCoord(vec2 coord, float theta) {
    vec2 center = coord - 0.5;
    vec2 rot;
    rot.x = center.x * cos(theta) - center.y * sin(theta);
    rot.y = center.x * sin(theta) + center.y * cos(theta);
    return rot + 0.5;
}

vec2 wrapCoord(vec2 coord) {
    return fract(coord);
}

vec2 mirrorCoord(vec2 coord) {
    coord = abs(coord);
    vec2 m = mod(coord, 2.0);
    return mix(m, 2.0 - m, step(1.0, m));
}

// Transform feedback UV
vec2 transformFBCoord(vec2 uv, vec3 translate, float rot, int toroid, int hflip, int vflip) {
    vec2 coord = uv - 0.5;
    coord *= translate.z;
    coord += translate.xy;
    coord += 0.5;
    coord = rotateCoord(coord, rot);

    if (toroid == 1) coord = wrapCoord(coord);
    else if (toroid == 2) coord = mirrorCoord(coord);

    if (hflip == 1 && coord.x > 0.5) coord.x = 1.0 - coord.x;
    if (vflip == 1 && coord.y > 0.5) coord.y = 1.0 - coord.y;

    return coord;
}

bool inBounds(vec2 c) {
    return c.x >= 0.0 && c.x <= 1.0 && c.y >= 0.0 && c.y <= 1.0;
}

vec4 lumaMix(vec4 base, vec4 overlay, float blend, float lumakey, float lumathresh, float baseBright) {
    vec4 out_col = mix(base, overlay, blend);
    if (baseBright > lumakey - lumathresh && baseBright < lumakey + lumathresh) {
        out_col = overlay;
    }
    return out_col;
}

void main() {
    vec4 inputColor = texture(u_input, vUv);
    vec3 ch1_hsv = rgb2hsv(inputColor.rgb);
    ch1_hsv = channelHSB(ch1_hsv,
        u_ch1_hue, u_ch1_sat, u_ch1_bright,
        u_ch1_sat_powmap, u_ch1_bright_powmap,
        u_ch1_sat_wrap, u_ch1_bright_wrap,
        u_ch1_hue_invert, u_ch1_sat_invert, u_ch1_bright_invert);
    vec4 ch1_color = vec4(hsv2rgb(ch1_hsv), 1.0);

    // FB0
    vec2 fb0c = transformFBCoord(vUv, u_fb0_translate, u_fb0_rotate, u_fb0_toroid, u_fb0_hflip, u_fb0_vflip);
    vec4 fb0_color = inBounds(fb0c) || u_fb0_toroid > 0 ? texture(u_fb0, fb0c) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 fb0_hsv = rgb2hsv(fb0_color.rgb);
    fb0_hsv = fbHSB(fb0_hsv, u_fb0_hsb, u_fb0_huex, u_fb0_invert);
    fb0_color = vec4(hsv2rgb(fb0_hsv), 1.0);

    // FB1
    vec2 fb1c = transformFBCoord(vUv, u_fb1_translate, u_fb1_rotate, u_fb1_toroid, u_fb1_hflip, u_fb1_vflip);
    vec4 fb1_color = inBounds(fb1c) || u_fb1_toroid > 0 ? texture(u_fb1, fb1c) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 fb1_hsv = rgb2hsv(fb1_color.rgb);
    fb1_hsv = fbHSB(fb1_hsv, u_fb1_hsb, u_fb1_huex, u_fb1_invert);
    fb1_color = vec4(hsv2rgb(fb1_hsv), 1.0);

    // FB2
    vec2 fb2c = transformFBCoord(vUv, u_fb2_translate, u_fb2_rotate, u_fb2_toroid, u_fb2_hflip, u_fb2_vflip);
    vec4 fb2_color = inBounds(fb2c) || u_fb2_toroid > 0 ? texture(u_fb2, fb2c) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 fb2_hsv = rgb2hsv(fb2_color.rgb);
    fb2_hsv = fbHSB(fb2_hsv, u_fb2_hsb, u_fb2_huex, u_fb2_invert);
    fb2_color = vec4(hsv2rgb(fb2_hsv), 1.0);

    // FB3
    vec2 fb3c = transformFBCoord(vUv, u_fb3_translate, u_fb3_rotate, u_fb3_toroid, u_fb3_hflip, u_fb3_vflip);
    vec4 fb3_color = inBounds(fb3c) || u_fb3_toroid > 0 ? texture(u_fb3, fb3c) : vec4(0.0, 0.0, 0.0, 1.0);
    vec3 fb3_hsv = rgb2hsv(fb3_color.rgb);
    fb3_hsv = fbHSB(fb3_hsv, u_fb3_hsb, u_fb3_huex, u_fb3_invert);
    fb3_color = vec4(hsv2rgb(fb3_hsv), 1.0);

    // Mix chain
    float baseBright = ch1_hsv.z;
    vec4 result = ch1_color;

    result = lumaMix(result, fb0_color, u_fb0_blend, u_fb0_lumakey, u_fb0_lumathresh, baseBright);
    baseBright = rgb2hsv(result.rgb).z;
    result = lumaMix(result, fb1_color, u_fb1_blend, u_fb1_lumakey, u_fb1_lumathresh, baseBright);
    baseBright = rgb2hsv(result.rgb).z;
    result = lumaMix(result, fb2_color, u_fb2_blend, u_fb2_lumakey, u_fb2_lumathresh, baseBright);
    baseBright = rgb2hsv(result.rgb).z;
    result = lumaMix(result, fb3_color, u_fb3_blend, u_fb3_lumakey, u_fb3_lumathresh, baseBright);

    fragColor = result;
}
