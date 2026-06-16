import { loadImage, createCanvas, type Image } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";

// Image regression via snapshots. Each image-producing test calls `snapshot(name, png)`:
//   snapshots/<name>.expected.png - committed reference (the "known good" render)
//   snapshots/<name>.actual.png   - written every run (git-ignored)
//   snapshots/<name>.diff.png     - written on mismatch, red where pixels differ (git-ignored)
// On first run (no reference) the actual is seeded as the reference. A mismatch throws, so the
// test process exits non-zero and the runner reports a failure.
const DIR = "test/snapshots";

// Per-channel delta tolerated before a pixel counts as "different" (absorbs trivial codec noise).
const CHANNEL_TOLERANCE = 2;
// Fraction of differing pixels tolerated before the snapshot fails.
const DIFF_RATIO_LIMIT = 0.001; // 0.1%

interface Raw { width: number; height: number; data: Uint8ClampedArray }

async function decode(png: Buffer): Promise<Raw> {
  const img: Image = await loadImage(png);
  const c = createCanvas(img.width, img.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const { data } = ctx.getImageData(0, 0, img.width, img.height);
  return { width: img.width, height: img.height, data };
}

export async function snapshot(name: string, png: Buffer): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  const actual = `${DIR}/${name}.actual.png`;
  const expected = `${DIR}/${name}.expected.png`;
  const diff = `${DIR}/${name}.diff.png`;
  writeFileSync(actual, png);
  if (existsSync(diff)) rmSync(diff);

  if (!existsSync(expected)) {
    writeFileSync(expected, png);
    console.log(`  snapshot ${name}: seeded reference (first run)`);
    return;
  }

  const [a, b] = await Promise.all([decode(png), decode(readFileSync(expected))]);
  if (a.width !== b.width || a.height !== b.height)
    throw new Error(`snapshot ${name}: size ${a.width}x${a.height} != reference ${b.width}x${b.height} (see ${actual})`);

  let differing = 0;
  const overlay = new Uint8ClampedArray(a.data.length);
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = Math.abs(a.data[i]! - b.data[i]!);
    const dg = Math.abs(a.data[i + 1]! - b.data[i + 1]!);
    const db = Math.abs(a.data[i + 2]! - b.data[i + 2]!);
    if (dr > CHANNEL_TOLERANCE || dg > CHANNEL_TOLERANCE || db > CHANNEL_TOLERANCE) {
      differing++;
      overlay[i] = 255; overlay[i + 1] = 0; overlay[i + 2] = 0; overlay[i + 3] = 255;
    } else {
      // Dim the unchanged background so differences stand out in the diff image.
      overlay[i] = a.data[i]! >> 1; overlay[i + 1] = a.data[i + 1]! >> 1; overlay[i + 2] = a.data[i + 2]! >> 1; overlay[i + 3] = 255;
    }
  }
  const total = a.width * a.height;
  const ratio = differing / total;
  if (ratio > DIFF_RATIO_LIMIT) {
    const c = createCanvas(a.width, a.height);
    const ctx = c.getContext("2d");
    const id = ctx.createImageData(a.width, a.height);
    id.data.set(overlay);
    ctx.putImageData(id, 0, 0);
    writeFileSync(diff, c.toBuffer("image/png"));
    throw new Error(`snapshot ${name}: ${differing}/${total} px differ (${(ratio * 100).toFixed(2)}%) - compare ${expected} ↔ ${actual}, see ${diff}`);
  }
  console.log(`  snapshot ${name}: OK${differing ? ` (${differing}/${total} px within tolerance)` : ""}`);
}
