import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_WORD_WRAPPING } from "../src/core/types.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 620, H = 180;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

// Base font is a TEXT font; the emoji must be auto-routed to Segoe UI Emoji by fallback.
using collection = factory.createFontCollection([
  "/local/fonts/segoeui.ttf",
  "/local/fonts/seguiemj.ttf",
]);
using fallback = factory.createEmojiFontFallback(collection); // emoji ranges -> "Segoe UI Emoji"

using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 30 });
using layout = factory.createTextLayout(
  "Mixed text 👨‍👩‍👧‍👦 and emoji ❤️ in 🌈 one 🚀 run, auto-fallback!",
  format, W - 40, H - 40,
);
layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;
layout.fontFallback = fallback;
// null resets to the default fallback; re-assign ours for the actual render.
layout.fontFallback = null;
layout.fontFallback = fallback;
{
  const got = layout.fontFallback;
  console.log("fontFallback set:", got !== null, "matches:", got?.ptr === fallback.ptr);
  got.release();
}

using dw = new TextCanvas(factory, ctx);
dw.drawLayout(layout, { x: 20, y: 20, color: [0x18, 0x18, 0x18 , 1], colorGlyphs: true });

await snapshot("fallback", canvas.toBuffer("image/png"));
