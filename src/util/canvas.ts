import type { IDWriteFactory } from "../interfaces/IDWriteFactory.js";
import type { IDWriteFontFace } from "../interfaces/IDWriteFontFace.js";
import type { IDWriteGdiInterop } from "../interfaces/IDWriteGdiInterop.g.js";
import type { IDWriteRenderingParams } from "../interfaces/IDWriteRenderingParams.g.js";
import type { IDWriteTextLayout } from "../interfaces/IDWriteTextLayout.js";
import { TextRenderer, OutlineTextRenderer } from "./text-renderer.js";
import { GeometrySink, type CanvasPathLike } from "./geometry-sink.js";
import { colorref, DWRITE_MEASURING_MODE } from "../core/types.js";

export type RGBA = [r: number, g: number, b: number, a: number];

// minimal subset of CanvasRenderingContext2D
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  data: { [i: number]: number; length: number }
}

export interface Context2DLike {
  createImageData(w: number, h: number): ImageDataLike;
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
  putImageData(img: ImageDataLike, dx: number, dy: number): void;
}

// Path/fill subset used by drawTextOutline
export interface Context2DPathLike extends CanvasPathLike {
  beginPath(): void;
  fill(fillRule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function toCss(c: RGBA | string): string {
  return typeof c === "string" ? c : `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3]})`;
}

export interface DrawTextOptions {
  face: IDWriteFontFace;
  size: number;          // em size in px
  x: number;             // left
  y: number;             // top of the line box
  color?: RGBA;
  colorGlyphs?: boolean;
  colorPaletteIndex?: number;
}

export interface DrawOutlineOptions {
  face: IDWriteFontFace;
  size: number;          // em size in px
  x: number;             // left (pen origin x), same anchor as drawText
  y: number;             // top of the line box
  fill?: RGBA | string | false;  // glyph interior; default solid black, `false` to skip the fill
  stroke?: RGBA | string;        // outline stroke; default none
  lineWidth?: number;            // stroke width in px (default 1; only used when `stroke` is set)
  pixelsPerDip?: number;         // scale applied to the outline coordinates (default 1)
}

export class TextCanvas implements Disposable {
  private readonly interop: IDWriteGdiInterop;
  private renderer?: TextRenderer;

  constructor(private readonly factory: IDWriteFactory, private readonly ctx: Context2DLike, private readonly params: IDWriteRenderingParams = null!) {
    this.interop = factory.getGdiInterop();
    this.params ??= factory.createRenderingParams();
  }

  private get textRenderer(): TextRenderer {
    return (this.renderer ??= new TextRenderer(this.factory.abi));
  }

  // Composite `result` (the freshly-rendered BGRA surface) back over `region` (which still holds
  // the original destination pixels) at `opacity`, then write RGB into region.data with full
  // alpha. opacity=1 is a straight copy; <1 alpha-blends the glyph layer over the background.
  private blendBack(region: ImageDataLike, result: { data: Uint32Array }, opacity: number): void {
    const a = Math.max(0, Math.min(1, opacity));
    for (let i = 0; i < result.data.length; i++) {
      const v = result.data[i]!;
      const rR = (v >>> 16) & 0xff, rG = (v >>> 8) & 0xff, rB = v & 0xff;
      const j = i * 4;
      if (a >= 1) {
        region.data[j] = rR; region.data[j + 1] = rG; region.data[j + 2] = rB;
      } else {
        const oR = region.data[j]!, oG = region.data[j + 1]!, oB = region.data[j + 2]!;
        region.data[j] = Math.round(oR + (rR - oR) * a);
        region.data[j + 1] = Math.round(oG + (rG - oG) * a);
        region.data[j + 2] = Math.round(oB + (rB - oB) * a);
      }
      region.data[j + 3] = 255;
    }
  }

  drawLayout(layout: IDWriteTextLayout, opts: { x: number; y: number; color?: RGBA; colorGlyphs?: boolean; colorPaletteIndex?: number; pixelsPerDip?: number; opacity?: number }): void {
    const m = layout.getMetrics();
    const W = Math.max(1, Math.ceil(m.layoutWidth || m.width));
    const H = Math.max(1, Math.ceil(m.height) + 2);

    using target = this.interop.createBitmapRenderTarget(0, W, H);

    const region = this.ctx.getImageData(opts.x, opts.y, W, H);
    const surface = target.pixels();
    for (let i = 0; i < surface.data.length; i++) {
      surface.data[i] = (region.data[i * 4]! << 16) | (region.data[i * 4 + 1]! << 8) | region.data[i * 4 + 2]!;
    }

    const c = opts.color ?? [0, 0, 0, 1];
    const [r, g, b, a] = c;
    this.textRenderer.render(layout, {
      target, params: this.params, color: colorref(r, g, b),
      colorGlyphs: opts.colorGlyphs, colorPaletteIndex: opts.colorPaletteIndex,
      pixelsPerDip: opts.pixelsPerDip
    });

    this.blendBack(region, target.pixels(), a);
    this.ctx.putImageData(region, opts.x, opts.y);
  }

  drawText(text: string, opts: DrawTextOptions): void {
    const { face, size } = opts;
    const fm = face.getMetrics();
    const scale = size / fm.designUnitsPerEm;
    const ascentPx = fm.ascent * scale;
    const lineH = Math.ceil((fm.ascent + fm.descent) * scale);

    const codePoints = [...text].map((c) => c.codePointAt(0)!);
    const glyphIndices = face.getGlyphIndices(codePoints);
    const glyphAdvances = face.getDesignGlyphMetrics(glyphIndices).map((g) => g.advanceWidth * scale);
    const W = Math.max(1, Math.ceil(glyphAdvances.reduce((a, b) => a + b, 0)));

    using target = this.interop.createBitmapRenderTarget(0, W, lineH);

    // copy from the target so we can blend over it with cleartype intact
    const region = this.ctx.getImageData(opts.x, opts.y, W, lineH);
    const surface = target.pixels();
    for (let i = 0; i < surface.data.length; i++) {
      const r = region.data[i * 4]!, g = region.data[i * 4 + 1]!, b = region.data[i * 4 + 2]!;
      surface.data[i] = (r << 16) | (g << 8) | b;
    }

    const c = opts.color ?? [0, 0, 0, 1];
    const [r, g, b, a] = c;
    const drawOpts = {
      baselineOriginX: 0,
      baselineOriginY: ascentPx,
      run: { fontFace: face.ptr, fontEmSize: size, glyphIndices, glyphAdvances },
      renderingParams: this.params,
      color: colorref(r, g, b),
      measuringMode: DWRITE_MEASURING_MODE.NATURAL,
    };
    if (opts.colorGlyphs) {
      target.drawGlyphRunWithColorSupport({ ...drawOpts, colorPaletteIndex: opts.colorPaletteIndex });
    } else {
      target.drawGlyphRun(drawOpts);
    }

    this.blendBack(region, target.pixels(), a);
    this.ctx.putImageData(region, opts.x, opts.y);
  }

  // Render a glyph run as VECTOR OUTLINES (fill and/or stroke) straight onto the canvas path,
  // rather than as a rasterised bitmap. IDWriteFontFace::GetGlyphRunOutline streams the contours
  // into a GeometrySink, which we replay onto the 2D context. The pen origin sits at (x, baseline)
  // exactly like drawText - y is the top of the line box, the baseline is one ascent below it.
  drawTextOutline(text: string, opts: DrawOutlineOptions): void {
    const { face, size } = opts;
    const fm = face.getMetrics();
    const scale = size / fm.designUnitsPerEm;
    const ppd = opts.pixelsPerDip ?? 1;

    const codePoints = [...text].map((c) => c.codePointAt(0)!);
    const glyphIndices = face.getGlyphIndices(codePoints);
    const glyphAdvances = face.getDesignGlyphMetrics(glyphIndices).map((g) => g.advanceWidth * scale);

    using sink = new GeometrySink(this.factory.abi);
    face.getGlyphRunOutline(size, glyphIndices, sink, { glyphAdvances });

    // Outline space is Y-down with the baseline at 0 (same convention as the rest of DWrite), so
    // we translate by the baseline origin and scale - no Y flip.
    const originX = opts.x;
    const baselineY = opts.y + fm.ascent * scale * ppd;
    const ctx = this.ctx as unknown as Context2DPathLike;
    ctx.beginPath();
    sink.replay(ctx, (x, y) => [originX + x * ppd, baselineY + y * ppd]);

    this.fillStrokePath(ctx, opts, sink.fillMode);
  }

  // Render a whole laid-out IDWriteTextLayout as VECTOR OUTLINES. Unlike drawTextOutline (one font,
  // one run) this drives the layout's own Draw through an OutlineTextRenderer, so every run - mixed
  // fonts, sizes, scripts, bidi, plus underlines/strikethroughs - is collected into one path and
  // filled/stroked. The layout's top-left lands at (x, y), like drawLayout.
  drawLayoutOutline(layout: IDWriteTextLayout, opts: { x: number; y: number; fill?: RGBA | string | false; stroke?: RGBA | string; lineWidth?: number; pixelsPerDip?: number }): void {
    const ctx = this.ctx as unknown as Context2DPathLike;
    using renderer = new OutlineTextRenderer(this.factory.abi);
    ctx.beginPath();
    renderer.render(layout, { path: ctx, x: opts.x, y: opts.y, scale: opts.pixelsPerDip ?? 1 });
    this.fillStrokePath(ctx, opts, "nonzero"); // nonzero winding across all runs' contours
  }

  // Shared fill/stroke for the outline methods: default to a solid black fill when neither style is
  // given; `fill: false` skips the fill (stroke-only); a stroke is added on top when provided.
  private fillStrokePath(
    ctx: Context2DPathLike,
    opts: { fill?: RGBA | string | false; stroke?: RGBA | string; lineWidth?: number },
    fillMode: "nonzero" | "evenodd",
  ): void {
    const fill = opts.fill === undefined ? (opts.stroke ? false : [0, 0, 0, 1] as RGBA) : opts.fill;
    if (fill !== false) {
      ctx.fillStyle = toCss(fill);
      ctx.fill(fillMode);
    }
    if (opts.stroke !== undefined) {
      ctx.strokeStyle = toCss(opts.stroke);
      ctx.lineWidth = opts.lineWidth ?? 1;
      ctx.stroke();
    }
  }

  [Symbol.dispose](): void {
    this.renderer?.[Symbol.dispose]();
    this.params[Symbol.dispose]();
    this.interop[Symbol.dispose]();
  }
}
