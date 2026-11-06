precision highp float;
precision highp int;

#ifdef VERTEX_SHADER
layout(location = 0) in vec2 tl;
layout(location = 1) in vec2 tr;
layout(location = 2) in vec2 bl;
layout(location = 3) in vec2 br;
layout(location = 4) in vec4 values;
layout(location = 5) in vec4 flags;
uniform mat4 matrix;
out vec2 uv;
flat out vec4 sampleValues;
flat out vec4 sampleFlags;
void main() {
    vec2 vertices[4] = vec2[4](tl, tr, bl, br);
    vec2 coordinates[4] = vec2[4](vec2(0.0, 1.0), vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 0.0));
    gl_Position = matrix * vec4(vertices[gl_VertexID], 0.0, 1.0);
    uv = coordinates[gl_VertexID];
    sampleValues = values;
    sampleFlags = flags;
}
#endif

#ifdef FRAGMENT_SHADER
uniform sampler2D paletteTexture;
uniform int displayAttribute;
uniform float metersPerPixel;
uniform float devicePixelRatio;
uniform vec2 elevationRange;
uniform vec3 elevationLowColor;
uniform vec3 elevationHighColor;
uniform float outlineDarkening;
in vec2 uv;
flat in vec4 sampleValues;
flat in vec4 sampleFlags;
out vec4 fragColor;
const float CELL_THRESHOLD = 4.0;
const float FULL_OUTLINE_THRESHOLD = 8.0;
void main() {
    vec3 color;
    if (displayAttribute == 1) {
        float t = elevationRange.x == elevationRange.y ? 0.0 : clamp((sampleValues.y - elevationRange.x) / (elevationRange.y - elevationRange.x), 0.0, 1.0);
        color = mix(elevationLowColor, elevationHighColor, t);
    } else {
        float category = displayAttribute == 0 ? sampleValues.x : sampleValues.z;
        color = texelFetch(paletteTexture, ivec2(int(mod(category, 256.0)), 0), 0).rgb;
    }
    float u = min(1.0, metersPerPixel / sampleValues.w);
    float coverage = 1.0 - (1.0 - u) * (1.0 - u);
    if (sampleFlags.x > 0.0) {
        // Grid distance per CSS pixel, from this four-corner node's raster footprint.
        vec2 dx = dFdx(uv) * sampleFlags.xy * devicePixelRatio;
        vec2 dy = dFdy(uv) * sampleFlags.xy * devicePixelRatio;
        float s = max(length(dx), length(dy));
        u = min(1.0, s / sampleValues.w);
        coverage = 1.0 - (1.0 - u) * (1.0 - u);
    } else {
        vec2 dx = dFdx(uv);
        vec2 dy = dFdy(uv);
        vec2 cssDerivative = vec2(length(vec2(dx.x, dy.x)), length(vec2(dx.y, dy.y))) * devicePixelRatio;
        float pixels = 1.0 / max(cssDerivative.x, cssDerivative.y);
        vec2 edgeDistance = min(uv, 1.0 - uv) / max(cssDerivative, vec2(0.0000001));
        // Box-filter a one-CSS-pixel centered line against the actual device pixel.
        vec2 line = clamp((vec2(0.5 + 0.5 / devicePixelRatio) - edgeDistance) * devicePixelRatio, 0.0, 1.0);
        float outline = 1.0 - (1.0 - line.x) * (1.0 - line.y);
        u = min(1.0, 1.0 / pixels);
        float realCoverage = 1.0 - (1.0 - u) * (1.0 - u);
        coverage = mix(realCoverage, outline, smoothstep(CELL_THRESHOLD, FULL_OUTLINE_THRESHOLD, pixels));
        if (sampleFlags.y > 0.5) color = mix(color, vec3(0.75, 0.20, 0.16), 0.7);
    }
    color = mix(color, vec3(1.0, 0.78, 0.20), 0.7 * sampleFlags.z);
    color *= 1.0 - outlineDarkening * coverage;
    float opacity = sampleFlags.w;
    fragColor = vec4(color * opacity, opacity);
}
#endif
