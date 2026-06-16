import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 600, H = 220;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

// Include the emoji font so the layout's font fallback can shape emoji code points
// (ZWJ sequences / variation selectors) onto Segoe UI Emoji.
using collection = factory.createFontCollection([
  "/local/fonts/segoeui.ttf",
  "/local/fonts/seguiemj.ttf",
]);
console.log("families:", collection.getFamilyNames().join(", "));

using format = factory.createTextFormat("Segoe UI Emoji", { fontCollection: collection, fontSize: 34 });
using layout = factory.createTextLayout(
  "Color text! 👨‍👩‍👧‍👦 ❤️ 🌈 🚀 via IDWriteTextLayout",
  format, W - 40, H - 40,
);

using dw = new TextCanvas(factory, ctx);
dw.drawLayout(layout, { x: 20, y: 20, color: [0x18, 0x18, 0x18 , 1], colorGlyphs: true });

await snapshot("color_layout", canvas.toBuffer("image/png"));
