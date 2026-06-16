import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_TEXTURE_TYPE, DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE } from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const text = "Hello, DWriteCore!";
const emSize = 96;
const margin = 16;

using face = factory.loadFontFace("/local/fonts/arial.ttf");
const upem = face.getMetrics().designUnitsPerEm;
const codePoints = [...text].map((c) => c.codePointAt(0)!);
const glyphIndices = face.getGlyphIndices(codePoints);
const glyphAdvances = face.getDesignGlyphMetrics(glyphIndices).map((g) => (g.advanceWidth / upem) * emSize);

using analysis = factory.createGlyphRunAnalysis(
  { fontFace: face.ptr, fontEmSize: emSize, glyphIndices, glyphAdvances },
  {
    renderingMode: DWRITE_RENDERING_MODE.NATURAL,
    measuringMode: DWRITE_MEASURING_MODE.NATURAL,
    baselineOriginX: 0,
    baselineOriginY: 0,
  },
);

const tex = analysis.createAlphaTexture(DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1);
console.log(`alpha texture: ${tex.width}x${tex.height}, ${tex.bytesPerPixel} bpp, bounds`, tex.bounds);

const W = tex.width + margin * 2;
const H = tex.height + margin * 2;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(W, H);
img.data.fill(255); // white background

for (let y = 0; y < tex.height; y++) {
  for (let x = 0; x < tex.width; x++) {
    const src = (y * tex.width + x) * 3;
    const coverage = (tex.data[src]! + tex.data[src + 1]! + tex.data[src + 2]!) / 3 / 255;
    const gray = Math.round(255 * (1 - coverage)); // black text on white
    const dst = ((y + margin) * W + (x + margin)) * 4;
    img.data[dst] = gray;
    img.data[dst + 1] = gray;
    img.data[dst + 2] = gray;
    img.data[dst + 3] = 255;
  }
}
ctx.putImageData(img, 0, 0);

await snapshot("draw", canvas.toBuffer("image/png"));
