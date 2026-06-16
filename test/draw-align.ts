import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_TEXT_ALIGNMENT, DWRITE_WORD_WRAPPING } from "../src/core/types.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 520, H = 360, boxW = W - 40;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);
using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 20 });

using dw = new TextCanvas(factory, ctx);

const sample = "DirectWriteCore alignment: the quick brown fox jumps over the lazy dog.";
const blocks: [string, DWRITE_TEXT_ALIGNMENT][] = [
  ["LEADING", DWRITE_TEXT_ALIGNMENT.LEADING],
  ["CENTER", DWRITE_TEXT_ALIGNMENT.CENTER],
  ["TRAILING", DWRITE_TEXT_ALIGNMENT.TRAILING],
  ["JUSTIFIED", DWRITE_TEXT_ALIGNMENT.JUSTIFIED],
];

let y = 16;
for (const [label, align] of blocks) {
  using layout = factory.createTextLayout(`[${label}] ${sample}`, format, boxW, 80);
  layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;
  layout.textAlignment = align;
  // sanity: read it back
  if (layout.textAlignment !== align) throw new Error(`alignment round-trip failed for ${label}`);
  dw.drawLayout(layout, { x: 20, y, color: [0x1a, 0x2b, 0x55, 1] });
  y += 84;
}

await snapshot("align", canvas.toBuffer("image/png"));
