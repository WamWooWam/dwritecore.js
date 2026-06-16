import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { colorref } from "../src/core/types.js";
import { TextRenderer } from "../src/util/text-renderer.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using interop = factory.getGdiInterop();
using params = factory.createRenderingParams();

// Build a real font collection so the layout shapes with actual glyphs (the system
// collection is empty -> would otherwise fall back to last-resort .notdef boxes).
using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);
const family = collection.getFamilyNames()[0]!;
console.log("collection family:", family);

using format = factory.createTextFormat(family, { fontCollection: collection, fontSize: 28 });
const text =
  "DirectWriteCore laid this paragraph out — line breaking, wrapping, the works — " +
  "then drew it through a JS IDWriteTextRenderer whose DrawGlyphRun forwards each run " +
  "to an in-memory bitmap. From wasm, back into JavaScript, onto a canvas.";

const maxW = 480;
const maxH = 400;
using layout = factory.createTextLayout(text, format, maxW, maxH);
const m = layout.getMetrics();
const H = Math.ceil(m.height) + 24;
console.log(`layout: ${Math.ceil(m.width)}x${Math.ceil(m.height)}, ${m.lineCount} lines`);

using target = interop.createBitmapRenderTarget(0, maxW, H);
target.pixels().data.fill(0x00ffffff); // white background

using renderer = new TextRenderer(abi);
renderer.render(layout, { target, params, color: colorref(0x1b, 0x1b, 0x2b) }, 12, 12);

const { width, height, data } = target.pixels();
const canvas = createCanvas(width, height);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(width, height);
for (let i = 0; i < width * height; i++) {
  const v = data[i]!;
  img.data[i * 4 + 0] = (v >>> 16) & 0xff;
  img.data[i * 4 + 1] = (v >>> 8) & 0xff;
  img.data[i * 4 + 2] = v & 0xff;
  img.data[i * 4 + 3] = 255;
}
ctx.putImageData(img, 0, 0);
await snapshot("layout", canvas.toBuffer("image/png"));
