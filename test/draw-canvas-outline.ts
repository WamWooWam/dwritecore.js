// TextCanvas.drawTextOutline: glyph runs painted as VECTOR outlines (fill and/or stroke) straight
// onto the canvas path, rather than as a rasterised ClearType bitmap (drawText/drawLayout). Drives
// IDWriteFontFace::GetGlyphRunOutline -> GeometrySink -> Canvas path inside the wrapper, and shares
// drawText's pen-origin anchoring (x = left, y = top of the line box).
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const canvas = createCanvas(560, 280);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#0e1116";
ctx.fillRect(0, 0, 560, 280);

using dw = new TextCanvas(factory, ctx);
using arial = factory.loadFontFace("/local/fonts/arial.ttf");

// 1. Solid fill (default colour is black, so pass an explicit colour here).
dw.drawTextOutline("Filled", { face: arial, size: 64, x: 28, y: 20, fill: [0x7a, 0xd1, 0xff, 1] });

// 2. Stroke only (no fill) - hollow outlined glyphs.
dw.drawTextOutline("Outlined", { face: arial, size: 64, x: 28, y: 100, fill: false, stroke: [0xff, 0xff, 0xff, 1], lineWidth: 2 });

// 3. Fill + stroke together, and a CSS colour string for the stroke.
dw.drawTextOutline("Both", { face: arial, size: 64, x: 28, y: 180, fill: [0xa2, 0x6b, 0xff, 1], stroke: "#ffffff", lineWidth: 1.5 });

await snapshot("canvas_outline", canvas.toBuffer("image/png"));
