import { callMethod } from "../core/com.js";
import { DWRITE_STRIKETHROUGH, DWRITE_UNDERLINE } from "../core/structs.g.js";
import type { DWRITE_MATRIX } from "../core/structs.g.js";
import { DWRITE_MEASURING_MODE, DWRITE_TEXTURE_TYPE, type RECT } from "../core/types.js";
import { IDWriteBitmapRenderTarget } from "../interfaces/IDWriteBitmapRenderTarget.js";
import { IDWriteFactory } from "../interfaces/IDWriteFactory.js";
import { IDWriteRenderingParams } from "../interfaces/IDWriteRenderingParams.g.js";
import type { Context2DLike, DrawableLike, ImageDataLike, MakeOffscreen, OffscreenLike, RGBA } from "./canvas-types.js";
import { clamp01, clamp255, cssToRgba, defaultMakeOffscreen, rgba } from "./canvas-helpers.js";
import { GlyphRun, IDENTITY, RT_DrawGlyphRunWithColorSupport, TextRendererBase } from "./text-renderer.js";

const ONE_THIRD = 1 / 3;
// 255/a for a in 1..255 so the colour-recovery loop multiplies by a table entry instead of dividing
// per pixel (a is always an integer in [1,255] there). Index 0 is unused (handled as fully transparent).
const RECIP_255: Float64Array = (() => {
    const t = new Float64Array(256);
    for (let a = 1; a < 256; a++) t[a] = 255 / a;
    return t;
})();

export interface CanvasTextRendererOptions {
    colorGlyphs?: boolean;
    colorPaletteIndex?: number;

    renderingParams?: IDWriteRenderingParams;
    offscreenFactory?: MakeOffscreen;
}

// Draws onto a Canvas 2D context like ctx.fillText. Mono runs become a grayscale coverage mask
// painted through with the live fillStyle; colour runs (emoji) use IDWriteBitmapRenderTarget.
export class CanvasBitmapTextRenderer extends TextRendererBase {
    private readonly params: IDWriteRenderingParams;

    private readonly offscreen?: OffscreenLike;
    private readonly offscreenContext?: Context2DLike;

    private colorTarget?: IDWriteBitmapRenderTarget;
    private rectPtr = 0;

    // One reusable offscreen-sized tile buffer, instead of a fresh ImageData per glyph run. Each run
    // writes its w×h coverage into the top-left (at the buffer's own, larger, stride) and uploads only
    // that sub-rect. createImageData/getImageData allocate native buffers the canvas backend does not
    // promptly reclaim, so reusing one large buffer - rather than ~one small one per run per frame -
    // is what keeps memory flat under sustained redraw. (re)allocated only when the offscreen grows.
    private tileImg?: ImageDataLike;
    private tile32?: Uint32Array;
    private tileStride = 0;

    // Reused scratch for the colour path's over-black render (the over-white pass overwrites the GDI
    // surface, so one of the two must be copied aside); grown on demand, never per-run.
    private colorBlack?: Uint32Array;

    constructor(
        private readonly factory: IDWriteFactory,
        private readonly canvas: DrawableLike,
        private readonly ctx: Context2DLike,
        private readonly options: CanvasTextRendererOptions = {}) {
        super(factory.abi);
        this.options.colorGlyphs ??= false;

        if (options.renderingParams) {
            this.params = options.renderingParams;
            this.params.addRef();
        } else {
            this.params = factory.createRenderingParams();
        }

        const make = options.offscreenFactory ?? defaultMakeOffscreen();
        if (make) {
            this.offscreen = make(1, 1);
            this.offscreenContext = this.offscreen.getContext("2d") ?? undefined;
        }
        if (!this.offscreenContext) {
            console.warn("No offscreen canvas available; text will be rendered ignoring the canvas transform and fill gradients.");
        }
    }

    private ctxMatrix(): DWRITE_MATRIX | null {
        if (!this.offscreenContext) return null;
        const { a, b, c, d, e, f } = this.ctx.getTransform();
        return { m11: a, m12: b, m21: c, m22: d, dx: e, dy: f };
    }

    protected override currentTransform(): readonly [number, number, number, number, number, number] {
        const m = this.ctxMatrix();
        return m ? [m.m11, m.m12, m.m21, m.m22, m.dx, m.dy] : IDENTITY;
    }

    // The fillStyle reduced to one RGBA (for the COLR foreground, the solid mono fast path and the
    // degraded path); non-strings fall back to black.
    private resolveFill(): RGBA {
        const fs = this.ctx.fillStyle;
        return typeof fs === "string" ? this.resolveSolid(fs) : [0, 0, 0, 1];
    }

    private lastFillCss: string | null = null;
    private lastFillRgba: RGBA = [0, 0, 0, 1];

    // Parse a solid CSS colour string to RGBA, memoising the last result. The cheap parser handles
    // #hex / rgb() without touching a canvas; only exotic forms (named colours, hsl) fall back to a
    // 1x1 round-trip - and the memo means even those resolve at most once per distinct colour, so a
    // whole layout's worth of same-colour runs never re-resolves.
    private resolveSolid(css: string): RGBA {
        if (css === this.lastFillCss) return this.lastFillRgba;
        const out = cssToRgba(css, this.offscreenContext);
        this.lastFillCss = css;
        this.lastFillRgba = out;
        return out;
    }

    protected override drawGlyphRun(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): void {
        if (this.options.colorGlyphs && this.hasColor(x, y, run, measuringMode)) {
            this.drawColorGlyphRun(x, y, run, measuringMode);
        } else {
            this.drawMonoGlyphRun(x, y, run, measuringMode);
        }
    }

    private hasColor(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): boolean {
        const enumerator = this.factory.tryTranslateColorGlyphRun(x, y, run.ptr, measuringMode, {
            colorPaletteIndex: this.options.colorPaletteIndex,
        });
        if (!enumerator) return false;
        enumerator.release();
        return true;
    }

    private drawMonoGlyphRun(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): void {
        const transform = this.ctxMatrix();

        // The run is already a native DWRITE_GLYPH_RUN in wasm; hand its pointer straight to the
        // analysis instead of marshalling glyph indices/advances/offsets out to JS and back in.
        using analysis = this.factory.createGlyphRunAnalysis2FromPtr(run.ptr, {
            transform: transform ?? undefined,
            measuringMode,
            baselineOriginX: x,
            baselineOriginY: y,
        });

        const bounds = analysis.getAlphaTextureBounds(DWRITE_TEXTURE_TYPE.ALIASED_1x1);
        const w = bounds.right - bounds.left, h = bounds.bottom - bounds.top;
        if (w <= 0 || h <= 0) return;

        const TEX = DWRITE_TEXTURE_TYPE.ALIASED_1x1;

        // Transform is baked into the analysis, so bounds are in device space: composite at identity.
        const oc = this.offscreenContext;
        if (this.offscreen && oc && transform) {
            const tile = this.ensureTile(w, h);     // reusable, offscreen-sized; stride = this.tileStride
            const stride = this.tileStride;
            const fs = this.ctx.fillStyle;

            if (typeof fs === "string") {
                // Solid colour: bake (colour, coverage x colourAlpha) straight into the tile in one
                // pass - no second source-atop fill. Read coverage straight from wasm into the tile.
                const [r, g, b, ca] = this.resolveSolid(fs);
                const base = (b << 16) | (g << 8) | r;
                analysis.withAlphaTexture(TEX, bounds, (cov) => this.fillSolidTile(tile, stride, cov, w, h, base, ca));
                oc.putImageData(this.tileImg!, 0, 0, 0, 0, w, h);
            } else {
                // Gradient/pattern: alpha-only coverage tile, then paint the live fillStyle through it
                // under the user->device transform so the fill tracks the glyphs.
                analysis.withAlphaTexture(TEX, bounds, (cov) => this.fillAlphaTile(tile, stride, cov, w, h));
                oc.putImageData(this.tileImg!, 0, 0, 0, 0, w, h);
                this.fillThroughMask(w, h, bounds, transform);
            }

            this.ctx.save();
            this.ctx.setTransform(1, 0, 0, 1, 0, 0);
            this.ctx.drawImage(this.offscreen, 0, 0, w, h, bounds.left, bounds.top, w, h);
            this.ctx.restore();
            return;
        }

        // Degraded path: no offscreen, blend a solid tile straight over the destination.
        const [r, g, b] = this.resolveFill();
        const img = this.ctx.createImageData(w, h);
        const d = img.data;
        analysis.withAlphaTexture(TEX, bounds, (cov) => {
            for (let i = 0, j = 0; i < cov.length; i++, j += 4) {
                d[j] = r;
                d[j + 1] = g;
                d[j + 2] = b;
                d[j + 3] = cov[i]!;
            }
        });
        this.manualBlend(img, w, h, bounds.left, bounds.top);
    }

    // Grow the offscreen to fit a w×h tile and return the reusable Uint32 tile view, (re)allocating it
    // (and the backing ImageData) only when the offscreen actually grows. The tile is offscreen-sized,
    // so its row stride is `this.tileStride` (>= w), not w.
    private ensureTile(w: number, h: number): Uint32Array {
        const oc = this.offscreen!;
        if (oc.width < w) oc.width = w;
        if (oc.height < h) oc.height = h;
        if (!this.tileImg || this.tileImg.width !== oc.width || this.tileImg.height !== oc.height) {
            this.tileImg = this.offscreenContext!.createImageData(oc.width, oc.height);
            this.tile32 = new Uint32Array(this.tileImg.data.buffer);
            this.tileStride = this.tileImg.width;
        }
        return this.tile32!;
    }

    // Pack (colour, coverage x colourAlpha) into the tile: a fixed RGB `base` with coverage as alpha.
    // ImageData is little-endian RGBA, so a pixel is (A<<24)|base where base = (B<<16)|(G<<8)|R. dst is
    // strided (offscreen-wide); src coverage is compact (w-wide). The inner loop is unrolled 8x: a
    // microbench (bench-fillloop) showed 8x beats both the naive loop and 4x for these memory-bound
    // typed-array stores (4x was actually slower than naive - the remainder/branch overhead dominated).
    private fillSolidTile(tile: Uint32Array, stride: number, cov: Uint8Array, w: number, h: number, base: number, ca: number): void {
        if (ca >= 1) {
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
        } else {
            // Colour carries its own alpha (rgba fill): fold it into coverage. Rarer; left rolled.
            for (let row = 0; row < h; row++) {
                const s = row * w, d = row * stride;
                for (let c = 0; c < w; c++) tile[d + c] = (((cov[s + c]! * ca + 0.5) | 0) << 24) | base;
            }
        }
    }

    // Alpha-only coverage tile (RGB stays 0, filled later via source-atop). dst strided, src compact.
    private fillAlphaTile(tile: Uint32Array, stride: number, cov: Uint8Array, w: number, h: number): void {
        for (let row = 0; row < h; row++) {
            const s = row * w, d = row * stride;
            let c = 0;
            for (; c + 8 <= w; c += 8) {
                tile[d + c] = cov[s + c]! << 24;
                tile[d + c + 1] = cov[s + c + 1]! << 24;
                tile[d + c + 2] = cov[s + c + 2]! << 24;
                tile[d + c + 3] = cov[s + c + 3]! << 24;
                tile[d + c + 4] = cov[s + c + 4]! << 24;
                tile[d + c + 5] = cov[s + c + 5]! << 24;
                tile[d + c + 6] = cov[s + c + 6]! << 24;
                tile[d + c + 7] = cov[s + c + 7]! << 24;
            }
            for (; c < w; c++) tile[d + c] = cov[s + c]! << 24;
        }
    }

    // Paint the live fillStyle through the coverage tile already uploaded to the offscreen at (0,0),
    // under the user->device transform so gradients/patterns track the glyphs. "source-atop" (not
    // "source-in", which clears the destination under a translated transform in some backends) clips
    // the fill to the tile.
    private fillThroughMask(w: number, h: number, bounds: RECT, m: DWRITE_MATRIX): void {
        const oc = this.offscreenContext!;
        oc.save();
        oc.globalCompositeOperation = "source-atop";
        oc.setTransform(m.m11, m.m12, m.m21, m.m22, m.dx - bounds.left, m.dy - bounds.top);
        oc.fillStyle = this.ctx.fillStyle;
        const u = this.userBounds(m, bounds);
        oc.fillRect(u.x, u.y, u.w, u.h);
        oc.restore();
    }

    // Axis-aligned user-space box covering the device tile, so the fill spans the whole mask.
    private userBounds(m: DWRITE_MATRIX, b: RECT): { x: number; y: number; w: number; h: number } {
        const det = m.m11 * m.m22 - m.m21 * m.m12 || 1;
        const toUser = (px: number, py: number): [number, number] => {
            const x = px - m.dx, y = py - m.dy;
            return [(m.m22 * x - m.m21 * y) / det, (m.m11 * y - m.m12 * x) / det];
        };

        const corners = [toUser(b.left, b.top), toUser(b.right, b.top), toUser(b.right, b.bottom), toUser(b.left, b.bottom)];
        const xs = corners.map(c => c[0]), ys = corners.map(c => c[1]);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pad = 1;
        return { x: minX - pad, y: minY - pad, w: maxX - minX + 2 * pad, h: maxY - minY + 2 * pad };
    }

    private get target(): IDWriteBitmapRenderTarget {
        if (!this.colorTarget) {
            this.colorTarget = this.factory.getGdiInterop()
                .createBitmapRenderTarget(0, this.canvas.width, this.canvas.height);
            this.rectPtr = this.abi.allocZeroed(16);
        }
        return this.colorTarget;
    }

    private drawColorGlyphRun(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): void {
        const target = this.target;
        const color = rgba(this.resolveFill());
        const palette = this.options.colorPaletteIndex ?? 0;

        // Drawing may grow (and detach) the wasm memory backing the pixel view, so re-fetch after it.
        const renderInto = (fill: number) => {
            target.pixels().data.fill(fill);
            callMethod(this.abi, target.ptr, RT_DrawGlyphRunWithColorSupport,
                x, y, measuringMode, run.ptr, this.params.ptr, color, palette, this.rectPtr);
            return target.pixels();
        };

        const black = renderInto(0x00000000);
        const left = Math.max(0, this.abi.readI32(this.rectPtr));
        const top = Math.max(0, this.abi.readI32(this.rectPtr + 4));
        const right = Math.min(black.width, this.abi.readI32(this.rectPtr + 8));
        const bottom = Math.min(black.height, this.abi.readI32(this.rectPtr + 12));
        const w = right - left, h = bottom - top;
        if (w <= 0 || h <= 0) return;

        // Save the over-black render aside (the over-white pass overwrites the surface) into a reused
        // scratch buffer rather than a per-run allocation.
        const n = w * h;
        let overBlack = this.colorBlack;
        if (!overBlack || overBlack.length < n) this.colorBlack = overBlack = new Uint32Array(n);
        for (let row = 0; row < h; row++) {
            const s = (top + row) * black.width + left;
            overBlack.set(black.data.subarray(s, s + w), row * w);
        }

        const white = renderInto(0x00FFFFFF);

        // Offscreen path: un-premultiply into the reused tile and composite under the current ctx
        // transform (the GDI render is upright, so the tile - not the analysis - carries any rotation
        // /scale, unlike the mono path which composites at identity).
        if (this.offscreen && this.offscreenContext) {
            const tile = this.ensureTile(w, h);
            this.recoverColor(tile, this.tileStride, overBlack, white.data, white.width, left, top, w, h);
            this.offscreenContext.putImageData(this.tileImg!, 0, 0, 0, 0, w, h);
            this.ctx.drawImage(this.offscreen, 0, 0, w, h, left, top, w, h);
            return;
        }

        // Degraded path: standalone ImageData, blended manually.
        const img = this.ctx.createImageData(w, h);
        this.recoverColor(new Uint32Array(img.data.buffer), w, overBlack, white.data, white.width, left, top, w, h);
        this.manualBlend(img, w, h, left, top);
    }

    // Recover straight colour + alpha from the two GDI renders into `dst` (a little-endian RGBA Uint32
    // view, dst stride `dstStride`). Over black a pixel reads C*a; over white it reads C*a + (1-a)*255;
    // so a = 255 - mean(white-black) and the straight colour is black*255/a. We compute 255/a ONCE per
    // pixel (one divide) and multiply, instead of dividing each of R,G,B. src buffers are 0x00RRGGBB.
    private recoverColor(
        dst: Uint32Array, dstStride: number, overBlack: Uint32Array,
        white: Uint32Array, whiteStride: number, left: number, top: number, w: number, h: number,
    ): void {
        for (let row = 0; row < h; row++) {
            const ws = (top + row) * whiteStride + left;
            const ob = row * w;
            const db = row * dstStride;
            for (let col = 0; col < w; col++) {
                const pb = overBlack[ob + col]!, pw = white[ws + col]!;
                const bR = (pb >>> 16) & 255, bG = (pb >>> 8) & 255, bB = pb & 255;
                const wR = (pw >>> 16) & 255, wG = (pw >>> 8) & 255, wB = pw & 255;
                let a = (255 - ((wR - bR) + (wG - bG) + (wB - bB)) * ONE_THIRD + 0.5) | 0;
                if (a <= 0) { dst[db + col] = 0; continue; }
                if (a > 255) a = 255;
                const inv = RECIP_255[a]!; // == 255/a, no per-pixel divide
                let r = (bR * inv + 0.5) | 0; if (r > 255) r = 255;
                let g = (bG * inv + 0.5) | 0; if (g > 255) g = 255;
                let bl = (bB * inv + 0.5) | 0; if (bl > 255) bl = 255;
                dst[db + col] = ((a << 24) | (bl << 16) | (g << 8) | r) >>> 0; // little-endian RGBA
            }
        }
    }

    protected override drawUnderline(x: number, y: number, u: DWRITE_UNDERLINE): void {
        this.ctx.fillRect(x, y + u.offset, u.width, Math.max(1, u.thickness));
    }

    protected override drawStrikethrough(x: number, y: number, s: DWRITE_STRIKETHROUGH): void {
        this.ctx.fillRect(x, y + s.offset, s.width, Math.max(1, s.thickness));
    }

    // Degraded compositing without an offscreen: blend straight over the destination, ignoring the transform.
    private manualBlend(img: ImageDataLike, w: number, h: number, dx: number, dy: number): void {
        const op = clamp01(this.ctx.globalAlpha);
        const region = this.ctx.getImageData(dx, dy, w, h);
        const r = region.data, s = img.data;
        for (let i = 0, n = w * h; i < n; i++) {
            const j = i * 4;
            const a = (s[j + 3]! / 255) * op;
            r[j] = clamp255(r[j]! + (s[j]! - r[j]!) * a);
            r[j + 1] = clamp255(r[j + 1]! + (s[j + 1]! - r[j + 1]!) * a);
            r[j + 2] = clamp255(r[j + 2]! + (s[j + 2]! - r[j + 2]!) * a);
            r[j + 3] = 255;
        }
        this.ctx.putImageData(region, dx, dy);
    }

    protected override dispose(): void {
        if (this.rectPtr) this.abi.free(this.rectPtr);
        this.colorTarget?.release();
        this.params.release();
    }
}
