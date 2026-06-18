import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";

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

const text = "Color text! 👨‍👩‍👧‍👦 ❤️ 🌈 🚀 via IDWriteTextLayout";
using format = factory.createTextFormat("Segoe UI Emoji", { fontCollection: collection, fontSize: 34 });
using layout = factory.createTextLayout(
    text,
    format, W - 40, H - 40,
);

layout.setUnderline(true, { startPosition: text.length - 18, length: 18 })

// using dw = new TextCanvas(factory, ctx);
// dw.drawLayout(layout, { x: 20, y: 20, color: [0x18, 0x18, 0x18 , 1], colorGlyphs: true });

using renderer = new CanvasBitmapTextRenderer(
    factory, canvas, ctx, { colorGlyphs: true, offscreenFactory: createCanvas })
ctx.fillStyle = "#000000";
layout.draw(renderer, 20, 20);

ctx.save();
ctx.translate(375, 0);
ctx.rotate(Math.PI / 5)
// ctx.translate(-150, 0);
ctx.translate(20, 80);
ctx.scale(0.5, 0.5);

layout.draw(renderer, 0, 0);
ctx.restore();

ctx.save();
ctx.translate(20, 120);
ctx.scale(0.5, 0.5);

ctx.fillStyle = "rgb(255, 0, 0)";
ctx.globalAlpha = 0.5;
layout.draw(renderer, 0, 0);
ctx.restore();




await snapshot("color_layout_modern", canvas.toBuffer("image/png"));
