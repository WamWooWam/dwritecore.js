import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const canvas = createCanvas(560, 280);
const ctx = canvas.getContext("2d");
const grad = ctx.createLinearGradient(0, 0, 0, 280);
grad.addColorStop(0, "#ffffff");
grad.addColorStop(1, "#e8eef7");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, 560, 280);

using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf", "/local/fonts/times.ttf"]);
console.log("families:", collection.getFamilyNames().join(", "));

using heading = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 40 });
using body = factory.createTextFormat("Times New Roman", { fontCollection: collection, fontSize: 22 });

using titleLayout = factory.createTextLayout("A cached canvas renderer", heading, 520, 80);
using bodyLayout = factory.createTextLayout(
  "One DWriteCanvas, one cached IDWriteTextRenderer, each drawLayout call reuses it, " +
  "so the indirect table grows only once no matter how many layouts we paint.",
  body, 520, 160,
);

using dw = new TextCanvas(factory, ctx);

const tableBefore = abi.table.length;
dw.drawLayout(titleLayout, { x: 20, y: 18, color: [0x1a, 0x3c, 0x6e , 1] });
const tableMid = abi.table.length;
dw.drawLayout(bodyLayout, { x: 20, y: 96, color: [0x22, 0x22, 0x22 , 1] });
const tableAfter = abi.table.length;

console.log(`table length: ${tableBefore} -> ${tableMid} (1st draw) -> ${tableAfter} (2nd draw)`);
console.log(tableMid === tableAfter ? "renderer REUSED (no extra table growth)" : "renderer NOT cached!");

await snapshot("layout_canvas", canvas.toBuffer("image/png"));
