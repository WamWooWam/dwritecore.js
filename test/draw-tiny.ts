import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory, DWRITE_RENDERING_MODE, IID_IDWriteFactory, DWRITE_FACTORY_TYPE } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi, IID_IDWriteFactory, DWRITE_FACTORY_TYPE.ISOLATED);

const NINE_POINT = (11 / 72) * 96;

const canvas = createCanvas(560, 280);
const ctx = canvas.getContext("2d");
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, 560, 280);

using collection = factory.createFontCollection(["/local/fonts/times.ttf"]);
console.log("families:", collection.getFamilyNames().join(", "));

using body = factory.createTextFormat("Times New Roman", { fontCollection: collection, fontSize: NINE_POINT });
using params = factory.createCustomRenderingParams({ renderingMode: DWRITE_RENDERING_MODE.ALIASED });

// GDI-compatible layout (GDI_CLASSIC measuring): advances quantize to whole pixels, so
// small aliased text is evenly spaced. Plain CreateTextLayout (NATURAL measuring) places
// glyphs at fractional positions that snap unevenly to the pixel grid.
using bodyLayout = factory.createGdiCompatibleTextLayout(
  "This string is nice, small, and aliased, but perfectly legible because DirectWrite understands how to hint these shitty old fonts!",
  body, 520, 160, 1, false,
);

using dw = new TextCanvas(factory, ctx, params);
dw.drawLayout(bodyLayout, { x: 10, y: 10, color: [0, 0, 0 , 1] });

await snapshot("tiny", canvas.toBuffer("image/png"));