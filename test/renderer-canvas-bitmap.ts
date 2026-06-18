import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";

// The win of the coverage-mask renderer over the old over-white bitmap path only shows on a
// NON-white background: the old path bakes white into antialiased edges, leaving haloes. Here we
// render onto mid-gray and assert numerically that there is no halo and that opacity is honoured.

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 400, H = 130;
const BG = 128; // mid-gray
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = `rgb(${BG},${BG},${BG})`;
ctx.fillRect(0, 0, W, H);

using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);
using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 44 });
using layout = factory.createTextLayout("Halo?", format, W, H);

using renderer = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });

ctx.fillStyle = "#000000";          // opaque black, rows ~5..60
layout.draw(renderer, 12, 8);

ctx.fillStyle = "rgb(255,0,0)";     // half-opacity red, rows ~70..125
ctx.globalAlpha = 0.5;
layout.draw(renderer, 12, 68);
ctx.globalAlpha = 1;

const { data } = ctx.getImageData(0, 0, W, H);
const at = (x: number, y: number) => { const i = (y * W + x) * 4; return [data[i]!, data[i + 1]!, data[i + 2]!] as const; };

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) fail++; };

// 1. No halo on the black band: black-on-gray antialiasing can only DARKEN the background, so no
//    pixel may exceed BG by more than codec/rounding noise. The old over-white path pushes edge
//    pixels toward white (brighter than BG) - that is exactly what this catches.
let brightestBlackBand = 0, darkestBlackBand = 255;
for (let y = 0; y < 62; y++) for (let x = 0; x < W; x++) {
  const [r, g, b] = at(x, y);
  brightestBlackBand = Math.max(brightestBlackBand, r, g, b);
  darkestBlackBand = Math.min(darkestBlackBand, r, g, b);
}
check(brightestBlackBand <= BG + 3, `no white halo: brightest black-band channel ${brightestBlackBand} <= ${BG + 3}`);
check(darkestBlackBand <= 12, `black text actually rendered: darkest black-band channel ${darkestBlackBand} <= 12`);

// 2. Opacity honoured on the red band: the most-covered pixel (lowest green) should land halfway
//    between gray and red -> R≈191, G≈64, B≈64. Validates 0.5 alpha AND the tint colour.
let minG = 255, mx = 0, my = 0;
for (let y = 62; y < H; y++) for (let x = 0; x < W; x++) {
  const g = at(x, y)[1];
  if (g < minG) { minG = g; mx = x; my = y; }
}
const [pr, pg, pb] = at(mx, my);
const near = (v: number, t: number) => Math.abs(v - t) <= 14;
check(near(pr, 191) && near(pg, 64) && near(pb, 64),
  `red @50% over gray at (${mx},${my}) = [${pr},${pg},${pb}] ~ [191,64,64]`);

await snapshot("renderer_halo_gray", canvas.toBuffer("image/png"));

if (fail) { console.error(`${fail} check(s) failed`); process.exit(1); }
