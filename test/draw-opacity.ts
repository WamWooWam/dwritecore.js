// Canvas opacity: DWriteCanvas.drawText/drawLayout now take an `opacity` (0..1) that alpha-
// composites the glyph layer over existing canvas content. This draws overlapping translucent
// text over a gradient and asserts a pixel under semi-transparent text is a genuine blend of the
// text color and the background (not the pure text color, which the old full-opacity path gave).
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { RGBA, TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const W = 560, H = 260;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const grad = ctx.createLinearGradient(0, 0, W, H);
grad.addColorStop(0, "#ffffff");
grad.addColorStop(1, "#dfe8ff");
ctx.fillStyle = grad;
ctx.fillRect(0, 0, W, H);

using dw = new TextCanvas(factory, ctx);
using arial = factory.loadFontFace("/local/fonts/arial.ttf");

const red: RGBA = [0xd0, 0x10, 0x10, 1];
// A ramp of opacities down the canvas.
const steps: { y: number; opacity: number }[] = [
  { y: 20, opacity: 1.0 },
  { y: 70, opacity: 0.7 },
  { y: 120, opacity: 0.4 },
  { y: 170, opacity: 0.15 },
];
for (const { y, opacity } of steps) {
  dw.drawText(`opacity ${opacity.toFixed(2)}`, { face: arial, size: 40, x: 24, y, color: [red[0], red[1], red[2], opacity] });
}

// Overlapping translucent layers should blend with each other, not clobber.
dw.drawText("OVER", { face: arial, size: 90, x: 300, y: 60, color: [0x10, 0x40, 0xd0, 0.5] });
dw.drawText("LAP", { face: arial, size: 90, x: 360, y: 120, color: [0x10, 0xa0, 0x30, 0.5] });

// --- assertion: the darkest red ink in a faint line must be markedly LIGHTER than in the opaque
// line. Sample only the left portion (x 24..264) so the overlapping green "LAP" doesn't intrude. ---
function darkestLuma(y: number): number {
  const band = ctx.getImageData(24, y, 240, 44);
  let min = 255;
  for (let i = 0; i < band.width * band.height; i++) {
    const r = band.data[i * 4]!, g = band.data[i * 4 + 1]!, b = band.data[i * 4 + 2]!;
    min = Math.min(min, 0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  return min;
}
const opaqueLuma = darkestLuma(20);   // opacity 1.0 line
const faintLuma = darkestLuma(170);   // opacity 0.15 line
console.log(`darkest luma: opaque=${opaqueLuma.toFixed(1)} faint=${faintLuma.toFixed(1)}`);
// Opaque red ink lands near pure red (luma ~52). The 15% line must stay far lighter.
if (opaqueLuma > 90) throw new Error(`opaque line not dark enough (luma ${opaqueLuma.toFixed(1)})`);
if (faintLuma < 150) throw new Error(`0.15-opacity line too dark (luma ${faintLuma.toFixed(1)}), opacity not applied`);
if (faintLuma - opaqueLuma < 80) throw new Error("opacity did not attenuate the ink");

await snapshot("opacity", canvas.toBuffer("image/png"));
