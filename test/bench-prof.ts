import { createCanvas } from "@napi-rs/canvas";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { BasicTextRenderer } from "../src/util/canvas-basic-renderer.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";
import { CanvasPathTextRenderer } from "../src/util/canvas-path-renderer.js";

// Single-config tight loop for the V8 sampling profiler:
//   node --prof dist/test/bench-prof.js Path times 24 2000
//   COLOR=1 node --prof dist/test/bench-prof.js Bitmap seguiemj 32 1500   # emoji/colour-glyph path
//   node --prof-process isolate-*.log > prof.txt
const [, , KIND = "Path", FONTFILE = "times", SIZE = "24", N = "2000"] = process.argv;
const COLOR = process.env.COLOR === "1";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
// The colour path needs the emoji font; pair it with a text face so non-emoji shapes too.
using collection = factory.createFontCollection(
  COLOR ? ["/local/fonts/segoeui.ttf", "/local/fonts/SEGUIEMJ.TTF"] : [`/local/fonts/${FONTFILE}.ttf`]);

const W = 820, H = 620;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = "#101010";

const PARAGRAPH = COLOR
  ? "Status \u{1F308} shipping \u{1F680} love ❤️ fire \u{1F525} party \u{1F389} stars ⭐ rocket \u{1F680} " +
    "team \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} done ✅ hot \u{1F525} cool \u{1F60E} go \u{1F3C1}"
  : "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! " +
    "Sphinx of black quartz, judge my vow. How vexingly quick daft zebras jump; the five " +
    "boxing wizards jump quickly. Crwth, fjord-bank glyphs vext quiz.";
using fmt = factory.createTextFormat(COLOR ? "Segoe UI Emoji" : collection.getFamilyNames()[0]!, { fontCollection: collection, fontSize: Number(SIZE) });
using layout = factory.createTextLayout(PARAGRAPH, fmt, W - 40, H - 40);

using renderer =
  KIND === "Basic" ? new BasicTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas })
    : KIND === "Bitmap" ? new CanvasBitmapTextRenderer(factory, canvas, ctx, { colorGlyphs: COLOR, offscreenFactory: createCanvas })
      : new CanvasPathTextRenderer(factory, ctx);

const n = Number(N);
const t0 = process.hrtime.bigint();
for (let i = 0; i < n; i++) layout.draw(renderer, 20, 20);
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(`RESULT: ${KIND} ${FONTFILE} ${SIZE} x${n} = ${(ms / n).toFixed(4)} ms/draw (${ms.toFixed(0)} ms total)`);
