import type { Abi } from "../core/abi.js";
import { callMethod, IUnknown, S_OK } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWritePixelSnapping, IID_IDWriteTextRenderer } from "../core/iids.js";
import { I32, F32, type TrampolineSig } from "../core/trampoline.js";
import { DWRITE_MEASURING_MODE } from "../core/types.js";
import { readUnderline, readStrikethrough, type DWRITE_UNDERLINE, type DWRITE_STRIKETHROUGH } from "../core/structs.g.js";
import { IDWriteFontFace } from "../interfaces/IDWriteFontFace.js";
import type { IDWriteBitmapRenderTarget } from "../interfaces/IDWriteBitmapRenderTarget.js";
import type { IDWriteRenderingParams } from "../interfaces/IDWriteRenderingParams.g.js";
import { GeometrySink, type CanvasPathLike } from "./geometry-sink.js";

const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },                         // 0 QueryInterface
  { params: [I32], result: I32 },                                   // 1 AddRef
  { params: [I32], result: I32 },                                   // 2 Release
  { params: [I32, I32, I32], result: I32 },                         // 3 IsPixelSnappingDisabled
  { params: [I32, I32, I32], result: I32 },                         // 4 GetCurrentTransform
  { params: [I32, I32, I32], result: I32 },                         // 5 GetPixelsPerDip
  { params: [I32, I32, F32, F32, I32, I32, I32, I32], result: I32 }, // 6 DrawGlyphRun
  { params: [I32, I32, F32, F32, I32, I32], result: I32 },          // 7 DrawUnderline
  { params: [I32, I32, F32, F32, I32, I32], result: I32 },          // 8 DrawStrikethrough
  { params: [I32, I32, F32, F32, I32, I32, I32, I32], result: I32 }, // 9 DrawInlineObject
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_IDWritePixelSnapping, IID_IDWriteTextRenderer],
};

const RT_DrawGlyphRun = 3;
const RT_DrawGlyphRunWithColorSupport = 16; // IDWriteBitmapRenderTarget3
const IDENTITY: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

export class GlyphRun {
  constructor(private readonly abi: Abi, readonly ptr: number) {}
  get fontFace(): IDWriteFontFace { return IDWriteFontFace.from(this.abi, this.abi.readU32(this.ptr + 0)); }
  get fontEmSize(): number { return this.abi.readF32(this.ptr + 4); }
  get glyphCount(): number { return this.abi.readU32(this.ptr + 8); }
  get isSideways(): boolean { return (this.abi.readU32(this.ptr + 24) & 1) !== 0; }
  get bidiLevel(): number { return this.abi.readU32(this.ptr + 28); }

  get glyphIndices(): Uint16Array {
    const n = this.glyphCount, p = this.abi.readU32(this.ptr + 12), out = new Uint16Array(n);
    for (let i = 0; i < n; i++) out[i] = this.abi.readU16(p + i * 2);
    return out;
  }
  get glyphAdvances(): Float32Array {
    const n = this.glyphCount, p = this.abi.readU32(this.ptr + 16), out = new Float32Array(n);
    if (p) for (let i = 0; i < n; i++) out[i] = this.abi.readF32(p + i * 4);
    return out;
  }
  get glyphOffsets(): { advanceOffset: number; ascenderOffset: number }[] {
    const n = this.glyphCount, p = this.abi.readU32(this.ptr + 20), out: { advanceOffset: number; ascenderOffset: number }[] = [];
    for (let i = 0; i < n; i++) out.push(p
      ? { advanceOffset: this.abi.readF32(p + i * 8), ascenderOffset: this.abi.readF32(p + i * 8 + 4) }
      : { advanceOffset: 0, ascenderOffset: 0 });
    return out;
  }
}

export abstract class TextRendererBase extends ComObject {
  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected isPixelSnappingDisabled(): boolean { return false; }
  protected currentTransform(): readonly [number, number, number, number, number, number] { return IDENTITY; }
  protected getPixelsPerDip(): number { return 1; }

  protected drawGlyphRun(_baselineX: number, _baselineY: number, _run: GlyphRun, _measuringMode: DWRITE_MEASURING_MODE, _effect: IUnknown | null, _clientContext: number): void {}
  protected drawUnderline(_baselineX: number, _baselineY: number, _underline: DWRITE_UNDERLINE, _effect: IUnknown | null, _clientContext: number): void {}
  protected drawStrikethrough(_baselineX: number, _baselineY: number, _strikethrough: DWRITE_STRIKETHROUGH, _effect: IUnknown | null, _clientContext: number): void {}
  protected drawInlineObject(_originX: number, _originY: number, _inlineObject: number, _isSideways: boolean, _isRightToLeft: boolean, _effect: IUnknown | null, _clientContext: number): void {}

  private effect(ptr: number): IUnknown | null { return ptr ? new IUnknown(this.abi, ptr) : null; }

  protected handlers(): Function[] {
    const abi = this.abi;
    return [
      (_t: number, _ctx: number, out: number) => { abi.writeU32(out, this.isPixelSnappingDisabled() ? 1 : 0); return S_OK; },
      (_t: number, _ctx: number, out: number) => {
        const m = this.currentTransform();
        for (let i = 0; i < 6; i++) abi.writeF32(out + i * 4, m[i]!);
        return S_OK;
      },
      (_t: number, _ctx: number, out: number) => { abi.writeF32(out, this.getPixelsPerDip()); return S_OK; },
      (_t: number, ctx: number, x: number, y: number, measuringMode: number, glyphRun: number, _desc: number, effect: number) => {
        this.drawGlyphRun(x, y, new GlyphRun(abi, glyphRun), measuringMode >>> 0, this.effect(effect), ctx);
        return S_OK;
      },
      (_t: number, ctx: number, x: number, y: number, underline: number, effect: number) => {
        this.drawUnderline(x, y, readUnderline(abi, underline), this.effect(effect), ctx);
        return S_OK;
      },
      (_t: number, ctx: number, x: number, y: number, strikethrough: number, effect: number) => {
        this.drawStrikethrough(x, y, readStrikethrough(abi, strikethrough), this.effect(effect), ctx);
        return S_OK;
      },
      (_t: number, ctx: number, x: number, y: number, inlineObject: number, isSideways: number, isRtl: number, effect: number) => {
        this.drawInlineObject(x, y, inlineObject, !!isSideways, !!isRtl, this.effect(effect), ctx);
        return S_OK;
      },
    ];
  }
}

export interface RenderTarget {
  target: IDWriteBitmapRenderTarget;
  params: IDWriteRenderingParams;
  color: number; // COLORREF
  colorGlyphs?: boolean;
  colorPaletteIndex?: number;
  pixelsPerDip?: number;
}

export class TextRenderer extends TextRendererBase {
  private current: RenderTarget | null = null;
  private readonly blackBox: number;

  constructor(abi: Abi) {
    super(abi);
    this.blackBox = abi.allocZeroed(16);
  }

  /** Draw a laid-out object via its Draw method (anything exposing `draw(renderer, x, y)`). */
  render(layout: { draw(renderer: { ptr: number }, x: number, y: number): void }, into: RenderTarget, originX = 0, originY = 0): void {
    this.current = into;
    try {
      layout.draw(this, originX, originY);
    } finally {
      this.current = null;
    }
  }

  protected override getPixelsPerDip(): number { return this.current?.pixelsPerDip || 1; }

  protected override drawGlyphRun(x: number, y: number, run: GlyphRun, measuringMode: DWRITE_MEASURING_MODE): void {
    const c = this.current;
    if (!c) return;
    if (c.colorGlyphs) {
      callMethod(this.abi, c.target.ptr, RT_DrawGlyphRunWithColorSupport,
        x, y, measuringMode, run.ptr, c.params.ptr, c.color, c.colorPaletteIndex ?? 0, this.blackBox);
    } else {
      callMethod(this.abi, c.target.ptr, RT_DrawGlyphRun,
        x, y, measuringMode, run.ptr, c.params.ptr, c.color, this.blackBox);
    }
  }

  protected override drawUnderline(x: number, y: number, u: DWRITE_UNDERLINE): void {
    this.fillRect(x, y + u.offset, u.width, Math.max(1, u.thickness));
  }

  protected override drawStrikethrough(x: number, y: number, s: DWRITE_STRIKETHROUGH): void {
    this.fillRect(x, y + s.offset, s.width, Math.max(1, s.thickness));
  }

  private fillRect(x: number, y: number, w: number, h: number): void {
    const c = this.current;
    if (!c) return;
    const r = c.color & 0xff, g = (c.color >>> 8) & 0xff, b = (c.color >>> 16) & 0xff;
    const px = ((r << 16) | (g << 8) | b) >>> 0;
    const surf = c.target.pixels();
    const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(surf.width, Math.round(x + w)), y1 = Math.min(surf.height, Math.round(y + h));
    for (let row = y0; row < y1; row++) {
      const base = row * surf.width;
      for (let col = x0; col < x1; col++) surf.data[base + col] = px;
    }
  }

  protected override dispose(): void {
    this.abi.free(this.blackBox);
  }
}

export interface OutlineSink {
  path: CanvasPathLike;
  x: number;     // canvas x of the layout's top-left
  y: number;     // canvas y of the layout's top-left
  scale: number; // uniform scale applied to the layout coordinates
}

export class OutlineTextRenderer extends TextRendererBase {
  private sink: OutlineSink | null = null;

  render(layout: { draw(renderer: { ptr: number }, x: number, y: number): void }, into: OutlineSink): void {
    this.sink = into;
    try {
      layout.draw(this, 0, 0);
    } finally {
      this.sink = null;
    }
  }

  protected override drawGlyphRun(x: number, y: number, run: GlyphRun): void {
    const s = this.sink;
    if (!s) return;
    using sink = new GeometrySink(this.abi);
    run.fontFace.getGlyphRunOutline(run.fontEmSize, [...run.glyphIndices], sink, {
      glyphAdvances: [...run.glyphAdvances],
      glyphOffsets: run.glyphOffsets,
      isSideways: run.isSideways,
      isRightToLeft: (run.bidiLevel & 1) === 1,
    });
    
    sink.replay(s.path, (gx, gy) => [s.x + (x + gx) * s.scale, s.y + (y + gy) * s.scale]);
  }

  protected override drawUnderline(x: number, y: number, u: DWRITE_UNDERLINE): void {
    this.rect(x, y + u.offset, u.width, Math.max(1, u.thickness));
  }
  protected override drawStrikethrough(x: number, y: number, st: DWRITE_STRIKETHROUGH): void {
    this.rect(x, y + st.offset, st.width, Math.max(1, st.thickness));
  }

  private rect(x: number, y: number, w: number, h: number): void {
    const s = this.sink;
    if (!s) return;
    const px = (vx: number, vy: number): [number, number] => [s.x + vx * s.scale, s.y + vy * s.scale];
    s.path.moveTo(...px(x, y));
    s.path.lineTo(...px(x + w, y));
    s.path.lineTo(...px(x + w, y + h));
    s.path.lineTo(...px(x, y + h));
    s.path.closePath();
  }
}
