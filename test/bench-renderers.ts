import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { BasicTextRenderer } from "../src/util/canvas-basic-renderer.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";
import { CanvasPathTextRenderer } from "../src/util/canvas-path-renderer.js";
import type { IDWriteTextLayout } from "../src/interfaces/IDWriteTextLayout.js";

// Comprehensive micro-benchmark for the three canvas text renderers. NOT a pass/fail test (excluded
// from run-all): it prints a timing table so optimisation work can be compared before/after.
//
//   node dist/test/bench-renderers.js            # full matrix
//   BENCH_ITERS=400 node dist/test/bench-renderers.js
//
// Each row redraws a fixed multi-line paragraph many times through a pre-constructed renderer, so we
// measure the steady-state per-frame draw cost (the JS glyph-processing + blend glue we can optimise),
// not one-off construction. We report the BEST (min) ms/draw across timed batches — the least
// noise-prone estimator — plus a grand total used as the headline before/after number.

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const ITERS = Number(process.env.BENCH_ITERS ?? 50);
const WARMUP = Math.max(5, ITERS >> 3);
const BATCHES = 2;

// A paragraph with mixed case, punctuation and digits so each line shapes into a non-trivial run.
const PARAGRAPH =
  "The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs! " +
  "Sphinx of black quartz, judge my vow (1234567890). How vexingly quick daft zebras jump; " +
  "the five boxing wizards jump quickly. Crwth, fjord-bank glyphs vext quiz — 0x1F.";

// One collection per font file so getFamilyNames()[0] names exactly that face for createTextFormat.
const FONT_FILES: Record<string, string> = {
  "Segoe UI": "/local/fonts/segoeui.ttf",
  "Arial": "/local/fonts/arial.ttf",
  "Times New Roman": "/local/fonts/times.ttf",
  "Comic Sans MS": "/local/fonts/comicbd.ttf",
  "Tahoma": "/local/fonts/tahoma.ttf",
};
const SIZES = [12, 16, 24, 48, 96];

interface Cfg {
  renderer: "Basic" | "Bitmap" | "Path";
  font: string;
  size: number;
  fill: "opaque" | "alpha" | "gradient";
}

// Keep the matrix tractable: every renderer over every font/size with an opaque fill, plus a couple
// of fill-style variants (alpha for all, gradient for the two that support it).
const fonts = Object.keys(FONT_FILES);
const configs: Cfg[] = [];
for (const renderer of ["Basic", "Bitmap", "Path"] as const)
  for (const font of fonts)
    for (const size of SIZES)
      configs.push({ renderer, font, size, fill: "opaque" });
// Fill-style coverage on a single representative font/size so the table stays readable.
for (const renderer of ["Basic", "Bitmap", "Path"] as const)
  configs.push({ renderer, font: "Segoe UI", size: 24, fill: "alpha" });
for (const renderer of ["Bitmap", "Path"] as const)
  configs.push({ renderer, font: "Segoe UI", size: 24, fill: "gradient" });

const collections = new Map<string, ReturnType<typeof factory.createFontCollection>>();
const familyOf = new Map<string, string>();
for (const [name, path] of Object.entries(FONT_FILES)) {
  const col = factory.createFontCollection([path]);
  collections.set(name, col);
  familyOf.set(name, col.getFamilyNames()[0] ?? name);
}

const W = 820, H = 620;

function makeLayout(font: string, size: number): IDWriteTextLayout {
  const fmt = factory.createTextFormat(familyOf.get(font)!, { fontCollection: collections.get(font)!, fontSize: size });
  return factory.createTextLayout(PARAGRAPH, fmt, W - 40, H - 40);
}

function setFill(ctx: ReturnType<Canvas["getContext"]>, fill: Cfg["fill"]): void {
  ctx.globalAlpha = 1;
  if (fill === "opaque") {
    ctx.fillStyle = "#101010";
  } else if (fill === "alpha") {
    ctx.fillStyle = "rgb(16,16,16)";
    ctx.globalAlpha = 0.5;
  } else {
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "#ff0066");
    g.addColorStop(1, "#00ccff");
    ctx.fillStyle = g;
  }
}

function bench(cfg: Cfg): { ms: number; ips: number } {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fafafa";
  ctx.fillRect(0, 0, W, H);

  using layout = makeLayout(cfg.font, cfg.size);

  const makeRenderer = () => {
    if (cfg.renderer === "Basic") return new BasicTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
    if (cfg.renderer === "Bitmap") return new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
    return new CanvasPathTextRenderer(factory, ctx);
  };

  using renderer = makeRenderer();
  setFill(ctx, cfg.fill);

  for (let i = 0; i < WARMUP; i++) layout.draw(renderer, 20, 20);

  let best = Infinity;
  for (let b = 0; b < BATCHES; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITERS; i++) layout.draw(renderer, 20, 20);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    best = Math.min(best, ms);
  }
  return { ms: best / ITERS, ips: ITERS / (best / 1000) };
}

console.log(`bench: ${ITERS} iters x ${BATCHES} batches (best-of), warmup ${WARMUP}\n`);
console.log(`${"Renderer".padEnd(9)} ${"Font".padEnd(16)} ${"Size".padStart(4)} ${"Fill".padEnd(8)} ${"ms/draw".padStart(9)} ${"draws/s".padStart(9)}`);
console.log("-".repeat(62));

// @napi-rs/canvas retains native image buffers that V8's GC under-accounts for, so reclaim between
// configs when run with --expose-gc to keep RSS bounded over the full matrix.
const gc: undefined | (() => void) = (globalThis as { gc?: () => void }).gc;

let total = 0;
const byRenderer = new Map<string, number>();
for (const cfg of configs) {
  const { ms, ips } = bench(cfg);
  gc?.();
  total += ms;
  byRenderer.set(cfg.renderer, (byRenderer.get(cfg.renderer) ?? 0) + ms);
  console.log(
    `${cfg.renderer.padEnd(9)} ${cfg.font.padEnd(16)} ${String(cfg.size).padStart(4)} ${cfg.fill.padEnd(8)} ${ms.toFixed(4).padStart(9)} ${ips.toFixed(0).padStart(9)}`);
}

console.log("-".repeat(62));
for (const [r, sum] of byRenderer) console.log(`${`subtotal ${r}`.padEnd(40)} ${sum.toFixed(4).padStart(9)} ms`);
console.log(`${"GRAND TOTAL (sum of ms/draw)".padEnd(40)} ${total.toFixed(4).padStart(9)} ms`);
console.log(`\nRESULT: total ${total.toFixed(3)} ms across ${configs.length} configs`);
