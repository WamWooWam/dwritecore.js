// Exercises the GENERATED IDWriteFont class end-to-end against the real DirectWriteCore wasm.
// Every property/method below calls a real vtable slot, so a mis-lowered arg or wrong overload
// slot would crash or return garbage. Finishes by driving the generated createFontFace() into
// the existing glyph-run draw path to a PNG.
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory, IDWriteFontList } from "../src/index.js";
import {
  DWRITE_FONT_WEIGHT, DWRITE_FONT_STYLE, DWRITE_FONT_SIMULATIONS,
  DWRITE_INFORMATIONAL_STRING_ID, DWRITE_LOCALITY,
  DWRITE_TEXTURE_TYPE, DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE,
} from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

// Build a collection from a known regular font, then walk collection -> family -> font.
using collection = factory.createFontCollection(["/local/fonts/segoeui.ttf"]);
using family = collection.getFontFamily(0);
console.log(`family fontCount = ${family.fontCount}`);
using font = family.getFont(0);

// --- scalar properties (enum/BOOL masking) ---
const weight = font.weight, style = font.style;
console.log("weight        =", DWRITE_FONT_WEIGHT[weight] ?? weight);
console.log("style         =", DWRITE_FONT_STYLE[style] ?? style);
console.log("stretch       =", font.stretch);
console.log("simulations   =", DWRITE_FONT_SIMULATIONS[font.simulations] ?? font.simulations);
console.log("isSymbolFont  =", font.isSymbolFont);
console.log("isMonospaced  =", font.isMonospacedFont);
console.log("isColorFont   =", font.isColorFont);
console.log("locality      =", DWRITE_LOCALITY[font.locality] ?? font.locality);

// --- struct-out method ---
const metrics = font.getMetrics();
console.log("metrics       =", { upem: metrics.designUnitsPerEm, ascent: metrics.ascent, descent: metrics.descent });

// --- arg + direct BOOL return ---
const hasA = font.hasCharacter(0x41);       // 'A'
const hasEmoji = font.hasCharacter(0x1f600); // 😀
console.log("hasCharacter A / 😀 =", hasA, "/", hasEmoji);

// --- object-out methods (LocalizedStrings) ---
using faceNames = font.getFaceNames();
console.log("faceName      =", faceNames.getString(0));
const full = font.getInformationalStrings(DWRITE_INFORMATIONAL_STRING_ID.FULL_NAME);
console.log("FULL_NAME     =", full ? full.getString(0) : "(none)");
full?.[Symbol.dispose]();

// --- array-with-count (two-call) ---
const ranges = font.getUnicodeRanges();
console.log("unicodeRanges =", ranges.length, "ranges, first =", ranges[0]);

// --- breadth: the GENERATED IDWriteFontList (a family IS-A font list, sharing the base
// IDWriteFontList vtable slots). Proves a generated breadth class drives the real wasm and that
// its getFont() correctly wraps another generated class (IDWriteFont). ---
const list = IDWriteFontList.from(abi, family.ptr); // borrows family's ref; don't dispose
console.log("list.fontCount=", list.fontCount);
using firstFont = list.getFont(0);
const refUpem = firstFont.getMetrics().designUnitsPerEm;
console.log("list.getFont(0):", DWRITE_FONT_WEIGHT[firstFont.weight] ?? firstFont.weight, "upem", refUpem);

// --- assertions: Segoe UI Regular ---
const fail: string[] = [];
if (weight !== DWRITE_FONT_WEIGHT.NORMAL) fail.push(`weight ${weight} != NORMAL`);
if (style !== DWRITE_FONT_STYLE.NORMAL) fail.push(`style ${style} != NORMAL`);
if (font.isSymbolFont) fail.push("isSymbolFont should be false");
if (!(metrics.designUnitsPerEm > 0 && metrics.ascent > 0)) fail.push("metrics look wrong");
if (!hasA) fail.push("expected hasCharacter('A')");
if (!(ranges.length > 0 && ranges[0]!.last >= ranges[0]!.first)) fail.push("expected unicode ranges");
if (refUpem !== metrics.designUnitsPerEm) fail.push("FontList.getFont upem mismatch");
if (list.fontCount !== family.fontCount) fail.push("FontList.fontCount mismatch");
if (!faceNames.getString(0)) fail.push("expected a face name");
if (fail.length) { console.error("FAIL:\n  " + fail.join("\n  ")); process.exit(1); }

// --- generated createFontFace() -> existing glyph-run draw path ---
using face = font.createFontFace();
const text = "Generated IDWriteFont ✓";
const emSize = 72, margin = 16;
const upem = face.getMetrics().designUnitsPerEm;
const codePoints = [...text].map((c) => c.codePointAt(0)!);
const glyphIndices = face.getGlyphIndices(codePoints);
const glyphAdvances = face.getDesignGlyphMetrics(glyphIndices).map((g) => (g.advanceWidth / upem) * emSize);

using analysis = factory.createGlyphRunAnalysis(
  { fontFace: face.ptr, fontEmSize: emSize, glyphIndices, glyphAdvances },
  { renderingMode: DWRITE_RENDERING_MODE.NATURAL, measuringMode: DWRITE_MEASURING_MODE.NATURAL, baselineOriginX: 0, baselineOriginY: 0 },
);
const tex = analysis.createAlphaTexture(DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1);
const W = tex.width + margin * 2, H = tex.height + margin * 2;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
const img = ctx.createImageData(W, H);
img.data.fill(255);
for (let y = 0; y < tex.height; y++) for (let x = 0; x < tex.width; x++) {
  const src = (y * tex.width + x) * 3;
  const coverage = (tex.data[src]! + tex.data[src + 1]! + tex.data[src + 2]!) / 3 / 255;
  const gray = Math.round(255 * (1 - coverage));
  const dst = ((y + margin) * W + (x + margin)) * 4;
  img.data[dst] = gray; img.data[dst + 1] = gray; img.data[dst + 2] = gray; img.data[dst + 3] = 255;
}
ctx.putImageData(img, 0, 0);
await snapshot("font", canvas.toBuffer("image/png"));
