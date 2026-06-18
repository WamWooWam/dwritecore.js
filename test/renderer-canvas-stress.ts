import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { CanvasBitmapTextRenderer } from "../src/util/canvas-bitmap-renderer.js";
import type { RGBA } from "../src/util/canvas.js";

// Hammer the coverage-mask renderer: overlapping alpha-blended runs, emoji + text mixed, and every
// kind of transform. Part 1 makes controlled, numerically-verifiable assertions (a solid square
// glyph gives exact coverage); Part 2 is an intentionally whacky composite, checked by snapshot.

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

using collection = factory.createFontCollection([
  "/local/fonts/segoeui.ttf",
  "/local/fonts/seguiemj.ttf",
]);

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) fail++; };
const near = (v: number, t: number, tol = 14) => Math.abs(v - t) <= tol;

function freshCanvas(w: number, h: number, bg?: string): { canvas: Canvas; ctx: ReturnType<Canvas["getContext"]> } {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  return { canvas, ctx };
}

// The renderer now paints with the live ctx fillStyle + globalAlpha (like fillText), so callers set
// the colour on the context, not on the renderer.
const setFill = (ctx: ReturnType<Canvas["getContext"]>, [r, g, b, a]: RGBA) => {
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.globalAlpha = a;
};

// A solid filled square (U+25A0) - its interior is fully covered, so sampling it reads back the
// composite result exactly.
using sqFormat = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 90 });
using sqLayout = factory.createTextLayout("■", sqFormat, 1000, 1000);

function pixels(ctx: ReturnType<Canvas["getContext"]>, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data;
  return {
    d,
    at: (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 3]!] as const; },
  };
}

// ============================ Part 1: controlled numeric invariants ============================

// --- 1a. Opacity STACKING: two 50%-black squares over white -> 255*0.5*0.5 = ~64 ---------------
{
  const W = 160, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "#ffffff");
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
  setFill(ctx, [0, 0, 0, 0.5]);
  sqLayout.draw(r, 20, 0);
  sqLayout.draw(r, 20, 0); // exact overlap
  const { d } = pixels(ctx, W, H);
  let min = 255;
  for (let i = 0; i < d.length; i += 4) min = Math.min(min, d[i]!, d[i + 1]!, d[i + 2]!);
  check(near(min, 64, 6), `opacity stacking (2x 50% black over white): darkest = ${min} ~ 64`);
}

// --- 1b. COLOUR-over-colour: red @50% over solid blue -> [128, 0, 128] -------------------------
{
  const W = 160, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "rgb(0,0,255)");
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
  setFill(ctx, [255, 0, 0, 0.5]);
  sqLayout.draw(r, 20, 0);
  const { d, at } = pixels(ctx, W, H);
  let maxR = 0, mi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! > maxR) { maxR = d[i]!; mi = i / 4; }
  const [pr, pg, pb] = at(mi % W, (mi / W) | 0);
  check(near(pr, 128) && near(pg, 0) && near(pb, 128), `red@50% over blue = [${pr},${pg},${pb}] ~ [128,0,128]`);
}

// --- 1c. TRANSFORM: opaque black square, rotated + scaled, over gray -> solid & no halo --------
{
  const W = 240, H = 240, BG = 128;
  const { canvas, ctx } = freshCanvas(W, H, `rgb(${BG},${BG},${BG})`);
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
  ctx.save();
  ctx.translate(120, 120);
  ctx.rotate(Math.PI / 6);
  ctx.scale(1.4, 0.8);
  setFill(ctx, [0, 0, 0, 1]);
  sqLayout.draw(r, -45, -60);
  ctx.restore();
  const { d } = pixels(ctx, W, H);
  let min = 255, max = 0;
  for (let i = 0; i < d.length; i += 4) {
    min = Math.min(min, d[i]!, d[i + 1]!, d[i + 2]!);
    max = Math.max(max, d[i]!, d[i + 1]!, d[i + 2]!);
  }
  check(min <= 6, `transformed solid square renders fully covered: darkest = ${min} <= 6`);
  check(max <= BG + 3, `no halo under transform: brightest = ${max} <= ${BG + 3}`);
}

// --- 1d. EMOJI alpha: colour emoji over a distinctive bg must NOT paint a white box ------------
{
  const W = 160, H = 160;
  const BG: RGBA = [0, 80, 80, 1]; // dark teal
  const { canvas, ctx } = freshCanvas(W, H, `rgb(${BG[0]},${BG[1]},${BG[2]})`);
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { colorGlyphs: true, offscreenFactory: createCanvas });
  using emFormat = factory.createTextFormat("Segoe UI Emoji", { fontCollection: collection, fontSize: 96 });
  using emLayout = factory.createTextLayout("\u{1F308}", emFormat, 1000, 1000); // 🌈
  setFill(ctx, [0, 0, 0, 1]);
  emLayout.draw(r, 24, 8);

  const { d, at } = pixels(ctx, W, H);
  const isBg = (x: number, y: number) => { const [r2, g, b] = at(x, y); return near(r2, BG[0], 8) && near(g, BG[1], 8) && near(b, BG[2], 8); };
  // Bounding box of changed pixels, and how many INSIDE it stayed background (a white box -> ~0).
  let x0 = W, y0 = H, x1 = 0, y1 = 0, changed = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isBg(x, y)) { changed++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  let bgInside = 0, area = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { area++; if (isBg(x, y)) bgInside++; }
  check(changed > 800, `emoji rendered: ${changed} non-bg px`);
  check(area > 0 && bgInside / area > 0.1, `no white box: ${(100 * bgInside / area).toFixed(1)}% of emoji bbox is still bg (transparent gaps preserved)`);
  // Brightest must be a real emoji highlight, not a uniform whitewash: corners stay teal.
  check(isBg(x0, y0) || isBg(x1, y0) || isBg(x0, y1) || isBg(x1, y1), `>=1 emoji bbox corner is transparent (still bg)`);
}

// --- 1e. Opaque over translucent: a later opaque run fully replaces an earlier 50% run ---------
{
  const W = 160, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "#ffffff");
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
  setFill(ctx, [255, 0, 0, 0.5]);
  sqLayout.draw(r, 20, 0);
  setFill(ctx, [0, 128, 0, 1]); // opaque green over the same square
  sqLayout.draw(r, 20, 0);
  const { d, at } = pixels(ctx, W, H);
  let bestScore = -1e9, mi = 0; // most green-dominant pixel (white bg has high G too, so use G-R-B)
  for (let i = 0; i < d.length; i += 4) { const s = d[i + 1]! - d[i]! - d[i + 2]!; if (s > bestScore) { bestScore = s; mi = i / 4; } }
  const [pr, pg, pb] = at(mi % W, (mi / W) | 0);
  check(near(pr, 0) && near(pg, 128) && near(pb, 0), `opaque green over 50% red = [${pr},${pg},${pb}] ~ [0,128,0]`);
}

// --- 1f. GRADIENT fill through the coverage mask: glyph picks up a left->right red->blue ramp ---
{
  const W = 200, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "#ffffff");
  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { offscreenFactory: createCanvas });
  const grad = ctx.createLinearGradient(40, 0, 112, 0); // ramp across the square's own extent
  grad.addColorStop(0, "rgb(255,0,0)");
  grad.addColorStop(1, "rgb(0,0,255)");
  ctx.fillStyle = grad;
  sqLayout.draw(r, 40, 0); // a solid square spans the ramp

  const { at } = pixels(ctx, W, H);
  // Find the covered (non-white) span at mid-height, then sample SOLID interior columns at 30% and
  // 70% across it - not the extreme columns, which are antialiased edges blended with the white bg.
  const midY = 60;
  const covered: number[] = [];
  for (let x = 0; x < W; x++) { const [cr, cg, cb] = at(x, midY); if (cr < 235 || cg < 235 || cb < 235) covered.push(x); }
  const lx = covered[Math.floor(covered.length * 0.3)] ?? -1;
  const rx = covered[Math.floor(covered.length * 0.7)] ?? -1;
  const [lr, , lb] = at(lx, midY);
  const [rr, , rb] = at(rx, midY);
  check(lx >= 0 && lr > lb + 40, `gradient interior is red on the left: [${lr},_,${lb}]`);
  check(rx >= 0 && rb > rr + 40, `gradient interior is blue on the right: [${rr},_,${rb}]`);
  check(rb > lb && lr > rr, `gradient ramps left->right (red falls ${lr}->${rr}, blue rises ${lb}->${rb})`);
}

// ============================ Part 2: whacky overlapping composite =============================
{
  const W = 760, H = 460;
  const { canvas, ctx } = freshCanvas(W, H, "#fdfdfd");

  // A few colour zones so blending-over-non-white is visible everywhere.
  const zones: [string, number, number, number, number][] = [
    ["#ffe8d6", 0, 0, W / 2, H / 2],
    ["#d8f3dc", W / 2, 0, W / 2, H / 2],
    ["#dbe7ff", 0, H / 2, W / 2, H / 2],
    ["#f0d8ff", W / 2, H / 2, W / 2, H / 2],
  ];
  for (const [c, x, y, w, h] of zones) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

  using format = factory.createTextFormat("Segoe UI Emoji", { fontCollection: collection, fontSize: 40 });
  const text = "Whacky! \u{1F308}\u{1F525}\u{1F680}❤️";
  using layout = factory.createTextLayout(text, format, 420, 200);
  layout.setUnderline(true, { startPosition: 0, length: 7 });
  layout.setStrikethrough(true, { startPosition: 0, length: 7 });

  using r = new CanvasBitmapTextRenderer(factory, canvas, ctx, { colorGlyphs: true, offscreenFactory: createCanvas });

  // A pile of overlapping passes: rotation, scale, skew, mirror, all alpha-blended on top of each
  // other and over the colour zones.
  const passes: { color: RGBA; setup: () => void }[] = [
    { color: [20, 20, 20, 0.9], setup: () => { ctx.translate(40, 70); } },
    { color: [220, 30, 90, 0.5], setup: () => { ctx.translate(380, 90); ctx.rotate(Math.PI / 7); ctx.scale(0.9, 0.9); } },
    { color: [30, 120, 220, 0.5], setup: () => { ctx.translate(80, 250); ctx.rotate(-Math.PI / 9); ctx.scale(1.1, 1.1); } },
    { color: [240, 140, 0, 0.45], setup: () => { ctx.translate(330, 300); ctx.transform(1, 0, -0.5, 1, 0, 0); } }, // skew
    { color: [10, 160, 90, 0.5], setup: () => { ctx.translate(120, 180); ctx.scale(1.6, 0.7); } },
    { color: [150, 30, 200, 0.45], setup: () => { ctx.translate(540, 230); ctx.rotate(Math.PI / 2.5); ctx.scale(0.8, 0.8); } },
    { color: [200, 0, 0, 0.4], setup: () => { ctx.translate(60, 410); ctx.scale(1.3, 1.3); } },
    { color: [0, 0, 0, 0.6], setup: () => { ctx.translate(700, 420); ctx.rotate(Math.PI); ctx.scale(0.85, 0.85); } }, // upside down
    { color: [0, 150, 150, 0.5], setup: () => { ctx.translate(420, 40); ctx.transform(1, 0.35, 0, 1, 0, 0); } }, // vertical shear
  ];

  for (const p of passes) {
    ctx.save();
    p.setup();
    setFill(ctx, p.color);
    layout.draw(r, 0, 0);
    ctx.restore();
  }

  // A gradient-filled pass to show fillStyle-through-mask working in the wild.
  ctx.save();
  ctx.translate(170, 360);
  ctx.rotate(-Math.PI / 12);
  ctx.scale(1.5, 1.5);
  ctx.globalAlpha = 0.85;
  const grad = ctx.createLinearGradient(0, 0, 260, 0);
  grad.addColorStop(0, "#ff0066");
  grad.addColorStop(0.5, "#ffcc00");
  grad.addColorStop(1, "#00ccff");
  ctx.fillStyle = grad;
  layout.draw(r, 0, 0);
  ctx.restore();

  // Sanity: the composite must not be blank and must not have washed everything to white.
  const { d } = pixels(ctx, W, H);
  let nonBg = 0, white = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r2 = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    if (r2 < 250 || g < 250 || b < 250) nonBg++;
    if (r2 > 252 && g > 252 && b > 252) white++;
  }
  check(nonBg > W * H * 0.3, `whacky composite has lots of content: ${(100 * nonBg / (W * H)).toFixed(0)}% non-white`);
  check(white < W * H * 0.2, `whacky composite not whitewashed: ${(100 * white / (W * H)).toFixed(0)}% near-white`);

  await snapshot("renderer_whacky", canvas.toBuffer("image/png"));
}

if (fail) { console.error(`\n${fail} check(s) failed`); process.exit(1); }
else console.log(`\nall stress checks passed`);
