// Raw text rendering via IDWriteGlyphRunAnalysis: no layout, no render target, just a glyph run
// rasterized straight to an alpha texture, which we map to grayscale pixels by hand. Renders the
// same run in GRAYSCALE_1x1 and CLEARTYPE_3x1 side by side so the antialiasing difference is
// visible, and asserts both produce coverage.
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import {
  DWRITE_TEXTURE_TYPE, DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE, type GlyphRunDesc,
} from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using face = factory.loadFontFace("/local/fonts/segoeui.ttf");

const text = "Raw glyphs";
const emSize = 64;
const upem = face.getMetrics().designUnitsPerEm;
const gids = face.getGlyphIndices([...text].map((c) => c.codePointAt(0)!));
const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / upem) * emSize);
const run: GlyphRunDesc = { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances };

function rasterize(renderingMode: DWRITE_RENDERING_MODE, textureType: DWRITE_TEXTURE_TYPE) {
  using analysis = factory.createGlyphRunAnalysis(run, {
    renderingMode, measuringMode: DWRITE_MEASURING_MODE.NATURAL,
  });
  const tex = analysis.createAlphaTexture(textureType);
  // Coverage per pixel: aliased is 1 byte; cleartype is 3 (R/G/B sub-pixel), average them.
  const cov = new Float32Array(tex.width * tex.height);
  for (let i = 0; i < cov.length; i++) {
    if (tex.bytesPerPixel === 3) cov[i] = (tex.data[i * 3]! + tex.data[i * 3 + 1]! + tex.data[i * 3 + 2]!) / 3 / 255;
    else cov[i] = tex.data[i]! / 255;
  }
  return { ...tex, cov };
}

const gray = rasterize(DWRITE_RENDERING_MODE.ALIASED, DWRITE_TEXTURE_TYPE.ALIASED_1x1);
const clear = rasterize(DWRITE_RENDERING_MODE.NATURAL, DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1);
console.log(`aliased ${gray.width}x${gray.height} (${gray.bytesPerPixel}bpp) | cleartype ${clear.width}x${clear.height} (${clear.bytesPerPixel}bpp)`);

const margin = 16, gap = 24;
const W = margin * 2 + Math.max(gray.width, clear.width);
const H = margin * 2 + gray.height + gap + clear.height;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

function blit(t: { width: number; height: number; cov: Float32Array }, oy: number) {
  const img = ctx.createImageData(t.width, t.height);
  for (let i = 0; i < t.width * t.height; i++) {
    const v = Math.round(255 * (1 - t.cov[i]!));
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, margin, oy);
}
blit(gray, margin);
blit(clear, margin + gray.height + gap);

const inked = (t: { cov: Float32Array }) => t.cov.some((c) => c > 0.5);
if (!inked(gray) || !inked(clear)) throw new Error("expected coverage in both textures");

await snapshot("raw", canvas.toBuffer("image/png"));
