import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import {
  readGlyphMetrics, type DWRITE_GLYPH_METRICS, DWRITE_GLYPH_METRICS_SIZE,
  readFontAxisValues, DWRITE_FONT_AXIS_VALUE_SIZE,
} from "../core/types.js";
import {
  readColorF, DWRITE_COLOR_F_SIZE, type DWRITE_COLOR_F,
  readGlyphImageData, DWRITE_GLYPH_IMAGE_DATA_SIZE, type DWRITE_GLYPH_IMAGE_DATA,
} from "../core/structs.js";
import { IDWriteFontFace as IDWriteFontFaceBase } from "./IDWriteFontFace.g.js";
import { IDWriteFontFace7Slot as Slot } from "../core/slots.g.js";

/** The result of {@link IDWriteFontFace.getGlyphImageData}: the metrics plus a copy of the bytes. */
export interface GlyphImageData extends Omit<DWRITE_GLYPH_IMAGE_DATA, "imageData"> {
  /** A copy of the glyph's image bytes (PNG/JPEG/TIFF/raw per the requested format). */
  data: Uint8Array;
}

export class IDWriteFontFace extends IDWriteFontFaceBase {
  static override from(abi: Abi, ptr: number): IDWriteFontFace {
    return new IDWriteFontFace(abi, ptr);
  }

  // The axis values this face is instantiated at (e.g. [{tag:"wght",value:700}, ...]).
  get fontAxisValues(): { tag: string; value: number }[] {
    const n = this.invoke(Slot.GetFontAxisValueCount) >>> 0;
    if (n === 0) return [];
    using s = this.abi.scope();
    const buf = s.allocZeroed(n * DWRITE_FONT_AXIS_VALUE_SIZE);
    checkHr(this.invoke(Slot.GetFontAxisValues, buf, n), "GetFontAxisValues");
    return readFontAxisValues(this.abi, buf, n);
  }

  getGlyphIndices(codePoints: number[]): number[] {
    using s = this.abi.scope();
    const n = codePoints.length;
    const cpPtr = s.alloc(n * 4);
    for (let i = 0; i < n; i++) this.abi.writeU32(cpPtr + i * 4, codePoints[i]!);
    const outPtr = s.allocZeroed(n * 2);
    checkHr(this.invoke(Slot.GetGlyphIndices, cpPtr, n, outPtr), "GetGlyphIndices");
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.abi.readU16(outPtr + i * 2));
    return out;
  }

  getGlyphRunOutline(
    emSize: number,
    glyphIndices: number[],
    geometrySink: { ptr: number },
    opts: {
      glyphAdvances?: number[];
      glyphOffsets?: { advanceOffset: number; ascenderOffset: number }[];
      isSideways?: boolean;
      isRightToLeft?: boolean;
    } = {},
  ): void {
    const { glyphAdvances, glyphOffsets, isSideways = false, isRightToLeft = false } = opts;
    using s = this.abi.scope();
    const n = glyphIndices.length;
    const idxPtr = s.alloc(n * 2);
    for (let i = 0; i < n; i++) this.abi.writeU16(idxPtr + i * 2, glyphIndices[i]!);
    let advPtr = 0;
    if (glyphAdvances) {
      advPtr = s.alloc(glyphAdvances.length * 4);
      for (let i = 0; i < glyphAdvances.length; i++) this.abi.writeF32(advPtr + i * 4, glyphAdvances[i]!);
    }
    let offPtr = 0;
    if (glyphOffsets) {
      offPtr = s.alloc(glyphOffsets.length * 8); // DWRITE_GLYPH_OFFSET = 2 x f32
      for (let i = 0; i < glyphOffsets.length; i++) {
        this.abi.writeF32(offPtr + i * 8, glyphOffsets[i]!.advanceOffset);
        this.abi.writeF32(offPtr + i * 8 + 4, glyphOffsets[i]!.ascenderOffset);
      }
    }
    checkHr(this.invoke(
      Slot.GetGlyphRunOutline,
      emSize, idxPtr, advPtr, offPtr, n,
      isSideways ? 1 : 0, isRightToLeft ? 1 : 0, geometrySink.ptr,
    ), "GetGlyphRunOutline");
  }

  getPanose(): Uint8Array {
    using s = this.abi.scope();
    const buf = s.allocZeroed(10);
    this.invoke(Slot.GetPanose, buf);
    return this.abi.u8.slice(buf, buf + 10);
  }

  getPaletteEntries(colorPaletteIndex: number, firstEntryIndex: number, entryCount: number): DWRITE_COLOR_F[] {
    using s = this.abi.scope();
    const buf = s.allocZeroed(entryCount * DWRITE_COLOR_F_SIZE);
    checkHr(this.invoke(Slot.GetPaletteEntries, colorPaletteIndex, firstEntryIndex, entryCount, buf),
      "GetPaletteEntries");
    const out: DWRITE_COLOR_F[] = [];
    for (let i = 0; i < entryCount; i++) out.push(readColorF(this.abi, buf + i * DWRITE_COLOR_F_SIZE));
    return out;
  }
  
  getGlyphImageData(glyphId: number, pixelsPerEm: number, glyphImageFormat: number): GlyphImageData {
    using s = this.abi.scope();
    const dataPtr = s.allocZeroed(DWRITE_GLYPH_IMAGE_DATA_SIZE);
    const contextPtr = s.allocZeroed(4);
    checkHr(this.invoke(Slot.GetGlyphImageData, glyphId, pixelsPerEm, glyphImageFormat, dataPtr, contextPtr),
      "GetGlyphImageData");
    const d = readGlyphImageData(this.abi, dataPtr);
    const data = this.abi.u8.slice(d.imageData, d.imageData + d.imageDataSize);
    this.invoke(Slot.ReleaseGlyphImageData, this.abi.readU32(contextPtr));
    const { imageData: _ignored, ...rest } = d;
    return { ...rest, data };
  }

  getDesignGlyphMetrics(glyphIndices: number[], isSideways = false): DWRITE_GLYPH_METRICS[] {
    using s = this.abi.scope();
    const n = glyphIndices.length;
    const idxPtr = s.alloc(n * 2);
    for (let i = 0; i < n; i++) this.abi.writeU16(idxPtr + i * 2, glyphIndices[i]!);
    const outPtr = s.allocZeroed(n * DWRITE_GLYPH_METRICS_SIZE);
    checkHr(this.invoke(Slot.GetDesignGlyphMetrics, idxPtr, n, outPtr, isSideways ? 1 : 0),
      "GetDesignGlyphMetrics");
    const out: DWRITE_GLYPH_METRICS[] = [];
    for (let i = 0; i < n; i++) out.push(readGlyphMetrics(this.abi, outPtr + i * DWRITE_GLYPH_METRICS_SIZE));
    return out;
  }
}
