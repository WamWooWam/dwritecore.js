import { checkHr } from "../core/com.js";
import type { Abi } from "../core/abi.js";
import { IDWriteFactory as IDWriteFactoryBase } from "./IDWriteFactory.g.js";
import { IDWriteTextFormat } from "./IDWriteTextFormat.g.js";
import { IDWriteTextLayout } from "./IDWriteTextLayout.js";
import { IDWriteFontCollection } from "./IDWriteFontCollection.js";
import { IDWriteFontFile } from "./IDWriteFontFile.js";
import { IDWriteFontFace } from "./IDWriteFontFace.js";
import { IDWriteGlyphRunAnalysis } from "./IDWriteGlyphRunAnalysis.js";
import { IDWriteRenderingParams } from "./IDWriteRenderingParams.g.js";
import { IDWriteFontSetBuilder } from "./IDWriteFontSetBuilder.g.js";
import { IDWriteFontFallback } from "./IDWriteFontFallback.g.js";
import { EMOJI_UNICODE_RANGES } from "../core/types.js";
import {
  DWRITE_FONT_WEIGHT, DWRITE_FONT_STYLE, DWRITE_FONT_STRETCH,
  DWRITE_FONT_FACE_TYPE, DWRITE_FONT_SIMULATIONS,
  DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE, DWRITE_PIXEL_GEOMETRY,
  writeGlyphRun, type GlyphRunDesc,
} from "../core/types.js";
import { IDWriteFactory8Slot as Slot } from "../core/slots.g.js";

export interface CustomRenderingParamsOptions {
  gamma?: number;
  enhancedContrast?: number;
  clearTypeLevel?: number;
  pixelGeometry?: DWRITE_PIXEL_GEOMETRY;
  renderingMode?: DWRITE_RENDERING_MODE;
}

export interface CreateTextFormatOptions {
  fontCollection?: IDWriteFontCollection | null;
  weight?: DWRITE_FONT_WEIGHT;
  style?: DWRITE_FONT_STYLE;
  stretch?: DWRITE_FONT_STRETCH;
  fontSize?: number;
  localeName?: string;
}

export class IDWriteFactory extends IDWriteFactoryBase {
  static override from(abi: Abi, ptr: number): IDWriteFactory {
    return new IDWriteFactory(abi, ptr);
  }

  override getSystemFontCollection(checkForUpdates = false): IDWriteFontCollection {
    return super.getSystemFontCollection(checkForUpdates);
  }

  createTextFormat(fontFamilyName: string, opts: CreateTextFormatOptions = {}): IDWriteTextFormat {
    const {
      fontCollection = null,
      weight = DWRITE_FONT_WEIGHT.NORMAL,
      style = DWRITE_FONT_STYLE.NORMAL,
      stretch = DWRITE_FONT_STRETCH.NORMAL,
      fontSize = 12,
      localeName = "en-us",
    } = opts;
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(
      Slot.CreateTextFormat,
      s.allocWString(fontFamilyName),
      fontCollection ? fontCollection.ptr : 0,
      weight, style, stretch,
      fontSize,
      s.allocWString(localeName),
      out,
    ), "CreateTextFormat");
    return IDWriteTextFormat.from(this.abi, this.abi.readPtr(out));
  }

  createGdiCompatibleTextLayout(
    text: string, textFormat: IDWriteTextFormat, maxWidth: number, maxHeight: number,
    pixelsPerDip = 1, useGdiNatural = false,
  ): IDWriteTextLayout {
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(
      Slot.CreateGdiCompatibleTextLayout,
      s.allocWString(text), text.length, textFormat.ptr,
      maxWidth, maxHeight, pixelsPerDip,
      0, // transform
      useGdiNatural ? 1 : 0,
      out,
    ), "CreateGdiCompatibleTextLayout");
    return IDWriteTextLayout.from(this.abi, this.abi.readPtr(out));
  }

  createCustomRenderingParams(opts: CustomRenderingParamsOptions = {}): IDWriteRenderingParams {
    const {
      gamma = 1.8,
      enhancedContrast = 0.5,
      clearTypeLevel = 1.0,
      pixelGeometry = DWRITE_PIXEL_GEOMETRY.RGB,
      renderingMode = DWRITE_RENDERING_MODE.DEFAULT,
    } = opts;
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(
      Slot.CreateCustomRenderingParams,
      gamma, enhancedContrast, clearTypeLevel,
      pixelGeometry, renderingMode,
      out,
    ), "CreateCustomRenderingParams");
    return IDWriteRenderingParams.from(this.abi, this.abi.readPtr(out));
  }

  override createFontSetBuilder(): IDWriteFontSetBuilder {
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(Slot.CreateFontSetBuilder5, out), "CreateFontSetBuilder");
    return IDWriteFontSetBuilder.from(this.abi, this.abi.readPtr(out));
  }

  createEmojiFontFallback(collection: IDWriteFontCollection, emojiFamily = "Segoe UI Emoji"): IDWriteFontFallback {
    using builder = this.createFontFallbackBuilder();
    builder.addMapping(EMOJI_UNICODE_RANGES, [emojiFamily], { fontCollection: collection });
    return builder.createFontFallback();
  }

  createFontCollection(filePaths: string[]): IDWriteFontCollection {
    using builder = this.createFontSetBuilder();
    for (const path of filePaths) {
      using file = this.createFontFileReference(path);
      builder.addFontFile(file);
    }
    using fontSet = builder.createFontSet();
    return this.createFontCollectionFromFontSet(fontSet);
  }

  createFontFileReference(filePath: string): IDWriteFontFile {
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(Slot.CreateFontFileReference, s.allocWString(filePath), 0, out),
      "CreateFontFileReference");
    return IDWriteFontFile.from(this.abi, this.abi.readPtr(out));
  }

  createFontFace(
    fontFaceType: DWRITE_FONT_FACE_TYPE,
    fontFiles: IDWriteFontFile[],
    faceIndex = 0,
    simulations: DWRITE_FONT_SIMULATIONS = DWRITE_FONT_SIMULATIONS.NONE,
  ): IDWriteFontFace {
    using s = this.abi.scope();
    const filesPtr = s.alloc(fontFiles.length * 4);
    fontFiles.forEach((f, i) => this.abi.writeU32(filesPtr + i * 4, f.ptr));
    const out = s.out();
    checkHr(this.invoke(Slot.CreateFontFace, fontFaceType, fontFiles.length, filesPtr, faceIndex, simulations, out),
      "CreateFontFace");
    return IDWriteFontFace.from(this.abi, this.abi.readPtr(out));
  }

  loadFontFace(filePath: string, faceIndex = 0): IDWriteFontFace {
    const file = this.createFontFileReference(filePath);
    const info = file.analyze();
    if (!info.isSupported) throw new Error(`unsupported font file: ${filePath}`);
    return this.createFontFace(info.faceType, [file], faceIndex);
  }

  createGlyphRunAnalysis(
    run: GlyphRunDesc,
    opts: {
      pixelsPerDip?: number;
      renderingMode?: DWRITE_RENDERING_MODE;
      measuringMode?: DWRITE_MEASURING_MODE;
      baselineOriginX?: number;
      baselineOriginY?: number;
    } = {},
  ): IDWriteGlyphRunAnalysis {
    const {
      pixelsPerDip = 1,
      renderingMode = DWRITE_RENDERING_MODE.NATURAL,
      measuringMode = DWRITE_MEASURING_MODE.NATURAL,
      baselineOriginX = 0,
      baselineOriginY = 0,
    } = opts;
    const runPtr = writeGlyphRun(this.abi, this.abi, run);
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(
      Slot.CreateGlyphRunAnalysis,
      runPtr,
      pixelsPerDip,
      0, // transform
      renderingMode,
      measuringMode,
      baselineOriginX,
      baselineOriginY,
      out,
    ), "CreateGlyphRunAnalysis");
    return IDWriteGlyphRunAnalysis.from(this.abi, this.abi.readPtr(out));
  }
}
