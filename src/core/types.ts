import type { Abi, Allocator } from "./abi.js";

export enum DWRITE_FACTORY_TYPE { SHARED = 0, ISOLATED = 1 }

export enum DWRITE_FONT_WEIGHT {
  THIN = 100,
  EXTRA_LIGHT = 200,
  LIGHT = 300,
  SEMI_LIGHT = 350,
  NORMAL = 400,
  MEDIUM = 500,
  SEMI_BOLD = 600,
  BOLD = 700,
  EXTRA_BOLD = 800,
  BLACK = 900,
}

export enum DWRITE_FONT_STYLE { NORMAL = 0, OBLIQUE = 1, ITALIC = 2 }

export enum DWRITE_FONT_STRETCH {
  UNDEFINED = 0,
  ULTRA_CONDENSED = 1,
  EXTRA_CONDENSED = 2,
  CONDENSED = 3,
  SEMI_CONDENSED = 4,
  NORMAL = 5,
  SEMI_EXPANDED = 6,
  EXPANDED = 7,
  EXTRA_EXPANDED = 8,
  ULTRA_EXPANDED = 9,
}

export interface DWRITE_TEXT_METRICS {
  left: number;
  top: number;
  width: number;
  widthIncludingTrailingWhitespace: number;
  height: number;
  layoutWidth: number;
  layoutHeight: number;
  maxBidiReorderingDepth: number;
  lineCount: number;
}

export const DWRITE_TEXT_METRICS_SIZE = 36;

export function readTextMetrics(abi: Abi, p: number): DWRITE_TEXT_METRICS {
  return {
    left: abi.readF32(p + 0),
    top: abi.readF32(p + 4),
    width: abi.readF32(p + 8),
    widthIncludingTrailingWhitespace: abi.readF32(p + 12),
    height: abi.readF32(p + 16),
    layoutWidth: abi.readF32(p + 20),
    layoutHeight: abi.readF32(p + 24),
    maxBidiReorderingDepth: abi.readU32(p + 28),
    lineCount: abi.readU32(p + 32),
  };
}

export enum DWRITE_FONT_FILE_TYPE {
  UNKNOWN = 0, CFF = 1, TRUETYPE = 2, OPENTYPE_COLLECTION = 3,
  TYPE1_PFM = 4, TYPE1_PFB = 5, VECTOR = 6, BITMAP = 7,
}
export enum DWRITE_FONT_FACE_TYPE {
  CFF = 0, TRUETYPE = 1, OPENTYPE_COLLECTION = 2, TYPE1 = 3,
  VECTOR = 4, BITMAP = 5, UNKNOWN = 6, RAW_CFF = 7,
}
export enum DWRITE_FONT_SIMULATIONS { NONE = 0, BOLD = 1, OBLIQUE = 2 }

export enum DWRITE_LOCALITY { REMOTE = 0, PARTIAL = 1, LOCAL = 2 }

export enum DWRITE_INFORMATIONAL_STRING_ID {
  NONE = 0,
  COPYRIGHT_NOTICE = 1,
  VERSION_STRINGS = 2,
  TRADEMARK = 3,
  MANUFACTURER = 4,
  DESIGNER = 5,
  DESIGNER_URL = 6,
  DESCRIPTION = 7,
  FONT_VENDOR_URL = 8,
  LICENSE_DESCRIPTION = 9,
  LICENSE_INFO_URL = 10,
  WIN32_FAMILY_NAMES = 11,
  WIN32_SUBFAMILY_NAMES = 12,
  TYPOGRAPHIC_FAMILY_NAMES = 13,
  TYPOGRAPHIC_SUBFAMILY_NAMES = 14,
  SAMPLE_TEXT = 15,
  FULL_NAME = 16,
  POSTSCRIPT_NAME = 17,
  POSTSCRIPT_CID_NAME = 18,
  WEIGHT_STRETCH_STYLE_FAMILY_NAME = 19,
  DESIGN_SCRIPT_LANGUAGE_TAG = 20,
  SUPPORTED_SCRIPT_LANGUAGE_TAG = 21,
}

export enum DWRITE_TEXT_ALIGNMENT { LEADING = 0, TRAILING = 1, CENTER = 2, JUSTIFIED = 3 }
export enum DWRITE_PARAGRAPH_ALIGNMENT { NEAR = 0, FAR = 1, CENTER = 2 }
export enum DWRITE_WORD_WRAPPING {
  WRAP = 0, NO_WRAP = 1, EMERGENCY_BREAK = 2, WHOLE_WORD = 3, CHARACTER = 4,
}
export enum DWRITE_READING_DIRECTION {
  LEFT_TO_RIGHT = 0, RIGHT_TO_LEFT = 1, TOP_TO_BOTTOM = 2, BOTTOM_TO_TOP = 3,
}
export enum DWRITE_FLOW_DIRECTION {
  TOP_TO_BOTTOM = 0, BOTTOM_TO_TOP = 1, LEFT_TO_RIGHT = 2, RIGHT_TO_LEFT = 3,
}
export enum DWRITE_LINE_SPACING_METHOD { DEFAULT = 0, UNIFORM = 1, PROPORTIONAL = 2 }
export enum DWRITE_TRIMMING_GRANULARITY { NONE = 0, CHARACTER = 1, WORD = 2 }

export interface DWRITE_TEXT_RANGE { startPosition: number; length: number }
export const DWRITE_TEXT_RANGE_SIZE = 8;
export function writeTextRange(abi: Abi, alloc: Allocator, r: DWRITE_TEXT_RANGE): number {
  const p = alloc.alloc(DWRITE_TEXT_RANGE_SIZE);
  abi.writeU32(p + 0, r.startPosition);
  abi.writeU32(p + 4, r.length);
  return p;
}

export interface DWRITE_TRIMMING {
  granularity: DWRITE_TRIMMING_GRANULARITY;
  delimiter?: number;
  delimiterCount?: number;
}
export const DWRITE_TRIMMING_SIZE = 12;
export function writeTrimming(abi: Abi, alloc: Allocator, t: DWRITE_TRIMMING): number {
  const p = alloc.alloc(DWRITE_TRIMMING_SIZE);
  abi.writeU32(p + 0, t.granularity);
  abi.writeU32(p + 4, t.delimiter ?? 0);
  abi.writeU32(p + 8, t.delimiterCount ?? 0);
  return p;
}

export interface DWRITE_UNICODE_RANGE { first: number; last: number }
export function writeUnicodeRanges(abi: Abi, alloc: Allocator, ranges: DWRITE_UNICODE_RANGE[]): number {
  const p = alloc.alloc(ranges.length * 8);
  ranges.forEach((r, i) => {
    abi.writeU32(p + i * 8 + 0, r.first);
    abi.writeU32(p + i * 8 + 4, r.last);
  });
  return p;
}

// The Unicode blocks that carry emoji / pictographs. Mapping these to an emoji family in a
// custom IDWriteFontFallback routes them off the base text font (which would otherwise emit
// .notdef, since DWriteCore's system collection is empty). ZWJ (200D) and the variation
// selectors (FE00-FE0F) are included so emoji sequences stay in one fallback run.
export const EMOJI_UNICODE_RANGES: DWRITE_UNICODE_RANGE[] = [
  { first: 0x0023, last: 0x0023 }, // # (keycap base)
  { first: 0x002a, last: 0x002a }, // * (keycap base)
  { first: 0x0030, last: 0x0039 }, // 0-9 (keycap bases)
  { first: 0x00a9, last: 0x00a9 }, // ©
  { first: 0x00ae, last: 0x00ae }, // ®
  { first: 0x200d, last: 0x200d }, // ZWJ
  { first: 0x203c, last: 0x203c }, // ‼
  { first: 0x2049, last: 0x2049 }, // ⁉
  { first: 0x2122, last: 0x2122 }, // ™
  { first: 0x2194, last: 0x21aa }, // arrows
  { first: 0x231a, last: 0x231b }, // ⌚⌛
  { first: 0x2300, last: 0x23ff }, // misc technical (⏰ etc.)
  { first: 0x2460, last: 0x24ff }, // enclosed alphanumerics
  { first: 0x25a0, last: 0x27bf }, // geometric shapes, misc symbols, dingbats
  { first: 0x2934, last: 0x2935 }, // arrows
  { first: 0x2b00, last: 0x2bff }, // misc symbols & arrows (⭐ etc.)
  { first: 0x3030, last: 0x3030 }, // 〰
  { first: 0x303d, last: 0x303d }, // 〽
  { first: 0x3297, last: 0x3299 }, // ㊗㊙
  { first: 0xfe00, last: 0xfe0f }, // variation selectors
  { first: 0x1f000, last: 0x1faff }, // mahjong .. symbols & pictographs extended-A (the bulk of emoji)
  { first: 0xe0020, last: 0xe007f }, // tag characters (flag subdivisions)
];

export function fontAxisTag(tag: string): number {
  if (tag.length !== 4) throw new Error(`font axis tag must be 4 chars: ${tag}`);
  return (tag.charCodeAt(0) | (tag.charCodeAt(1) << 8) | (tag.charCodeAt(2) << 16) | (tag.charCodeAt(3) << 24)) >>> 0;
}
export function fontAxisTagToString(tag: number): string {
  return String.fromCharCode(tag & 0xff, (tag >>> 8) & 0xff, (tag >>> 16) & 0xff, (tag >>> 24) & 0xff);
}
export const DWRITE_FONT_AXIS_TAG = {
  WEIGHT: fontAxisTag("wght"),
  WIDTH: fontAxisTag("wdth"),
  SLANT: fontAxisTag("slnt"),
  OPTICAL_SIZE: fontAxisTag("opsz"),
  ITALIC: fontAxisTag("ital"),
} as const;

export interface DWRITE_FONT_AXIS_VALUE { tag: string | number; value: number }
export const DWRITE_FONT_AXIS_VALUE_SIZE = 8;
export function writeFontAxisValues(abi: Abi, alloc: Allocator, values: DWRITE_FONT_AXIS_VALUE[]): number {
  const p = alloc.alloc(values.length * DWRITE_FONT_AXIS_VALUE_SIZE);
  values.forEach((v, i) => {
    abi.writeU32(p + i * 8 + 0, typeof v.tag === "string" ? fontAxisTag(v.tag) : v.tag);
    abi.writeF32(p + i * 8 + 4, v.value);
  });
  return p;
}
export function readFontAxisValue(abi: Abi, p: number): { tag: string; value: number } {
  return { tag: fontAxisTagToString(abi.readU32(p)), value: abi.readF32(p + 4) };
}
export function readFontAxisValues(abi: Abi, p: number, count: number): { tag: string; value: number }[] {
  return Array.from({ length: count }, (_, i) => readFontAxisValue(abi, p + i * 8));
}

export enum DWRITE_AUTOMATIC_FONT_AXES { NONE = 0, OPTICAL_SIZE = 1 }
export interface DWRITE_FONT_AXIS_RANGE { tag: string | number; min: number; max: number }

export const DWRITE_FONT_AXIS_RANGE_SIZE = 12;
export function writeFontAxisRanges(abi: Abi, alloc: Allocator, ranges: DWRITE_FONT_AXIS_RANGE[]): number {
  const p = alloc.alloc(ranges.length * DWRITE_FONT_AXIS_RANGE_SIZE);
  ranges.forEach((r, i) => {
    abi.writeU32(p + i * 12 + 0, typeof r.tag === "string" ? fontAxisTag(r.tag) : r.tag);
    abi.writeF32(p + i * 12 + 4, r.min);
    abi.writeF32(p + i * 12 + 8, r.max);
  });
  return p;
}
export function readFontAxisRange(abi: Abi, p: number): { tag: string; min: number; max: number } {
  return { tag: fontAxisTagToString(abi.readU32(p)), min: abi.readF32(p + 4), max: abi.readF32(p + 8) };
}
export function readFontAxisRanges(abi: Abi, p: number, count: number): { tag: string; min: number; max: number }[] {
  return Array.from({ length: count }, (_, i) => readFontAxisRange(abi, p + i * 12));
}

export enum DWRITE_MEASURING_MODE { NATURAL = 0, GDI_CLASSIC = 1, GDI_NATURAL = 2 }
export enum DWRITE_TEXT_ANTIALIAS_MODE { CLEARTYPE = 0, GRAYSCALE = 1 }

export function colorref(r: number, g: number, b: number): number {
  return ((b & 255) << 16) | ((g & 255) << 8) | (r & 255);
}

export interface DWRITE_BITMAP_DATA_BGRA32 { width: number; height: number; pixels: number }
export const DWRITE_BITMAP_DATA_BGRA32_SIZE = 12;
export function readBitmapDataBgra32(abi: Abi, p: number): DWRITE_BITMAP_DATA_BGRA32 {
  return { width: abi.readU32(p + 0), height: abi.readU32(p + 4), pixels: abi.readPtr(p + 8) };
}
export enum DWRITE_RENDERING_MODE {
  DEFAULT = 0, ALIASED = 1, GDI_CLASSIC = 2, GDI_NATURAL = 3,
  NATURAL = 4, NATURAL_SYMMETRIC = 5, OUTLINE = 6,
}
export enum DWRITE_TEXTURE_TYPE { ALIASED_1x1 = 0, CLEARTYPE_3x1 = 1 }
export enum DWRITE_PAINT_FEATURE_LEVEL { NONE = 0, COLR_V0 = 1, COLR_V1 = 2 }
export enum DWRITE_PIXEL_GEOMETRY { FLAT = 0, RGB = 1, BGR = 2 }

export enum DWRITE_GLYPH_IMAGE_FORMATS {
  NONE = 0x00000000,
  TRUETYPE = 0x00000001,
  CFF = 0x00000002,
  COLR = 0x00000004,
  SVG = 0x00000008,
  PNG = 0x00000010,
  JPEG = 0x00000020,
  TIFF = 0x00000040,
  PREMULTIPLIED_B8G8R8A8 = 0x00000080,
  COLR_PAINT_TREE = 0x00000100,
}
export const DWRITE_GLYPH_IMAGE_FORMATS_OUTLINE =
  DWRITE_GLYPH_IMAGE_FORMATS.TRUETYPE | DWRITE_GLYPH_IMAGE_FORMATS.CFF | DWRITE_GLYPH_IMAGE_FORMATS.COLR;
  
export const DWRITE_GLYPH_IMAGE_FORMATS_ALL =
  DWRITE_GLYPH_IMAGE_FORMATS_OUTLINE | DWRITE_GLYPH_IMAGE_FORMATS.SVG | DWRITE_GLYPH_IMAGE_FORMATS.PNG |
  DWRITE_GLYPH_IMAGE_FORMATS.JPEG | DWRITE_GLYPH_IMAGE_FORMATS.TIFF |
  DWRITE_GLYPH_IMAGE_FORMATS.PREMULTIPLIED_B8G8R8A8 | DWRITE_GLYPH_IMAGE_FORMATS.COLR_PAINT_TREE;

export interface DWRITE_FONT_METRICS {
  designUnitsPerEm: number;
  ascent: number;
  descent: number;
  lineGap: number;
  capHeight: number;
  xHeight: number;
  underlinePosition: number;
  underlineThickness: number;
  strikethroughPosition: number;
  strikethroughThickness: number;
}
export const DWRITE_FONT_METRICS_SIZE = 20;
export function readFontMetrics(abi: Abi, p: number): DWRITE_FONT_METRICS {
  const dv = abi.dv;
  return {
    designUnitsPerEm: dv.getUint16(p + 0, true),
    ascent: dv.getUint16(p + 2, true),
    descent: dv.getUint16(p + 4, true),
    lineGap: dv.getInt16(p + 6, true),
    capHeight: dv.getUint16(p + 8, true),
    xHeight: dv.getUint16(p + 10, true),
    underlinePosition: dv.getInt16(p + 12, true),
    underlineThickness: dv.getUint16(p + 14, true),
    strikethroughPosition: dv.getInt16(p + 16, true),
    strikethroughThickness: dv.getUint16(p + 18, true),
  };
}

export interface DWRITE_GLYPH_METRICS {
  leftSideBearing: number;
  advanceWidth: number;
  rightSideBearing: number;
  topSideBearing: number;
  advanceHeight: number;
  bottomSideBearing: number;
  verticalOriginY: number;
}
export const DWRITE_GLYPH_METRICS_SIZE = 28;
export function readGlyphMetrics(abi: Abi, p: number): DWRITE_GLYPH_METRICS {
  const dv = abi.dv;
  return {
    leftSideBearing: dv.getInt32(p + 0, true),
    advanceWidth: dv.getUint32(p + 4, true),
    rightSideBearing: dv.getInt32(p + 8, true),
    topSideBearing: dv.getInt32(p + 12, true),
    advanceHeight: dv.getUint32(p + 16, true),
    bottomSideBearing: dv.getInt32(p + 20, true),
    verticalOriginY: dv.getInt32(p + 24, true),
  };
}

export interface RECT { left: number; top: number; right: number; bottom: number }
export const RECT_SIZE = 16;
export function readRect(abi: Abi, p: number): RECT {
  const dv = abi.dv;
  return {
    left: dv.getInt32(p + 0, true),
    top: dv.getInt32(p + 4, true),
    right: dv.getInt32(p + 8, true),
    bottom: dv.getInt32(p + 12, true),
  };
}

export interface GlyphRunDesc {
  fontFace: number;
  fontEmSize: number;
  glyphIndices: number[];
  glyphAdvances?: number[];
  glyphOffsets?: { advanceOffset: number; ascenderOffset: number }[];
  isSideways?: boolean;
  bidiLevel?: number;
}
export const DWRITE_GLYPH_RUN_SIZE = 32;

export function writeGlyphRun(abi: Abi, alloc: Allocator, run: GlyphRunDesc): number {
  const count = run.glyphIndices.length;
  const indicesPtr = alloc.alloc(count * 2);
  for (let i = 0; i < count; i++) abi.writeU16(indicesPtr + i * 2, run.glyphIndices[i]!);

  let advancesPtr = 0;
  if (run.glyphAdvances) {
    advancesPtr = alloc.alloc(count * 4);
    for (let i = 0; i < count; i++) abi.writeF32(advancesPtr + i * 4, run.glyphAdvances[i]!);
  }

  let offsetsPtr = 0;
  if (run.glyphOffsets) {
    offsetsPtr = alloc.alloc(count * 8);
    for (let i = 0; i < count; i++) {
      abi.writeF32(offsetsPtr + i * 8 + 0, run.glyphOffsets[i]!.advanceOffset);
      abi.writeF32(offsetsPtr + i * 8 + 4, run.glyphOffsets[i]!.ascenderOffset);
    }
  }

  const p = alloc.allocZeroed(DWRITE_GLYPH_RUN_SIZE);
  abi.writeU32(p + 0, run.fontFace);
  abi.writeF32(p + 4, run.fontEmSize);
  abi.writeU32(p + 8, count);
  abi.writeU32(p + 12, indicesPtr);
  abi.writeU32(p + 16, advancesPtr);
  abi.writeU32(p + 20, offsetsPtr);
  abi.writeU32(p + 24, run.isSideways ? 1 : 0);
  abi.writeU32(p + 28, run.bidiLevel ?? 0);
  return p;
}
