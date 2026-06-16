import { Abi } from "./abi.js";
import { DWRITE_GLYPH_RUN, readGlyphRun } from "./structs.g.js";
import { DWRITE_MEASURING_MODE } from "./types.js";

export * from "./structs.g.js"

export interface DWRITE_COLOR_F { r: number; g: number; b: number; a: number; }
export const DWRITE_COLOR_F_SIZE = 16;
export function readColorF(abi: Abi, p: number): DWRITE_COLOR_F {
  const dv = abi.dv;
  return { r: dv.getFloat32(p + 0, true), g: dv.getFloat32(p + 4, true), b: dv.getFloat32(p + 8, true), a: dv.getFloat32(p + 12, true) };
}

export interface DWRITE_COLOR_GLYPH_RUN {
  glyphRun: DWRITE_GLYPH_RUN;
  glyphRunDescription: number;
  baselineOriginX: number;
  baselineOriginY: number;
  runColor: DWRITE_COLOR_F;
  paletteIndex: number;
}
export const DWRITE_COLOR_GLYPH_RUN_SIZE = 64;
export function readColorGlyphRun(abi: Abi, p: number): DWRITE_COLOR_GLYPH_RUN {
  return {
    glyphRun: readGlyphRun(abi, p + 0),
    glyphRunDescription: abi.readU32(p + 32),
    baselineOriginX: abi.readF32(p + 36),
    baselineOriginY: abi.readF32(p + 40),
    runColor: readColorF(abi, p + 44),
    paletteIndex: abi.readU16(p + 60),
  };
}

export interface DWRITE_COLOR_GLYPH_RUN1 extends DWRITE_COLOR_GLYPH_RUN {
  glyphImageFormat: number;
  measuringMode: DWRITE_MEASURING_MODE;
}
export const DWRITE_COLOR_GLYPH_RUN1_SIZE = 72;
export function readColorGlyphRun1(abi: Abi, p: number): DWRITE_COLOR_GLYPH_RUN1 {
  return {
    ...readColorGlyphRun(abi, p),
    glyphImageFormat: abi.readU32(p + 64),
    measuringMode: abi.readU32(p + 68),
  };
}

export interface Point2L { x: number; y: number; }

export interface DWRITE_GLYPH_IMAGE_DATA {
  imageData: number;
  imageDataSize: number;
  uniqueDataId: number;
  pixelsPerEm: number;
  pixelSize: { width: number; height: number };
  horizontalLeftOrigin: Point2L;
  horizontalRightOrigin: Point2L;
  verticalTopOrigin: Point2L;
  verticalBottomOrigin: Point2L;
}
export const DWRITE_GLYPH_IMAGE_DATA_SIZE = 56;
const readPoint2L = (abi: Abi, p: number): Point2L => ({ x: abi.readI32(p), y: abi.readI32(p + 4) });
export function readGlyphImageData(abi: Abi, p: number): DWRITE_GLYPH_IMAGE_DATA {
  return {
    imageData: abi.readU32(p + 0),
    imageDataSize: abi.readU32(p + 4),
    uniqueDataId: abi.readU32(p + 8),
    pixelsPerEm: abi.readU32(p + 12),
    pixelSize: { width: abi.readU32(p + 16), height: abi.readU32(p + 20) },
    horizontalLeftOrigin: readPoint2L(abi, p + 24),
    horizontalRightOrigin: readPoint2L(abi, p + 32),
    verticalTopOrigin: readPoint2L(abi, p + 40),
    verticalBottomOrigin: readPoint2L(abi, p + 48),
  };
}
