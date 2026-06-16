import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const canvas = createCanvas(560, 200);
const ctx = canvas.getContext("2d");

// A background, so we can see the text composites over existing canvas content.
const grad = ctx.createLinearGradient(0, 0, 560, 200);
grad.addColorStop(0, "#fdf2c4");
grad.addColorStop(1, "#bfe3ff");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, 560, 200);
ctx.fillStyle = "#1b3a5b";
ctx.fillRect(24, 150, 512, 6);

using dw = new TextCanvas(factory, ctx);
using arial = factory.loadFontFace("/local/fonts/arial.ttf");
using times = factory.loadFontFace("/local/fonts/times.ttf");

dw.drawText("Direct to canvas,", { face: arial, size: 52, x: 28, y: 24, color:  [0xc0, 0x20, 0x20 , 1] });
dw.drawText("via DirectWriteCore.", { face: times, size: 40, x: 28, y: 90, color: [0x12, 0x3a, 0x66 , 1] });

await snapshot("canvas", canvas.toBuffer("image/png"));
