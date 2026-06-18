import { createCanvas } from "@napi-rs/canvas";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { BasicTextRenderer } from "../src/util/canvas-basic-renderer.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";
import { CanvasPathTextRenderer } from "../src/util/canvas-path-renderer.js";

// Bounded leak probe: draw a small number of times per renderer, sample process memory between rounds
// and force GC, so we can tell native-buffer CHURN (reclaimed by gc) from a true retained LEAK, and
// see which channel grows (external/arrayBuffers => napi-rs canvas buffers; heapUsed => JS objects;
// wasm memory pages are reported separately). Run with: node --expose-gc dist/test/bench-leakprobe.js
const gc: undefined | (() => void) = (globalThis as { gc?: () => void }).gc;
if (!gc) console.warn("run with --expose-gc for retained-vs-churn measurement\n");

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);

const W = 820, H = 620;
const PARAGRAPH =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! " +
  "Sphinx of black quartz, judge my vow. How vexingly quick daft zebras jump; the five " +
  "boxing wizards jump quickly. Crwth, fjord-bank glyphs vext quiz.";

const MB = (n: number) => (n / 1048576).toFixed(1).padStart(8);
function mem(label: string): void {
  const m = process.memoryUsage();
  const wasmPages = abi.memory.buffer.byteLength;
  console.log(`  ${label.padEnd(14)} rss=${MB(m.rss)}  heapUsed=${MB(m.heapUsed)}  external=${MB(m.external)}  arrayBuffers=${MB(m.arrayBuffers)}  wasm=${MB(wasmPages)}`);
}

type Kind = "Basic" | "Bitmap" | "Path";
function probe(kind: Kind, rounds = 4, perRound = 40): void {
  console.log(`\n== ${kind} ==`);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fafafa"; ctx.fillRect(0, 0, W, H);
  using fmt = factory.createTextFormat(collection.getFamilyNames()[0]!, { fontCollection: collection, fontSize: 24 });
  using layout = factory.createTextLayout(PARAGRAPH, fmt, W - 40, H - 40);

  using renderer =
    kind === "Basic" ? new BasicTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas })
      : kind === "Bitmap" ? new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas })
        : new CanvasPathTextRenderer(factory, ctx);
  ctx.fillStyle = "#101010";

  layout.draw(renderer, 20, 20); // prime
  gc?.(); mem("baseline");
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < perRound; i++) layout.draw(renderer, 20, 20);
    mem(`after ${(r + 1) * perRound} draws`);
  }
  gc?.(); mem("after gc");
}

mem("startup");
probe("Path");
probe("Bitmap");
probe("Basic");
console.log("\nRESULT: leak probe done");
