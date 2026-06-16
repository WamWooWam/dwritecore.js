import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { IDWriteBitmapRenderTarget } from "../src/interfaces/IDWriteBitmapRenderTarget.js";
import { IID_IDWriteBitmapRenderTarget3 } from "../src/core/iids.js";
import { colorref, DWRITE_MEASURING_MODE, DWRITE_PAINT_FEATURE_LEVEL, type GlyphRunDesc } from "../src/core/types.js";

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

function run(text: string): { run: GlyphRunDesc; width: number } {
  const cps = [...text].map((c) => c.codePointAt(0)!);
  const gids = face.getGlyphIndices(cps);
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / fm.designUnitsPerEm) * emSize);
  return {
    run: { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances },
    width: advances.reduce((a, b) => a + b, 0),
  };
}

const line = run("Color! 😁🎨🚀❤️🌈");
const W = Math.ceil(line.width) + margin * 2;
const H = Math.ceil(ascentPx + descentPx) + margin * 2;

using target = interop.createBitmapRenderTarget(0, W, H);

// Probe: confirm the object really is an RT3.
const rt3 = target.queryInterface(IID_IDWriteBitmapRenderTarget3, IDWriteBitmapRenderTarget.from);
if (!rt3) {
  console.log("QI(IDWriteBitmapRenderTarget3) -> E_NOINTERFACE; RT3 not supported by this DWriteCore build.");
  process.exit(1);
}
using _rt3 = rt3;
console.log("QI(IDWriteBitmapRenderTarget3) -> OK");
console.log("GetPaintFeatureLevel ->", DWRITE_PAINT_FEATURE_LEVEL[rt3.paintFeatureLevel]);

// Pre-fill white; the color draw blends over it.
target.pixels().data.fill(0x00ffffff);

rt3.drawGlyphRunWithColorSupport({
  baselineOriginX: margin,
  baselineOriginY: ascentPx + margin,
  run: line.run,
  renderingParams: params,
  color: colorref(0x20, 0x20, 0x20), // text color used for glyphs that reference foreground
  measuringMode: DWRITE_MEASURING_MODE.NATURAL,
});

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
await snapshot("color_rt3", canvas.toBuffer("image/png"));
