import type { Abi } from "../core/abi.js";
import { IUnknown, S_OK } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWritePixelSnapping, IID_IDWriteTextRenderer } from "../core/iids.js";
import { I32, F32, type TrampolineSig } from "../core/trampoline.js";
import { DWRITE_MEASURING_MODE } from "../core/types.js";
import { readUnderline, readStrikethrough, type DWRITE_UNDERLINE, type DWRITE_STRIKETHROUGH } from "../core/structs.g.js";
import { IDWriteFontFace } from "../interfaces/IDWriteFontFace.js";

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

export const RT_DrawGlyphRun = 3;
export const RT_DrawGlyphRunWithColorSupport = 16; // IDWriteBitmapRenderTarget3
export const IDENTITY: readonly [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];

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

