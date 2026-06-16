import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory, DWRITE_RENDERING_MODE, IID_IDWriteFactory, DWRITE_FACTORY_TYPE } from "../src/index.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi, IID_IDWriteFactory, DWRITE_FACTORY_TYPE.ISOLATED);

const NINE_POINT = (11 / 72) * 96;
const W = 560, H = 120;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "white";
ctx.fillRect(0, 0, W, H);

using collection = factory.createFontCollection(["/local/fonts/times.ttf"]);
using body = factory.createTextFormat("Times New Roman", { fontCollection: collection, fontSize: NINE_POINT });
using params = factory.createCustomRenderingParams({ renderingMode: DWRITE_RENDERING_MODE.ALIASED });

const text = "AVAST! To Wave Yo. Type \"perfectly\" — DirectWrite kerns Times.";

// NATURAL measuring (ideal fractional advances; aliased snapping makes spacing uneven).
using natural = factory.createTextLayout(text, body, W - 20, 40);
// GDI_CLASSIC measuring (advances quantized to whole pixels -> even GDI-style spacing).
using gdi = factory.createGdiCompatibleTextLayout(text, body, W - 20, 40, 1, false);

using dw = new TextCanvas(factory, ctx, params);
dw.drawLayout(natural, { x: 10, y: 14, color: [0, 0, 0 , 1] });
dw.drawLayout(gdi, { x: 10, y: 54, color: [0, 0, 0 , 1] });

await snapshot("tiny_compare", canvas.toBuffer("image/png"));
