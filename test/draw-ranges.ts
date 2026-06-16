import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_FONT_WEIGHT, DWRITE_FONT_STYLE, DWRITE_WORD_WRAPPING } from "../src/core/types.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 560, H = 160;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

// Need bold + italic faces in the collection for weight/style to resolve to real glyphs.
using collection = factory.createFontCollection([
  "/local/fonts/segoeui.ttf", "/local/fonts/segoeuib.ttf", "/local/fonts/segoeuii.ttf",
]);
using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 26 });

const text = "Normal, bold, italic, big, underlined.";
using layout = factory.createTextLayout(text, format, W - 40, H - 40);
layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;

const at = (sub: string) => ({ startPosition: text.indexOf(sub), length: sub.length });

layout.setFontWeight(DWRITE_FONT_WEIGHT.BOLD, at("bold"));
layout.setFontStyle(DWRITE_FONT_STYLE.ITALIC, at("italic"));
layout.setFontSize(40, at("big"));
layout.setUnderline(true, at("underlined"));

// Verify the by-value DWRITE_TEXT_RANGE ABI actually took: read the weight back inside
// "bold" and just before it.
const boldPos = text.indexOf("bold") + 1;
const normPos = text.indexOf("Normal") + 1;
console.log("weight @bold =", DWRITE_FONT_WEIGHT[layout.getFontWeightAt(boldPos)],
            "| weight @normal =", DWRITE_FONT_WEIGHT[layout.getFontWeightAt(normPos)]);
if (layout.getFontWeightAt(boldPos) !== DWRITE_FONT_WEIGHT.BOLD)
  throw new Error("per-range SetFontWeight did NOT apply, DWRITE_TEXT_RANGE ABI is wrong");

using dw = new TextCanvas(factory, ctx);
dw.drawLayout(layout, { x: 20, y: 20, color: [0x1a, 0x1a, 0x1a , 1] });

await snapshot("ranges", canvas.toBuffer("image/png"));
