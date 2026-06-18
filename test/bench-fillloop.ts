// Isolated microbench for the Bitmap renderer's coverage->tile fill loops (no canvas, no wasm), to
// pick the loop-unroll factor empirically. dst is offscreen-strided Uint32, src coverage is compact
// Uint8; we time naive / unroll-4 / unroll-8 over a typical and a large tile.
//   node dist/test/bench-fillloop.js

function makeInputs(w: number, h: number, stride: number) {
  const cov = new Uint8Array(w * h);
  for (let i = 0; i < cov.length; i++) cov[i] = (i * 37) & 0xff; // arbitrary coverage
  const tile = new Uint32Array(stride * h);
  return { cov, tile, w, h, stride };
}

type Fill = (tile: Uint32Array, stride: number, cov: Uint8Array, w: number, h: number, base: number) => void;

const naive: Fill = (tile, stride, cov, w, h, base) => {
  for (let row = 0; row < h; row++) {
    const s = row * w, d = row * stride;
    for (let c = 0; c < w; c++) tile[d + c] = (cov[s + c]! << 24) | base;
  }
};

const unroll4: Fill = (tile, stride, cov, w, h, base) => {
  for (let row = 0; row < h; row++) {
    const s = row * w, d = row * stride;
    let c = 0;
    for (; c + 4 <= w; c += 4) {
      tile[d + c] = (cov[s + c]! << 24) | base;
      tile[d + c + 1] = (cov[s + c + 1]! << 24) | base;
      tile[d + c + 2] = (cov[s + c + 2]! << 24) | base;
      tile[d + c + 3] = (cov[s + c + 3]! << 24) | base;
    }
    for (; c < w; c++) tile[d + c] = (cov[s + c]! << 24) | base;
  }
};

const unroll8: Fill = (tile, stride, cov, w, h, base) => {
  for (let row = 0; row < h; row++) {
    const s = row * w, d = row * stride;
    let c = 0;
    for (; c + 8 <= w; c += 8) {
      tile[d + c] = (cov[s + c]! << 24) | base;
      tile[d + c + 1] = (cov[s + c + 1]! << 24) | base;
      tile[d + c + 2] = (cov[s + c + 2]! << 24) | base;
      tile[d + c + 3] = (cov[s + c + 3]! << 24) | base;
      tile[d + c + 4] = (cov[s + c + 4]! << 24) | base;
      tile[d + c + 5] = (cov[s + c + 5]! << 24) | base;
      tile[d + c + 6] = (cov[s + c + 6]! << 24) | base;
      tile[d + c + 7] = (cov[s + c + 7]! << 24) | base;
    }
    for (; c < w; c++) tile[d + c] = (cov[s + c]! << 24) | base;
  }
};

function time(name: string, fn: Fill, inp: ReturnType<typeof makeInputs>, reps: number): void {
  const { cov, tile, w, h, stride } = inp;
  for (let i = 0; i < 50; i++) fn(tile, stride, cov, w, h, 0x123456); // warm
  let best = Infinity;
  for (let b = 0; b < 6; b++) {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < reps; i++) fn(tile, stride, cov, w, h, 0x123456);
    const ns = Number(process.hrtime.bigint() - t0);
    best = Math.min(best, ns);
  }
  const px = w * h * reps;
  console.log(`  ${name.padEnd(10)} ${(best / px).toFixed(3)} ns/px  (${(best / reps / 1000).toFixed(2)} us/fill)`);
}

for (const [label, w, h, stride, reps] of [
  ["typical 380x22 (stride 760)", 380, 22, 760, 4000],
  ["large 720x120 (stride 760)", 720, 120, 760, 600],
] as const) {
  console.log(`\n${label}:`);
  const inp = makeInputs(w, h, stride);
  time("naive", naive, inp, reps);
  time("unroll4", unroll4, inp, reps);
  time("unroll8", unroll8, inp, reps);
}

// ---- colour-path un-premultiply loop: is this compute-bound loop worth unrolling? ----
// Two u32 sources (over-black, over-white), one u32 dst; per pixel = 2 divisions + a branch.
function recoverNaive(dst: Uint32Array, ob: Uint32Array, wh: Uint32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const pb = ob[i]!, pw = wh[i]!;
    const bR = (pb >>> 16) & 255, bG = (pb >>> 8) & 255, bB = pb & 255;
    const wR = (pw >>> 16) & 255, wG = (pw >>> 8) & 255, wB = pw & 255;
    let a = (255 - ((wR - bR) + (wG - bG) + (wB - bB)) / 3 + 0.5) | 0;
    if (a <= 0) { dst[i] = 0; continue; }
    if (a > 255) a = 255;
    const inv = 255 / a;
    let r = (bR * inv + 0.5) | 0; if (r > 255) r = 255;
    let g = (bG * inv + 0.5) | 0; if (g > 255) g = 255;
    let bl = (bB * inv + 0.5) | 0; if (bl > 255) bl = 255;
    dst[i] = ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }
}
// Division-free: /3 -> *(1/3), and 255/a -> reciprocal table lookup.
const ONE_THIRD = 1 / 3;
const RECIP = (() => { const t = new Float64Array(256); for (let a = 1; a < 256; a++) t[a] = 255 / a; return t; })();
function recoverNoDiv(dst: Uint32Array, ob: Uint32Array, wh: Uint32Array, n: number): void {
  for (let i = 0; i < n; i++) {
    const pb = ob[i]!, pw = wh[i]!;
    const bR = (pb >>> 16) & 255, bG = (pb >>> 8) & 255, bB = pb & 255;
    const wR = (pw >>> 16) & 255, wG = (pw >>> 8) & 255, wB = pw & 255;
    let a = (255 - ((wR - bR) + (wG - bG) + (wB - bB)) * ONE_THIRD + 0.5) | 0;
    if (a <= 0) { dst[i] = 0; continue; }
    if (a > 255) a = 255;
    const inv = RECIP[a]!;
    let r = (bR * inv + 0.5) | 0; if (r > 255) r = 255;
    let g = (bG * inv + 0.5) | 0; if (g > 255) g = 255;
    let bl = (bB * inv + 0.5) | 0; if (bl > 255) bl = 255;
    dst[i] = ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0;
  }
}
{
  console.log(`\ncolour un-premultiply (86400 px, mixed coverage):`);
  const n = 720 * 120;
  const ob = new Uint32Array(n), wh = new Uint32Array(n), dst = new Uint32Array(n);
  for (let i = 0; i < n; i++) { const c = (i * 53) & 255, drop = (i * 7) & 255; ob[i] = (c << 16) | (c << 8) | c; wh[i] = (Math.min(255, c + drop) << 16) | (Math.min(255, c + drop) << 8) | Math.min(255, c + drop); }
  const r1 = { cov: ob, tile: dst, w: n, h: 1, stride: n };
  const timeR = (name: string, fn: (d: Uint32Array, a: Uint32Array, b: Uint32Array, n: number) => void, reps: number) => {
    for (let i = 0; i < 50; i++) fn(dst, ob, wh, n);
    let best = Infinity;
    for (let b = 0; b < 6; b++) { const t0 = process.hrtime.bigint(); for (let i = 0; i < reps; i++) fn(dst, ob, wh, n); best = Math.min(best, Number(process.hrtime.bigint() - t0)); }
    console.log(`  ${name.padEnd(10)} ${(best / (n * reps)).toFixed(3)} ns/px`);
    void r1;
  };
  timeR("2-divide", recoverNaive, 400);
  timeR("no-divide", recoverNoDiv, 400);
}
console.log("\nRESULT: fillloop microbench done");
