import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { colorref, DWRITE_MEASURING_MODE, type GlyphRunDesc } from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using interop = factory.getGdiInterop();
using params = factory.createRenderingParams();

// Bahnschrift is a variable font with weight (wght) and width (wdth) axes.
using base = factory.loadFontFace("/local/fonts/bahnschrift.ttf");
console.log("hasVariations:", base.hasVariations);
console.log("default axis values:", base.fontAxisValues);

using resource = base.getFontResource();
console.log("axis count:", resource.fontAxisCount);
console.log("axis ranges:", resource.getFontAxisRanges(resource.fontAxisCount).map((r) => `${r.tag} ${r.min}..${r.max}`).join(", "));

const emSize = 56;
const margin = 20;
const weights = [100, 250, 400, 550, 700, 850];

// Pre-instantiate a face per weight and measure, so we can size the canvas.
const samples = weights.map((wght) => {
  const face = resource.createFontFace(0, [{ tag: "wght", value: wght }]);
  const fm = face.getMetrics();
  const text = `Bahnschrift wght ${wght}`;
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const gids = face.getGlyphIndices(cps);
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / fm.designUnitsPerEm) * emSize);
  const width = advances.reduce((a, b) => a + b, 0);
  const run: GlyphRunDesc = { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances };
  return { face, fm, run, width };
});

const lineH = Math.ceil((samples[0]!.fm.ascent + samples[0]!.fm.descent) / samples[0]!.fm.designUnitsPerEm * emSize) + 8;
const W = Math.ceil(Math.max(...samples.map((s) => s.width))) + margin * 2;
const H = lineH * weights.length + margin * 2;

using target = interop.createBitmapRenderTarget(0, W, H);
target.pixels().data.fill(0x00ffffff);

let y = margin;
for (const sample of samples) {
  const baselineY = y + (sample.fm.ascent / sample.fm.designUnitsPerEm) * emSize;
  target.drawGlyphRun({
    baselineOriginX: margin, baselineOriginY: baselineY,
    run: sample.run, renderingParams: params,
    color: colorref(0x16, 0x16, 0x16), measuringMode: DWRITE_MEASURING_MODE.NATURAL,
  });
  y += lineH;
  sample.face[Symbol.dispose]();
}

const { width, height, data } = target.pixels();
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(width, height);
for (let i = 0; i < width * height; i++) {
  const bgra = data[i]!;
  img.data[i * 4 + 0] = (bgra >>> 16) & 0xff;
  img.data[i * 4 + 1] = (bgra >>> 8) & 0xff;
  img.data[i * 4 + 2] = bgra & 0xff;
  img.data[i * 4 + 3] = 255;
}
ctx.putImageData(img, 0, 0);
await snapshot("variable", canvas.toBuffer("image/png"));
