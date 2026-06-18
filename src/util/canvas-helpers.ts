import type { Context2DLike, ImageDataLike, MakeOffscreen, OffscreenLike, RGBA } from "./canvas-types.js";

export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const clamp255 = (n: number): number => n < 0 ? 0 : n > 255 ? 255 : n;

// Resolve a solid CSS colour string to RGBA. The cheap parser (parseCssColor) handles #hex / rgb()
// without touching a canvas; only exotic forms (named colours, hsl) need the 1x1 round-trip through
// `scratch`. Shared by the renderers' fill resolution; each memoises the result so a layout's worth
// of same-colour runs only resolves once.
export function cssToRgba(css: string, scratch?: Context2DLike): RGBA {
  const parsed = parseCssColor(css);
  if (parsed) return parsed;
  if (scratch) {
    scratch.fillStyle = css;
    scratch.fillRect(0, 0, 1, 1);
    const p = scratch.getImageData(0, 0, 1, 1).data;
    return [p[0]!, p[1]!, p[2]!, p[3]! / 255];
  }
  return [0, 0, 0, 1];
}

export function toCss(c: RGBA | string): string {
  return typeof c === "string" ? c : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
}

export function rgba([r, g, b, a]: RGBA): number {
  return ((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

// Minimal CSS-colour parser for the common SOLID forms (#hex and rgb()/rgba()). Returns null for
// anything it doesn't recognise (named colours, hsl, ...) so callers can fall back to a canvas-based
// resolver. Lets the bitmap-target renderers turn a `fillStyle` straight into a COLORREF without an
// offscreen canvas for the everyday cases.
export function parseCssColor(css: string): RGBA | null {
  const s = css.trim();
  const hex = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (hex) {
    let h = hex[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return [r, g, b, h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1]!.split(/[,/\s]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (v: string) => v.endsWith("%") ? Math.round(parseFloat(v) * 2.55) : parseFloat(v);
    const r = ch(parts[0]!), g = ch(parts[1]!), b = ch(parts[2]!);
    const a = parts[3] === undefined ? 1 : parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    return [r, g, b, a].some((n) => Number.isNaN(n)) ? null : [r, g, b, a];
  }
  return null;
}

// Swap the R and B channels of a packed 32-bit pixel, dropping alpha. Converts between canvas RGBA
// (0xAABBGGRR, little-endian byte order R,G,B,A) and the GDI bitmap surface (0x00RRGGBB). The swap
// is its own inverse, so this single op serves both directions. Integer-only: no per-byte indexing.
export const swapRB = (p: number): number =>
  ((p & 0x000000ff) << 16) | (p & 0x0000ff00) | ((p >>> 16) & 0x000000ff);

// Pack a contiguous w×h canvas RGBA region into the (strided) GDI surface at (x0,y0), dropping
// alpha. This is the "copy from the source" that primes the bitmap surface with the live background
// so DirectWrite's ClearType / colour-glyph blending composites over the real destination pixels.
// Operates one Uint32 per pixel rather than four bytes.
export function packForward(
  region: ImageDataLike,
  surface: { width: number; data: Uint32Array },
  w: number,
  h: number,
  x0 = 0,
  y0 = 0,
): void {
  const src = new Uint32Array(region.data.buffer);
  const stride = surface.width;
  for (let row = 0; row < h; row++) {
    const d = (y0 + row) * stride + x0;
    const s = row * w;
    for (let col = 0; col < w; col++) surface.data[d + col] = swapRB(src[s + col]!);
  }
}

export function defaultMakeOffscreen(): MakeOffscreen | undefined {
  const OC = (globalThis as { OffscreenCanvas?: new (w: number, h: number) => OffscreenLike }).OffscreenCanvas;
  return typeof OC === "function" ? (w, h) => new OC(w, h) : undefined;
}

// Composite `result` (the freshly-rendered BGRA surface) back over `region` (which still holds
// the original destination pixels) at `opacity`, then write RGB into region.data with full
// alpha. opacity=1 is a straight copy; <1 alpha-blends the glyph layer over the background.
export function blendBack(
  region: ImageDataLike,
  result: { width: number, data: Uint32Array },
  opacity: number,
  w?: number,
  h?: number,
  x0: number = 0,
  y0: number = 0
): void {
  const a = Math.max(0, Math.min(1, opacity));

  w ??= region.width;
  h ??= region.height;

  const dst = new Uint32Array(region.data.buffer);
  const stride = result.width;

  if (a >= 1) {
    // Straight copy: swap channels back to RGBA and force full alpha. One Uint32 per pixel.
    for (let row = 0; row < h; row++) {
      const src = (y0 + row) * stride + x0;
      const d = row * w;
      for (let col = 0; col < w; col++) dst[d + col] = (swapRB(result.data[src + col]!) | 0xff000000) >>> 0;
    }
  } else {
    // Alpha-blend the surface (0x00RRGGBB) over the original destination (still in `dst`).
    for (let row = 0; row < h; row++) {
      const src = (y0 + row) * stride + x0;
      const d = row * w;
      for (let col = 0; col < w; col++) {
        const v = result.data[src + col]!;                       // 0x00RRGGBB
        const sR = (v >>> 16) & 0xff, sG = (v >>> 8) & 0xff, sB = v & 0xff;

        const o = dst[d + col]!;                                  // 0xAABBGGRR
        const oR = o & 0xff, oG = (o >>> 8) & 0xff, oB = (o >>> 16) & 0xff;

        const nR = (oR + (sR - oR) * a + 0.5) | 0;
        const nG = (oG + (sG - oG) * a + 0.5) | 0;
        const nB = (oB + (sB - oB) * a + 0.5) | 0;
        dst[d + col] = (0xff000000 | (nB << 16) | (nG << 8) | nR) >>> 0;
      }
    }
  }
}
