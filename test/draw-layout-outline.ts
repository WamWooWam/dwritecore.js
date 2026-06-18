// TextCanvas.drawLayoutOutline: a whole IDWriteTextLayout painted as VECTOR outlines. The layout's
// own Draw is driven through a CanvasPathTextRenderer ({ fill, stroke }), so mixed fonts/sizes,
// per-range formatting, wrapping and underlines all get filled/stroked as canvas paths - exercising
// the IDWriteTextRenderer COM callback in the *outline* direction across multiple runs.
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_FONT_WEIGHT, DWRITE_WORD_WRAPPING } from "../src/core/types.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const canvas = createCanvas(560, 280);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#0e1116";
ctx.fillRect(0, 0, 560, 280);

using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf", "/local/fonts/times.ttf"]);
using heading = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 44 });
using body = factory.createTextFormat("Times New Roman", { fontCollection: collection, fontSize: 22 });

const text = "Outlined layouts mix Times and Segoe, wrap, and underline cleanly.";
using titleLayout = factory.createTextLayout("Vector layout", heading, 520, 60);
using bodyLayout = factory.createTextLayout(text, body, 520, 180);
bodyLayout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;
// Per-range formatting survives the outline path: bold one word, underline another.
bodyLayout.setFontWeight(DWRITE_FONT_WEIGHT.BOLD, { startPosition: text.indexOf("Times"), length: 5 });
bodyLayout.setUnderline(true, { startPosition: text.indexOf("Segoe"), length: 5 });

using dw = new TextCanvas(factory, ctx);

// Stroked heading (hollow) + gradient-coloured… well, solid-coloured filled body.
dw.drawLayoutOutline(titleLayout, { x: 20, y: 16, fill: false, stroke: [0x7a, 0xd1, 0xff, 1], lineWidth: 1.5 });
dw.drawLayoutOutline(bodyLayout, { x: 20, y: 90, fill: [0xe8, 0xee, 0xf7, 1], stroke: "#5566aa", lineWidth: 0.75 });

await snapshot("layout_outline", canvas.toBuffer("image/png"));
