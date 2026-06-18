import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { BasicTextRenderer } from "../src/util/canvas-basic-renderer.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

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

const canvas = createCanvas(maxW, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff"; // white background
ctx.fillRect(0, 0, maxW, H);

// The JS IDWriteTextRenderer forwards each run's DrawGlyphRun to an in-memory bitmap target, which
// composites over the (mirrored) canvas background and blends back out - all wired up for us.
using renderer = new BasicTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
ctx.fillStyle = "rgb(27, 27, 43)";
layout.draw(renderer, 12, 12);

await snapshot("layout", canvas.toBuffer("image/png"));
