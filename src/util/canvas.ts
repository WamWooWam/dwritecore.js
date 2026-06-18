import type { IDWriteFactory } from "../interfaces/IDWriteFactory.js";
import type { IDWriteFontFace } from "../interfaces/IDWriteFontFace.js";
import type { IDWriteGdiInterop } from "../interfaces/IDWriteGdiInterop.g.js";
import type { IDWriteRenderingParams } from "../interfaces/IDWriteRenderingParams.g.js";
import type { IDWriteTextLayout } from "../interfaces/IDWriteTextLayout.js";
import { BasicTextRenderer } from "./canvas-basic-renderer.js";
import { CanvasPathTextRenderer } from "./canvas-path-renderer.js";
import { GeometrySink } from "./geometry-sink.js";
import { colorref, DWRITE_MEASURING_MODE } from "../core/types.js";
import type { RGBA, Context2DLike, Context2DPathLike, DrawableLike } from "./canvas-types.js";
import { toCss, blendBack, packForward } from "./canvas-helpers.js";

export * from "./canvas-types.js";
export * from "./canvas-helpers.js";

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

  constructor(private readonly factory: IDWriteFactory, private readonly ctx: Context2DLike, private readonly params: IDWriteRenderingParams = null!) {
    this.interop = factory.getGdiInterop();
    this.params ??= factory.createRenderingParams();
  }


  /**
   * @deprecated Construct a {@link BasicTextRenderer} and call `layout.draw(renderer, x, y)`
   * directly (the renderer reads the live `fillStyle`/`globalAlpha`), or use
   * `CanvasBitmapTextRenderer` / `CanvasPathTextRenderer` for transforms and gradients. This wrapper
   * now just forwards to `BasicTextRenderer`, so it inherits its solid-colour + identity-transform
   * requirements.
   */
  drawLayout(layout: IDWriteTextLayout, opts: { x: number; y: number; color?: RGBA; colorGlyphs?: boolean; colorPaletteIndex?: number; opacity?: number }): void {
    const [r, g, b, a] = opts.color ?? [0, 0, 0, 1];

    // BasicTextRenderer draws in absolute canvas coordinates onto a canvas-sized surface, so it needs
    // the drawable's extent. Real 2D contexts expose `.canvas`; otherwise size it to the layout box.
    let canvas = (this.ctx as { canvas?: DrawableLike }).canvas;
    if (!canvas) {
      const m = layout.getMetrics();
      canvas = { width: opts.x + Math.max(1, Math.ceil(m.layoutWidth || m.width)), height: opts.y + Math.max(1, Math.ceil(m.height) + 2) };
    }

    const prevFill = this.ctx.fillStyle, prevAlpha = this.ctx.globalAlpha;
    this.ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    this.ctx.globalAlpha = (opts.opacity ?? 1) * a;
    try {
      using renderer = new BasicTextRenderer(this.factory, canvas, this.ctx, {
        renderingParams: this.params, colorGlyphs: opts.colorGlyphs, colorPaletteIndex: opts.colorPaletteIndex,
      });
      layout.draw(renderer, opts.x, opts.y);
    } finally {
      this.ctx.fillStyle = prevFill;
      this.ctx.globalAlpha = prevAlpha;
    }
  }

  /**
   * @deprecated Prefer driving an {@link IDWriteTextLayout} through a {@link BasicTextRenderer} (or
   * `CanvasBitmapTextRenderer` / `CanvasPathTextRenderer`). Kept as a single-run convenience.
   */
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
    packForward(region, surface, W, lineH);

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

    blendBack(region, target.pixels(), a);
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

  /**
   * @deprecated Construct a {@link CanvasPathTextRenderer} with `{ fill, stroke }` and call
   * `layout.draw(renderer, x, y)` directly, setting `fillStyle`/`strokeStyle`/`lineWidth` on the
   * context. This wrapper now just forwards to it. The layout's top-left lands at (x, y).
   */
  drawLayoutOutline(layout: IDWriteTextLayout, opts: { x: number; y: number; fill?: RGBA | string | false; stroke?: RGBA | string; lineWidth?: number; pixelsPerDip?: number }): void {
    const ctx = this.ctx as unknown as Context2DPathLike;
    const fill = opts.fill === undefined ? (opts.stroke ? false : [0, 0, 0, 1] as RGBA) : opts.fill;
    const ppd = opts.pixelsPerDip ?? 1;

    const prevFill = ctx.fillStyle, prevStroke = ctx.strokeStyle, prevLine = ctx.lineWidth;
    if (fill !== false) ctx.fillStyle = toCss(fill);
    if (opts.stroke !== undefined) { ctx.strokeStyle = toCss(opts.stroke); ctx.lineWidth = (opts.lineWidth ?? 1) / ppd; }

    // pixelsPerDip used to be baked into the path coordinates; reproduce it as a uniform scale on the
    // context (composed with whatever transform is already there) and draw at the unscaled origin.
    const base = ppd !== 1 ? this.ctx.getTransform() : null;
    if (base) this.ctx.setTransform(base.a * ppd, base.b * ppd, base.c * ppd, base.d * ppd, base.e, base.f);
    try {
      using renderer = new CanvasPathTextRenderer(this.factory, ctx, { fill: fill !== false, stroke: opts.stroke !== undefined });
      layout.draw(renderer, opts.x / ppd, opts.y / ppd);
    } finally {
      if (base) this.ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
      ctx.fillStyle = prevFill;
      ctx.strokeStyle = prevStroke;
      ctx.lineWidth = prevLine;
    }
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
    this.params[Symbol.dispose]();
    this.interop[Symbol.dispose]();
  }
}
