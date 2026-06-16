import type { Abi } from "../core/abi.js";
import { checkHr, E_NOT_SUFFICIENT_BUFFER } from "../core/com.js";
import { IDWriteTextAnalyzer as IDWriteTextAnalyzerBase } from "./IDWriteTextAnalyzer.g.js";
import { IDWriteTextAnalyzer2Slot as Slot } from "../core/slots.g.js";
import { IDWriteFontFace } from "./IDWriteFontFace.js";
import { IDWriteNumberSubstitution } from "./IDWriteNumberSubstitution.g.js";
import {
  writeScriptAnalysis, writeMatrix, readGlyphOffset, writeGlyphOffsets,
  readJustificationOpportunity, writeJustificationOpportunitys,
  DWRITE_GLYPH_OFFSET_SIZE, DWRITE_JUSTIFICATION_OPPORTUNITY_SIZE,
  type DWRITE_SCRIPT_ANALYSIS, type DWRITE_GLYPH_OFFSET, type DWRITE_MATRIX,
  type DWRITE_JUSTIFICATION_OPPORTUNITY,
} from "../core/structs.g.js";

export interface ShapedGlyphs {
  clusterMap: number[];
  textProps: Uint16Array;
  glyphIndices: number[];
  glyphProps: Uint16Array;
  actualGlyphCount: number;
}

export interface GetGlyphsOptions {
  isSideways?: boolean;
  isRightToLeft?: boolean;
  localeName?: string;
  numberSubstitution?: IDWriteNumberSubstitution;
}

export interface GlyphPlacements {
  glyphAdvances: number[];
  glyphOffsets: DWRITE_GLYPH_OFFSET[];
}

export interface ApplyCharacterSpacingArgs {
  clusterMap: number[];
  glyphAdvances: number[];
  glyphOffsets: DWRITE_GLYPH_OFFSET[];
  glyphProps: Uint16Array;
  leadingSpacing?: number;
  trailingSpacing?: number;
  minimumAdvanceWidth?: number;
  textLength?: number;
  glyphCount?: number;
}

export interface JustificationOpportunitiesArgs {
  fontFace?: IDWriteFontFace;
  fontEmSize: number;
  scriptAnalysis: DWRITE_SCRIPT_ANALYSIS;
  textString: string;
  clusterMap: number[];
  glyphProps: Uint16Array;
  glyphCount?: number;
}

export interface JustifyGlyphAdvancesArgs {
  lineWidth: number;
  justificationOpportunities: DWRITE_JUSTIFICATION_OPPORTUNITY[];
  glyphAdvances: number[];
  glyphOffsets: DWRITE_GLYPH_OFFSET[];
  glyphCount?: number;
}

export interface GetJustifiedGlyphsArgs {
  fontFace?: IDWriteFontFace;
  fontEmSize: number;
  scriptAnalysis: DWRITE_SCRIPT_ANALYSIS;
  textLength: number;
  clusterMap: number[];
  glyphIndices: number[];
  glyphAdvances: number[];
  justifiedGlyphAdvances: number[];
  justifiedGlyphOffsets: DWRITE_GLYPH_OFFSET[];
  glyphProps: Uint16Array;
  glyphCount?: number;
  maxGlyphCount?: number;
}

export interface JustifiedGlyphs {
  actualGlyphCount: number;
  modifiedClusterMap: number[];
  modifiedGlyphIndices: number[];
  modifiedGlyphAdvances: number[];
  modifiedGlyphOffsets: DWRITE_GLYPH_OFFSET[];
}

export interface GetGlyphPlacementsArgs {
  textString: string;
  clusterMap: number[];
  textProps: Uint16Array;
  glyphIndices: number[];
  glyphProps: Uint16Array;
  fontFace: IDWriteFontFace;
  fontEmSize: number;
  scriptAnalysis: DWRITE_SCRIPT_ANALYSIS;
  glyphCount?: number;
  isSideways?: boolean;
  isRightToLeft?: boolean;
  localeName?: string;
}

export interface GetGdiCompatibleGlyphPlacementsArgs extends GetGlyphPlacementsArgs {
  pixelsPerDip: number;
  transform?: DWRITE_MATRIX;
  useGdiNatural?: boolean;
}

export interface ShapingGlyphProperties {
  justification: number;
  isClusterStart: boolean;
  isDiacritic: boolean;
  isZeroWidthSpace: boolean;
}

export interface ShapingTextProperties {
  isShapedAlone: boolean;
  canBreakShapingAfter: boolean;
}

/** Decode a packed `DWRITE_SHAPING_GLYPH_PROPERTIES` UINT16. */
export function decodeShapingGlyphProperties(v: number): ShapingGlyphProperties {
  return {
    justification: v & 0xf,
    isClusterStart: (v & 0x10) !== 0,
    isDiacritic: (v & 0x20) !== 0,
    isZeroWidthSpace: (v & 0x40) !== 0,
  };
}

/** Decode a packed `DWRITE_SHAPING_TEXT_PROPERTIES` UINT16. */
export function decodeShapingTextProperties(v: number): ShapingTextProperties {
  return {
    isShapedAlone: (v & 0x1) !== 0,
    canBreakShapingAfter: (v & 0x4) !== 0,
  };
}

export class IDWriteTextAnalyzer extends IDWriteTextAnalyzerBase {
  static override from(abi: Abi, ptr: number): IDWriteTextAnalyzer {
    return new IDWriteTextAnalyzer(abi, ptr);
  }
  getGlyphs(
    textString: string,
    scriptAnalysis: DWRITE_SCRIPT_ANALYSIS,
    fontFace: IDWriteFontFace,
    opts: GetGlyphsOptions = {},
  ): ShapedGlyphs {
    const { isSideways = false, isRightToLeft = false, localeName = "", numberSubstitution } = opts;
    const textLength = textString.length;
    // DWrite's recommended starting estimate for the glyph buffer.
    let maxGlyphCount = ((3 * textLength) >> 1) + 16;
    for (; ;) {
      using s = this.abi.scope();
      const textPtr = s.allocWString(textString);
      const saPtr = writeScriptAnalysis(this.abi, s, scriptAnalysis);
      const localePtr = localeName ? s.allocWString(localeName) : 0;
      const clusterMapPtr = s.allocZeroed(textLength * 2);
      const textPropsPtr = s.allocZeroed(textLength * 2);
      const glyphIndicesPtr = s.allocZeroed(maxGlyphCount * 2);
      const glyphPropsPtr = s.allocZeroed(maxGlyphCount * 2);
      const actualGlyphCountPtr = s.allocZeroed(4);
      const hr = this.invoke(
        Slot.GetGlyphs,
        textPtr, textLength, fontFace.ptr,
        isSideways ? 1 : 0, isRightToLeft ? 1 : 0, saPtr, localePtr,
        numberSubstitution ? numberSubstitution.ptr : 0,
        0 /* features */, 0 /* featureRangeLengths */, 0 /* featureRanges */,
        maxGlyphCount, clusterMapPtr, textPropsPtr, glyphIndicesPtr, glyphPropsPtr, actualGlyphCountPtr,
      );
      if ((hr | 0) === E_NOT_SUFFICIENT_BUFFER) {
        maxGlyphCount *= 2;
        continue;
      }
      checkHr(hr, "IDWriteTextAnalyzer::GetGlyphs");
      const actualGlyphCount = this.abi.readU32(actualGlyphCountPtr) >>> 0;
      const clusterMap: number[] = [];
      for (let i = 0; i < textLength; i++) clusterMap.push(this.abi.readU16(clusterMapPtr + i * 2));
      const glyphIndices: number[] = [];
      for (let i = 0; i < actualGlyphCount; i++) glyphIndices.push(this.abi.readU16(glyphIndicesPtr + i * 2));
      const textProps = new Uint16Array(textLength);
      for (let i = 0; i < textLength; i++) textProps[i] = this.abi.readU16(textPropsPtr + i * 2);
      const glyphProps = new Uint16Array(actualGlyphCount);
      for (let i = 0; i < actualGlyphCount; i++) glyphProps[i] = this.abi.readU16(glyphPropsPtr + i * 2);
      return { clusterMap, textProps, glyphIndices, glyphProps, actualGlyphCount };
    }
  }

  getGlyphPlacements(args: GetGlyphPlacementsArgs): GlyphPlacements {
    const {
      textString, clusterMap, textProps, glyphIndices, glyphProps, fontFace, fontEmSize, scriptAnalysis,
      glyphCount = glyphIndices.length, isSideways = false, isRightToLeft = false, localeName = "",
    } = args;
    using s = this.abi.scope();
    const { glyphAdvancesPtr, glyphOffsetsPtr } = this.runPlacements(
      s, Slot.GetGlyphPlacements,
      [
        s.allocWString(textString),
        this.writeU16Array(s, clusterMap),
        this.writePacked(s, textProps),
        textString.length,
        this.writeU16Array(s, glyphIndices),
        this.writePacked(s, glyphProps),
        glyphCount,
        fontFace.ptr, fontEmSize, isSideways ? 1 : 0, isRightToLeft ? 1 : 0,
        writeScriptAnalysis(this.abi, s, scriptAnalysis),
        localeName ? s.allocWString(localeName) : 0,
        0 /* features */, 0 /* featureRangeLengths */, 0 /* featureRanges */,
      ],
      glyphCount, "IDWriteTextAnalyzer::GetGlyphPlacements",
    );
    return this.readPlacements(glyphAdvancesPtr, glyphOffsetsPtr, glyphCount);
  }

  getGdiCompatibleGlyphPlacements(args: GetGdiCompatibleGlyphPlacementsArgs): GlyphPlacements {
    const {
      textString, clusterMap, textProps, glyphIndices, glyphProps, fontFace, fontEmSize, scriptAnalysis,
      pixelsPerDip, transform, useGdiNatural = false,
      glyphCount = glyphIndices.length, isSideways = false, isRightToLeft = false, localeName = "",
    } = args;
    using s = this.abi.scope();
    const { glyphAdvancesPtr, glyphOffsetsPtr } = this.runPlacements(
      s, Slot.GetGdiCompatibleGlyphPlacements,
      [
        s.allocWString(textString),
        this.writeU16Array(s, clusterMap),
        this.writePacked(s, textProps),
        textString.length,
        this.writeU16Array(s, glyphIndices),
        this.writePacked(s, glyphProps),
        glyphCount,
        fontFace.ptr, fontEmSize, pixelsPerDip,
        transform ? writeMatrix(this.abi, s, transform) : 0,
        useGdiNatural ? 1 : 0, isSideways ? 1 : 0, isRightToLeft ? 1 : 0,
        writeScriptAnalysis(this.abi, s, scriptAnalysis),
        localeName ? s.allocWString(localeName) : 0,
        0 /* features */, 0 /* featureRangeLengths */, 0 /* featureRanges */,
      ],
      glyphCount, "IDWriteTextAnalyzer::GetGdiCompatibleGlyphPlacements",
    );
    return this.readPlacements(glyphAdvancesPtr, glyphOffsetsPtr, glyphCount);
  }

  applyCharacterSpacing(args: ApplyCharacterSpacingArgs): GlyphPlacements {
    const {
      clusterMap, glyphAdvances, glyphOffsets, glyphProps,
      leadingSpacing = 0, trailingSpacing = 0, minimumAdvanceWidth = 0,
      textLength = clusterMap.length, glyphCount = glyphAdvances.length,
    } = args;
    using s = this.abi.scope();
    const modifiedAdvancesPtr = s.allocZeroed(glyphCount * 4);
    const modifiedOffsetsPtr = s.allocZeroed(glyphCount * DWRITE_GLYPH_OFFSET_SIZE);
    checkHr(this.invoke(
      Slot.ApplyCharacterSpacing,
      leadingSpacing, trailingSpacing, minimumAdvanceWidth, textLength, glyphCount,
      this.writeU16Array(s, clusterMap),
      this.writeF32Array(s, glyphAdvances),
      writeGlyphOffsets(this.abi, s, glyphOffsets),
      this.writePacked(s, glyphProps),
      modifiedAdvancesPtr, modifiedOffsetsPtr,
    ), "IDWriteTextAnalyzer::ApplyCharacterSpacing");
    return this.readPlacements(modifiedAdvancesPtr, modifiedOffsetsPtr, glyphCount);
  }

  getJustificationOpportunities(args: JustificationOpportunitiesArgs): DWRITE_JUSTIFICATION_OPPORTUNITY[] {
    const {
      fontFace, fontEmSize, scriptAnalysis, textString, clusterMap, glyphProps,
      glyphCount = glyphProps.length,
    } = args;
    using s = this.abi.scope();
    const outPtr = s.allocZeroed(glyphCount * DWRITE_JUSTIFICATION_OPPORTUNITY_SIZE);
    checkHr(this.invoke(
      Slot.GetJustificationOpportunities,
      fontFace ? fontFace.ptr : 0, fontEmSize,
      writeScriptAnalysis(this.abi, s, scriptAnalysis),
      textString.length, glyphCount,
      s.allocWString(textString),
      this.writeU16Array(s, clusterMap),
      this.writePacked(s, glyphProps),
      outPtr,
    ), "IDWriteTextAnalyzer::GetJustificationOpportunities");
    const out: DWRITE_JUSTIFICATION_OPPORTUNITY[] = [];
    for (let i = 0; i < glyphCount; i++)
      out.push(readJustificationOpportunity(this.abi, outPtr + i * DWRITE_JUSTIFICATION_OPPORTUNITY_SIZE));
    return out;
  }

  justifyGlyphAdvances(args: JustifyGlyphAdvancesArgs): GlyphPlacements {
    const {
      lineWidth, justificationOpportunities, glyphAdvances, glyphOffsets,
      glyphCount = glyphAdvances.length,
    } = args;
    using s = this.abi.scope();
    const justAdvancesPtr = s.allocZeroed(glyphCount * 4);
    const justOffsetsPtr = s.allocZeroed(glyphCount * DWRITE_GLYPH_OFFSET_SIZE);
    checkHr(this.invoke(
      Slot.JustifyGlyphAdvances,
      lineWidth, glyphCount,
      writeJustificationOpportunitys(this.abi, s, justificationOpportunities),
      this.writeF32Array(s, glyphAdvances),
      writeGlyphOffsets(this.abi, s, glyphOffsets),
      justAdvancesPtr, justOffsetsPtr,
    ), "IDWriteTextAnalyzer::JustifyGlyphAdvances");
    return this.readPlacements(justAdvancesPtr, justOffsetsPtr, glyphCount);
  }

  getJustifiedGlyphs(args: GetJustifiedGlyphsArgs): JustifiedGlyphs {
    const {
      fontFace, fontEmSize, scriptAnalysis, textLength, clusterMap, glyphIndices,
      glyphAdvances, justifiedGlyphAdvances, justifiedGlyphOffsets, glyphProps,
      glyphCount = glyphIndices.length,
    } = args;
    let maxGlyphCount = args.maxGlyphCount ?? (glyphCount * 2 + 16);
    for (; ;) {
      using s = this.abi.scope();
      const actualGlyphCountPtr = s.allocZeroed(4);
      const modifiedClusterMapPtr = s.allocZeroed(textLength * 2);
      const modifiedGlyphIndicesPtr = s.allocZeroed(maxGlyphCount * 2);
      const modifiedGlyphAdvancesPtr = s.allocZeroed(maxGlyphCount * 4);
      const modifiedGlyphOffsetsPtr = s.allocZeroed(maxGlyphCount * DWRITE_GLYPH_OFFSET_SIZE);
      const hr = this.invoke(
        Slot.GetJustifiedGlyphs,
        fontFace ? fontFace.ptr : 0, fontEmSize,
        writeScriptAnalysis(this.abi, s, scriptAnalysis),
        textLength, glyphCount, maxGlyphCount,
        this.writeU16Array(s, clusterMap),
        this.writeU16Array(s, glyphIndices),
        this.writeF32Array(s, glyphAdvances),
        this.writeF32Array(s, justifiedGlyphAdvances),
        writeGlyphOffsets(this.abi, s, justifiedGlyphOffsets),
        this.writePacked(s, glyphProps),
        actualGlyphCountPtr, modifiedClusterMapPtr, modifiedGlyphIndicesPtr,
        modifiedGlyphAdvancesPtr, modifiedGlyphOffsetsPtr,
      );
      if ((hr | 0) === E_NOT_SUFFICIENT_BUFFER) { maxGlyphCount *= 2; continue; }
      checkHr(hr, "IDWriteTextAnalyzer::GetJustifiedGlyphs");
      const actualGlyphCount = this.abi.readU32(actualGlyphCountPtr) >>> 0;
      const modifiedClusterMap: number[] = [];
      for (let i = 0; i < textLength; i++) modifiedClusterMap.push(this.abi.readU16(modifiedClusterMapPtr + i * 2));
      const modifiedGlyphIndices: number[] = [];
      for (let i = 0; i < actualGlyphCount; i++) modifiedGlyphIndices.push(this.abi.readU16(modifiedGlyphIndicesPtr + i * 2));
      const { glyphAdvances: modifiedGlyphAdvances, glyphOffsets: modifiedGlyphOffsets } =
        this.readPlacements(modifiedGlyphAdvancesPtr, modifiedGlyphOffsetsPtr, actualGlyphCount);
      return { actualGlyphCount, modifiedClusterMap, modifiedGlyphIndices, modifiedGlyphAdvances, modifiedGlyphOffsets };
    }
  }

  private runPlacements(
    s: ReturnType<Abi["scope"]>, slot: number, inArgs: number[], glyphCount: number, what: string,
  ): { glyphAdvancesPtr: number; glyphOffsetsPtr: number } {
    const glyphAdvancesPtr = s.allocZeroed(glyphCount * 4);
    const glyphOffsetsPtr = s.allocZeroed(glyphCount * DWRITE_GLYPH_OFFSET_SIZE);
    checkHr(this.invoke(slot, ...inArgs, glyphAdvancesPtr, glyphOffsetsPtr), what);
    return { glyphAdvancesPtr, glyphOffsetsPtr };
  }

  private readPlacements(glyphAdvancesPtr: number, glyphOffsetsPtr: number, glyphCount: number): GlyphPlacements {
    const glyphAdvances: number[] = [];
    for (let i = 0; i < glyphCount; i++) glyphAdvances.push(this.abi.readF32(glyphAdvancesPtr + i * 4));
    const glyphOffsets: DWRITE_GLYPH_OFFSET[] = [];
    for (let i = 0; i < glyphCount; i++) glyphOffsets.push(readGlyphOffset(this.abi, glyphOffsetsPtr + i * DWRITE_GLYPH_OFFSET_SIZE));
    return { glyphAdvances, glyphOffsets };
  }

  private writeU16Array(s: ReturnType<Abi["scope"]>, values: ArrayLike<number>): number {
    const ptr = s.allocZeroed(values.length * 2);
    for (let i = 0; i < values.length; i++) this.abi.writeU16(ptr + i * 2, values[i]!);
    return ptr;
  }

  private writePacked(s: ReturnType<Abi["scope"]>, values: Uint16Array): number {
    const ptr = s.allocZeroed(values.length * 2);
    for (let i = 0; i < values.length; i++) this.abi.writeU16(ptr + i * 2, values[i]!);
    return ptr;
  }

  private writeF32Array(s: ReturnType<Abi["scope"]>, values: ArrayLike<number>): number {
    const ptr = s.allocZeroed(values.length * 4);
    for (let i = 0; i < values.length; i++) this.abi.writeF32(ptr + i * 4, values[i]!);
    return ptr;
  }
}
