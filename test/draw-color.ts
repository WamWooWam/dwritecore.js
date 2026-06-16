import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { colorref, DWRITE_MEASURING_MODE, type GlyphRunDesc } from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using interop = factory.getGdiInterop();
using params = factory.createRenderingParams();

const emSize = 64;
const margin = 16;

using face = factory.loadFontFace("/local/fonts/seguiemj.ttf");
const fm = face.getMetrics();
const ascentPx = (fm.ascent / fm.designUnitsPerEm) * emSize;
const descentPx = (fm.descent / fm.designUnitsPerEm) * emSize;

function run(text: string, x: number): { run: GlyphRunDesc; width: number } {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const gids = face.getGlyphIndices(cps);
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / fm.designUnitsPerEm) * emSize);
  return {
    run: { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances },
    width: advances.reduce((a, b) => a + b, 0),
  };
}

const part1 = run("DWriteCore ", margin);
const part2 = run("in colour! 😁", margin + part1.width);
const totalWidth = part1.width + part2.width;

const W = Math.ceil(totalWidth) + margin * 2;
const H = Math.ceil(ascentPx + descentPx) + margin * 2;
using target = interop.createBitmapRenderTarget(0, W, H);

// Pre-fill the surface white; DrawGlyphRun blends the antialiased glyphs over it.
target.pixels().data.fill(0x00ffffff);

const baselineY = ascentPx + margin;
target.drawGlyphRun({
  baselineOriginX: margin, baselineOriginY: baselineY,
  run: part1.run, renderingParams: params,
  color: colorref(0xe0, 0x20, 0x20), measuringMode: DWRITE_MEASURING_MODE.NATURAL,
});
target.drawGlyphRun({
  baselineOriginX: margin + part1.width, baselineOriginY: baselineY,
  run: part2.run, renderingParams: params,
  color: colorref(0x20, 0x60, 0xe0), measuringMode: DWRITE_MEASURING_MODE.NATURAL,
});

// BGRA32 (top-down) -> RGBA for the PNG.
const { width, height, data } = target.pixels();
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(width, height);
for (let i = 0; i < width * height; i++) {
  const bgra = data[i]!;
  img.data[i * 4 + 0] = (bgra >>> 16) & 0xff; // R
  img.data[i * 4 + 1] = (bgra >>> 8) & 0xff;  // G
  img.data[i * 4 + 2] = bgra & 0xff;          // B
  img.data[i * 4 + 3] = 255;
}
ctx.putImageData(img, 0, 0);
await snapshot("color", canvas.toBuffer("image/png"));
