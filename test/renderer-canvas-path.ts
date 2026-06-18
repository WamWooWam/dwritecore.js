import { createCanvas, type Canvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { CanvasPathTextRenderer } from "../src/util/canvas-path-renderer.js";
import type { RGBA } from "../src/util/canvas-types.js";

// The outline renderer fills glyph contours straight onto the canvas, so fillStyle, globalAlpha and
// the transform all apply natively. Part 1 checks that numerically with a solid square glyph; Part 2
// snapshots transformed + gradient text.

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);

let fail = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "OK  " : "FAIL"} ${msg}`); if (!ok) fail++; };
const near = (v: number, t: number, tol = 14) => Math.abs(v - t) <= tol;

function freshCanvas(w: number, h: number, bg?: string): { canvas: Canvas; ctx: ReturnType<Canvas["getContext"]> } {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
  return { canvas, ctx };
}
const setFill = (ctx: ReturnType<Canvas["getContext"]>, [r, g, b, a]: RGBA) => {
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.globalAlpha = a;
};
function pixels(ctx: ReturnType<Canvas["getContext"]>, w: number, h: number) {
  const d = ctx.getImageData(0, 0, w, h).data;
  return { d, at: (x: number, y: number) => { const i = (y * w + x) * 4; return [d[i]!, d[i + 1]!, d[i + 2]!] as const; } };
}

// U+25A0 BLACK SQUARE: a solid filled glyph, so its interior reads back the composite exactly.
using sqFormat = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 90 });
using sqLayout = factory.createTextLayout("■", sqFormat, 1000, 1000);

// --- 1a. Opacity stacking: two 50%-black squares over white -> ~64 ----------------------------
{
  const W = 160, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "#ffffff");
  using r = new CanvasPathTextRenderer(factory, ctx);
  setFill(ctx, [0, 0, 0, 0.5]);
  sqLayout.draw(r, 20, 0);
  sqLayout.draw(r, 20, 0);
  const { d } = pixels(ctx, W, H);
  let min = 255;
  for (let i = 0; i < d.length; i += 4) min = Math.min(min, d[i]!, d[i + 1]!, d[i + 2]!);
  check(near(min, 64, 8), `opacity stacking (2x 50% black over white): darkest = ${min} ~ 64`);
}

// --- 1b. Colour over colour: red @50% over blue -> [128,0,128] --------------------------------
{
  const W = 160, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "rgb(0,0,255)");
  using r = new CanvasPathTextRenderer(factory, ctx);
  setFill(ctx, [255, 0, 0, 0.5]);
  sqLayout.draw(r, 20, 0);
  const { d, at } = pixels(ctx, W, H);
  let maxR = 0, mi = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! > maxR) { maxR = d[i]!; mi = i / 4; }
  const [pr, pg, pb] = at(mi % W, (mi / W) | 0);
  check(near(pr, 128) && near(pg, 0) && near(pb, 128), `red@50% over blue = [${pr},${pg},${pb}] ~ [128,0,128]`);
}

// --- 1c. Transform: opaque black square rotated + scaled over gray -> solid & no halo ----------
{
  const W = 240, H = 240, BG = 128;
  const { canvas, ctx } = freshCanvas(W, H, `rgb(${BG},${BG},${BG})`);
  using r = new CanvasPathTextRenderer(factory, ctx);
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
  check(min <= 6, `transformed solid square fully covered: darkest = ${min} <= 6`);
  check(max <= BG + 3, `no halo under transform: brightest = ${max} <= ${BG + 3}`);
}

// --- 1d. Gradient fill: glyph picks up a left->right red->blue ramp ----------------------------
{
  const W = 200, H = 160;
  const { canvas, ctx } = freshCanvas(W, H, "#ffffff");
  using r = new CanvasPathTextRenderer(factory, ctx);
  const grad = ctx.createLinearGradient(40, 0, 112, 0);
  grad.addColorStop(0, "rgb(255,0,0)");
  grad.addColorStop(1, "rgb(0,0,255)");
  ctx.fillStyle = grad;
  sqLayout.draw(r, 40, 0);
  const { at } = pixels(ctx, W, H);
  const midY = 60;
  const covered: number[] = [];
  for (let x = 0; x < W; x++) { const [cr, cg, cb] = at(x, midY); if (cr < 235 || cg < 235 || cb < 235) covered.push(x); }
  const [lr, , lb] = at(covered[Math.floor(covered.length * 0.3)] ?? 0, midY);
  const [rr, , rb] = at(covered[Math.floor(covered.length * 0.7)] ?? 0, midY);
  check(lr > lb + 40, `gradient interior is red on the left: [${lr},_,${lb}]`);
  check(rb > rr + 40, `gradient interior is blue on the right: [${rr},_,${rb}]`);
}

// --- Part 2: visual snapshot (transformed + gradient outline text, underlined) -----------------
{
  const W = 600, H = 280;
  const { canvas, ctx } = freshCanvas(W, H, "#fbfbfb");
  using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 48 });
  using layout = factory.createTextLayout("Outlines!", format, 400, 100);
  layout.setUnderline(true, { startPosition: 0, length: 9 });
  using r = new CanvasPathTextRenderer(factory, ctx);

  setFill(ctx, [20, 20, 20, 1]);
  layout.draw(r, 20, 20);

  ctx.save();
  ctx.translate(40, 110);
  ctx.rotate(Math.PI / 16);
  ctx.scale(2.2, 2.2); // large glyphs: the outline path's sweet spot
  const grad = ctx.createLinearGradient(0, 0, 230, 0);
  grad.addColorStop(0, "#ff0066");
  grad.addColorStop(1, "#00ccff");
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.9;
  layout.draw(r, 0, 0);
  ctx.restore();

  await snapshot("renderer_whacky_path", canvas.toBuffer("image/png"));
}

if (fail) { console.error(`\n${fail} check(s) failed`); process.exit(1); }
else console.log("\nall path-renderer checks passed");
