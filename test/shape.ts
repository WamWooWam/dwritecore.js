// Low-level shaping pipeline (IDWriteTextAnalyzer.getGlyphs -> getGlyphPlacements). Proves the hand
// wrapper for the methods the generic emitter drops actually shapes text: glyph counts/clusters are
// sane, contextual scripts (Arabic) shape differently from a naive per-codepoint cmap mapping, and
// the shaped run round-trips through the rasterizer to a snapshot.
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { decodeShapingGlyphProperties } from "../src/interfaces/IDWriteTextAnalyzer.js";
import { TextAnalysisSourceBase, TextAnalysisSinkBase, type LocaleRun } from "../src/util/index.js";
import { callMethod } from "../src/core/com.js";
import { DWRITE_READING_DIRECTION, DWRITE_TEXTURE_TYPE, DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE, type GlyphRunDesc } from "../src/core/types.js";
import type { DWRITE_SCRIPT_ANALYSIS } from "../src/core/structs.g.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using analyzer = factory.createTextAnalyzer();
using face = factory.loadFontFace("/local/fonts/segoeui.ttf");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` , ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// Itemize a string into its (first) script analysis via a real AnalyzeScript pass.
class Src extends TextAnalysisSourceBase {
  constructor(private readonly text: string, private readonly rtl = false) { super(abi); }
  protected override getTextAtPosition(p: number): string | null { return p < this.text.length ? this.text.slice(p) : null; }
  protected override getTextBeforePosition(p: number): string | null { return p > 0 && p <= this.text.length ? this.text.slice(0, p) : null; }
  protected override get paragraphReadingDirection(): DWRITE_READING_DIRECTION {
    return this.rtl ? DWRITE_READING_DIRECTION.RIGHT_TO_LEFT : DWRITE_READING_DIRECTION.LEFT_TO_RIGHT;
  }
  protected override getLocaleName(p: number): LocaleRun { return { localeName: "en-us", textLength: this.text.length - p }; }
}
class ScriptSink extends TextAnalysisSinkBase {
  readonly runs: DWRITE_SCRIPT_ANALYSIS[] = [];
  protected override setScriptAnalysis(_p: number, _l: number, sa: DWRITE_SCRIPT_ANALYSIS): void { this.runs.push(sa); }
}
function scriptOf(text: string, rtl = false): DWRITE_SCRIPT_ANALYSIS {
  using src = new Src(text, rtl);
  const sink = new ScriptSink(abi);
  // IDWriteTextAnalyzer::AnalyzeScript = slot 3.
  callMethod(abi, analyzer.ptr, 3, src.ptr, 0, text.length, sink.ptr);
  if (!sink.runs.length) throw new Error("no script run");
  return sink.runs[0]!;
}

// ============================================================ Latin shaping
{
  console.log("\nLatin shaping:");
  const text = "Affluent fi";
  const sa = scriptOf(text);
  const shaped = analyzer.getGlyphs(text, sa, face);
  check("produced glyphs", shaped.actualGlyphCount > 0, `count=${shaped.actualGlyphCount}`);
  check("clusterMap has one entry per code unit", shaped.clusterMap.length === text.length);
  check("clusterMap indices in range", shaped.clusterMap.every((c) => c >= 0 && c < shaped.actualGlyphCount));
  check("glyphIndices length matches actualGlyphCount", shaped.glyphIndices.length === shaped.actualGlyphCount);
  check("cluster starts flagged in glyph props", decodeShapingGlyphProperties(shaped.glyphProps[0]!).isClusterStart);

  const place = analyzer.getGlyphPlacements({
    textString: text, clusterMap: shaped.clusterMap, textProps: shaped.textProps,
    glyphIndices: shaped.glyphIndices, glyphProps: shaped.glyphProps,
    fontFace: face, fontEmSize: 48, scriptAnalysis: sa,
  });
  check("one advance per glyph", place.glyphAdvances.length === shaped.actualGlyphCount);
  check("advances non-negative, some positive", place.glyphAdvances.every((a) => a >= 0) && place.glyphAdvances.some((a) => a > 0));
}

// ============================================================ Arabic shaping (contextual)
{
  console.log("\nArabic shaping (contextual joining):");
  const text = "السلام"; // requires contextual forms; a naive cmap lookup yields isolated glyphs
  const sa = scriptOf(text, true);
  const shaped = analyzer.getGlyphs(text, sa, face, { isRightToLeft: true, localeName: "ar-sa" });
  const naive = face.getGlyphIndices([...text].map((c) => c.codePointAt(0)!));
  check("produced glyphs for Arabic", shaped.actualGlyphCount > 0, `count=${shaped.actualGlyphCount}`);
  // Contextual shaping must differ from the raw per-codepoint cmap mapping (joined vs isolated forms).
  const differs = shaped.glyphIndices.length !== naive.length
    || shaped.glyphIndices.some((g, i) => g !== naive[i]);
  check("shaped glyphs differ from naive cmap mapping", differs,
    `shaped=[${shaped.glyphIndices}] naive=[${naive}]`);
}

// ============================================================ Round-trip to a raster snapshot
{
  console.log("\nShaped run renders:");
  const text = "Affluent fi";
  const emSize = 48;
  const sa = scriptOf(text);
  const shaped = analyzer.getGlyphs(text, sa, face);
  const place = analyzer.getGlyphPlacements({
    textString: text, clusterMap: shaped.clusterMap, textProps: shaped.textProps,
    glyphIndices: shaped.glyphIndices, glyphProps: shaped.glyphProps,
    fontFace: face, fontEmSize: emSize, scriptAnalysis: sa,
  });
  const run: GlyphRunDesc = {
    fontFace: face.ptr, fontEmSize: emSize,
    glyphIndices: shaped.glyphIndices, glyphAdvances: place.glyphAdvances, glyphOffsets: place.glyphOffsets,
  };
  using analysis = factory.createGlyphRunAnalysis(run, {
    renderingMode: DWRITE_RENDERING_MODE.ALIASED, measuringMode: DWRITE_MEASURING_MODE.NATURAL,
  });
  const tex = analysis.createAlphaTexture(DWRITE_TEXTURE_TYPE.ALIASED_1x1);
  check("rasterized shaped run has coverage", tex.data.some((b) => b > 128));

  const margin = 16;
  const W = margin * 2 + tex.width, H = margin * 2 + tex.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  const img = ctx.createImageData(tex.width, tex.height);
  for (let i = 0; i < tex.width * tex.height; i++) {
    const v = 255 - tex.data[i]!;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, margin, margin);
  await snapshot("shape", canvas.toBuffer("image/png"));
}

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
