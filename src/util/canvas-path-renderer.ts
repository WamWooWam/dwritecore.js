import { DWRITE_STRIKETHROUGH, DWRITE_UNDERLINE } from "../core/structs.g.js";
import { IDWriteFactory } from "../interfaces/IDWriteFactory.js";
import type { Context2DPathLike } from "./canvas-types.js";
import { GeometrySink } from "./geometry-sink.js";
import { GlyphRun, TextRendererBase } from "./text-renderer.js";

export interface CanvasPathTextRendererOptions {
    fill?: boolean;   // fill glyph interiors with the live ctx.fillStyle (default true)
    stroke?: boolean; // stroke glyph contours with the live ctx.strokeStyle / lineWidth (default false)
}

// Draws onto a Canvas 2D context like ctx.fillText/strokeText, but as VECTOR OUTLINES instead of a
// coverage mask: each run's contours (IDWriteFontFace.GetGlyphRunOutline) go onto the canvas path and
// are filled and/or stroked with the live styles, so the ctx transform, globalAlpha and
// gradients/patterns all apply natively with no intermediate bitmap. Cheaper than the bitmap renderer
// for large glyphs, but it has no colour-glyph (emoji) support and relies on the canvas's own path
// antialiasing rather than DWrite's.
export class CanvasPathTextRenderer extends TextRendererBase {
    private readonly fill: boolean;
    private readonly stroke: boolean;

    constructor(private readonly factory: IDWriteFactory, private readonly ctx: Context2DPathLike, options: CanvasPathTextRendererOptions = {}) {
        super(factory.abi);
        this.fill = options.fill ?? true;
        this.stroke = options.stroke ?? false;
    }

    // Outlines are placed at exact positions and the canvas rasterises them, so let DWrite hand us
    // unsnapped fractional baselines.
    protected override isPixelSnappingDisabled(): boolean { return true; }

    protected override drawGlyphRun(x: number, y: number, run: GlyphRun): void {
        using sink = new GeometrySink(this.abi);
        run.fontFace.getGlyphRunOutline(run.fontEmSize, [...run.glyphIndices], sink, {
            glyphAdvances: [...run.glyphAdvances],
            glyphOffsets: run.glyphOffsets,
            isSideways: run.isSideways,
            isRightToLeft: (run.bidiLevel & 1) === 1,
        });
        if (sink.figures.length === 0) return;

        this.ctx.beginPath();
        sink.replay(this.ctx, (px, py) => [x + px, y + py]);
        if (this.fill) this.ctx.fill(sink.fillMode);
        if (this.stroke) this.ctx.stroke();
    }

    protected override drawUnderline(x: number, y: number, u: DWRITE_UNDERLINE): void {
        this.rect(x, y + u.offset, u.width, Math.max(1, u.thickness));
    }

    protected override drawStrikethrough(x: number, y: number, s: DWRITE_STRIKETHROUGH): void {
        this.rect(x, y + s.offset, s.width, Math.max(1, s.thickness));
    }

    private rect(x: number, y: number, w: number, h: number): void {
        if (this.fill) this.ctx.fillRect(x, y, w, h);
        if (this.stroke) this.ctx.strokeRect(x, y, w, h);
    }
}
