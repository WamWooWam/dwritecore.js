import { callMethod } from "../core/com.js";
import { colorref, DWRITE_MEASURING_MODE } from "../core/types.js";
import type { DWRITE_STRIKETHROUGH, DWRITE_UNDERLINE } from "../core/structs.g.js";
import type { IDWriteBitmapRenderTarget } from "../interfaces/IDWriteBitmapRenderTarget.js";
import type { IDWriteFactory } from "../interfaces/IDWriteFactory.js";
import type { IDWriteRenderingParams } from "../interfaces/IDWriteRenderingParams.g.js";
import type { Context2DLike, DrawableLike, MakeOffscreen, OffscreenLike, RGBA } from "./canvas-types.js";
import { blendBack, clamp01, cssToRgba, defaultMakeOffscreen, packForward } from "./canvas-helpers.js";
import { GlyphRun, RT_DrawGlyphRun, RT_DrawGlyphRunWithColorSupport, TextRendererBase } from "./text-renderer.js";

export interface BasicTextRendererOptions {
    colorGlyphs?: boolean;
    colorPaletteIndex?: number;

    renderingParams?: IDWriteRenderingParams;
    offscreenFactory?: MakeOffscreen;
}

// Draws onto a Canvas 2D context like ctx.fillText, but ENTIRELY through an IDWriteBitmapRenderTarget
// so DirectWrite's own GDI ClearType (and colour-glyph) rasterisation is what lands on the canvas.
// To keep the ClearType subpixel blend correct, the destination is first copied INTO the bitmap
// surface so the surface mirrors the canvas; DWrite then composites over those real background
// pixels and reports a dirty rectangle, which is blended back out to the context.
//
// This is the "basic" renderer: it only honours a SOLID fillStyle and an IDENTITY transform, and
// THROWS otherwise rather than silently dropping a gradient/transform on the floor. Reach for
// CanvasBitmapTextRenderer (coverage mask) or CanvasPathTextRenderer (vector outlines) when you need
// transforms, gradients or patterns.
export class BasicTextRenderer extends TextRendererBase {
    private readonly params: IDWriteRenderingParams;

    // 1x1 scratch used only to resolve `fillStyle` strings the cheap parser can't (named colours, etc.)
    private readonly colorOffscreen?: OffscreenLike;
    private readonly colorCtx?: Context2DLike;

    private renderTarget?: IDWriteBitmapRenderTarget;
    private rectPtr = 0;
    private mirrored = false;

    constructor(
        private readonly factory: IDWriteFactory,
        private readonly canvas: DrawableLike,
        private readonly ctx: Context2DLike,
        private readonly options: BasicTextRendererOptions = {}) {
        super(factory.abi);
        this.options.colorGlyphs ??= false;

        if (options.renderingParams) {
            this.params = options.renderingParams;
            this.params.addRef();
        } else {
            this.params = factory.createRenderingParams();
        }

        const make = options.offscreenFactory ?? defaultMakeOffscreen();
        this.colorOffscreen = make?.(1, 1);
        this.colorCtx = this.colorOffscreen?.getContext("2d") ?? undefined;
    }

    // Canvas-sized GDI surface, lazily created. DrawGlyphRun composites onto it, so it has to span
    // the whole canvas (runs arrive in absolute canvas coordinates).
    private get target(): IDWriteBitmapRenderTarget {
        if (!this.renderTarget) {
            this.renderTarget = this.factory.getGdiInterop()
                .createBitmapRenderTarget(0, this.canvas.width, this.canvas.height);
            this.rectPtr = this.abi.allocZeroed(16);
        }
        return this.renderTarget;
    }

    private assertSimple(): void {
        const t = this.ctx.getTransform();
        if (t.a !== 1 || t.b !== 0 || t.c !== 0 || t.d !== 1 || t.e !== 0 || t.f !== 0)
            throw new Error(
                "BasicTextRenderer only supports an identity canvas transform; use CanvasBitmapTextRenderer or CanvasPathTextRenderer for transformed text.");
        if (typeof this.ctx.fillStyle !== "string")
            throw new Error(
                "BasicTextRenderer only supports a solid-colour fillStyle; use CanvasBitmapTextRenderer or CanvasPathTextRenderer for gradients/patterns.");
    }

    private lastFillCss: string | null = null;
    private lastFillRgba: RGBA = [0, 0, 0, 1];

    // The live fillStyle reduced to one RGBA, memoised on the string. The fast path parses #hex /
    // rgb() directly; otherwise we round-trip the string through a 1x1 canvas. Non-strings are
    // rejected up front by assertSimple, so a drawGlyphRun/fillRect over a whole layout resolves the
    // colour at most once.
    private resolveFill(): RGBA {
        const fs = this.ctx.fillStyle as string;
        if (fs === this.lastFillCss) return this.lastFillRgba;
        const out = cssToRgba(fs, this.colorCtx);
        this.lastFillCss = fs;
        this.lastFillRgba = out;
        return out;
    }

    // Copy the whole canvas into the surface once, so the very first run has the real background to
    // blend over. Subsequent runs keep the surface in sync via commit(), so this only fires once.
    private ensureMirror(): void {
        if (this.mirrored) return;
        const surf = this.target.pixels();
        const region = this.ctx.getImageData(0, 0, surf.width, surf.height);
        packForward(region, surf, surf.width, surf.height);
        this.mirrored = true;
    }

    protected override drawGlyphRun(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): void {
        this.assertSimple();
        this.ensureMirror();

        const [r, g, b, a] = this.resolveFill();
        const opacity = clamp01(this.ctx.globalAlpha) * a;

        // DWrite paints over the mirrored background and fills rectPtr with the inked (dirty) box.
        if (this.options.colorGlyphs) {
            callMethod(this.abi, this.target.ptr, RT_DrawGlyphRunWithColorSupport,
                x, y, measuringMode, run.ptr, this.params.ptr, colorref(r, g, b), this.options.colorPaletteIndex ?? 0, this.rectPtr);
        } else {
            callMethod(this.abi, this.target.ptr, RT_DrawGlyphRun,
                x, y, measuringMode, run.ptr, this.params.ptr, colorref(r, g, b), this.rectPtr);
        }

        const left = this.abi.readI32(this.rectPtr), top = this.abi.readI32(this.rectPtr + 4);
        this.commit(left, top, this.abi.readI32(this.rectPtr + 8) - left, this.abi.readI32(this.rectPtr + 12) - top, opacity);
    }

    protected override drawUnderline(x: number, y: number, u: DWRITE_UNDERLINE): void {
        this.fillRect(x, y + u.offset, u.width, Math.max(1, u.thickness));
    }

    protected override drawStrikethrough(x: number, y: number, s: DWRITE_STRIKETHROUGH): void {
        this.fillRect(x, y + s.offset, s.width, Math.max(1, s.thickness));
    }

    // Underlines/strikethroughs are solid: paint them straight onto the mirrored surface, then route
    // them through commit() so they share the glyph runs' compositing and opacity handling.
    private fillRect(x: number, y: number, w: number, h: number): void {
        this.assertSimple();
        this.ensureMirror();

        const [r, g, b, a] = this.resolveFill();
        const opacity = clamp01(this.ctx.globalAlpha) * a;

        const surf = this.target.pixels();
        const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
        const x1 = Math.min(surf.width, Math.round(x + w)), y1 = Math.min(surf.height, Math.round(y + h));
        if (x1 <= x0 || y1 <= y0) return;

        const px = ((r << 16) | (g << 8) | b) >>> 0; // surface is 0x00RRGGBB
        for (let row = y0; row < y1; row++) {
            const base = row * surf.width;
            for (let col = x0; col < x1; col++) surf.data[base + col] = px;
        }
        this.commit(x0, y0, x1 - x0, y1 - y0, opacity);
    }

    // Blend the surface's [left,top,w,h] (already composited by DWrite over the mirrored background)
    // back onto the canvas at `opacity`, then keep the mirror in sync so later overlapping runs
    // composite over the updated canvas, not the opaque intermediate.
    private commit(left: number, top: number, w: number, h: number, opacity: number): void {
        const surf = this.target.pixels(); // re-fetch: DrawGlyphRun may have grown (detached) wasm memory
        if (left < 0) { w += left; left = 0; }
        if (top < 0) { h += top; top = 0; }
        if (left + w > surf.width) w = surf.width - left;
        if (top + h > surf.height) h = surf.height - top;
        if (w <= 0 || h <= 0) return;

        // opacity>=1 is a straight surface->canvas copy: blendBack overwrites every pixel from the
        // surface and never reads the destination, so we only need a writable buffer, not the live
        // canvas pixels. createImageData avoids the readback round-trip (a partial blend, opacity<1,
        // genuinely reads the destination and must use getImageData). The readback also pins native
        // buffers in some canvas backends, so skipping it on the hot opaque path matters for memory.
        const region = opacity < 1
            ? this.ctx.getImageData(left, top, w, h)
            : this.ctx.createImageData(w, h);
        blendBack(region, surf, opacity, w, h, left, top);
        this.ctx.putImageData(region, left, top);

        // opacity>=1 already left surface == canvas; a partial blend diverged them, so re-mirror.
        if (opacity < 1) packForward(region, surf, w, h, left, top);
    }

    protected override dispose(): void {
        if (this.rectPtr) this.abi.free(this.rectPtr);
        this.renderTarget?.release();
        this.params.release();
    }
}
