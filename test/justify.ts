// Low-level justification pipeline against real DirectWriteCore: applyCharacterSpacing and the
// GetJustificationOpportunities -> JustifyGlyphAdvances -> GetJustifiedGlyphs chain. These methods
// pass several glyphCount-sized parallel arrays the generic emitter mis-lowers (single-element out
// buffers -> heap overflow), so they're hand-wrapped in IDWriteTextAnalyzer.ts. This proves the
// wrappers marshal correctly and that DWRITE_SHAPING_GLYPH_PROPERTIES / DWRITE_JUSTIFICATION_OPPORTUNITY
// (packed bit-field structs) round-trip through DWrite.
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextAnalysisSourceBase, TextAnalysisSinkBase, type LocaleRun } from "../src/util/index.js";
import { callMethod } from "../src/core/com.js";
import { DWRITE_READING_DIRECTION } from "../src/core/types.js";
import type { DWRITE_SCRIPT_ANALYSIS } from "../src/core/structs.g.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using analyzer = factory.createTextAnalyzer();
using face = factory.loadFontFace("/local/fonts/segoeui.ttf");

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  ok ? pass++ : fail++;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

class Src extends TextAnalysisSourceBase {
  constructor(private readonly text: string) { super(abi); }
  protected override getTextAtPosition(p: number): string | null { return p < this.text.length ? this.text.slice(p) : null; }
  protected override getTextBeforePosition(p: number): string | null { return p > 0 && p <= this.text.length ? this.text.slice(0, p) : null; }
  protected override get paragraphReadingDirection(): DWRITE_READING_DIRECTION { return DWRITE_READING_DIRECTION.LEFT_TO_RIGHT; }
  protected override getLocaleName(p: number): LocaleRun { return { localeName: "en-us", textLength: this.text.length - p }; }
}
class ScriptSink extends TextAnalysisSinkBase {
  readonly runs: DWRITE_SCRIPT_ANALYSIS[] = [];
  protected override setScriptAnalysis(_p: number, _l: number, sa: DWRITE_SCRIPT_ANALYSIS): void { this.runs.push(sa); }
}
function scriptOf(text: string): DWRITE_SCRIPT_ANALYSIS {
  using src = new Src(text);
  const sink = new ScriptSink(abi);
  callMethod(abi, analyzer.ptr, 3, src.ptr, 0, text.length, sink.ptr); // AnalyzeScript = slot 3
  if (!sink.runs.length) throw new Error("no script run");
  return sink.runs[0]!;
}

const text = "Affluent text";
const emSize = 32;
const sa = scriptOf(text);
const shaped = analyzer.getGlyphs(text, sa, face);
const place = analyzer.getGlyphPlacements({
  textString: text, clusterMap: shaped.clusterMap, textProps: shaped.textProps,
  glyphIndices: shaped.glyphIndices, glyphProps: shaped.glyphProps,
  fontFace: face, fontEmSize: emSize, scriptAnalysis: sa,
});
const n = shaped.actualGlyphCount;
const baseTotal = sum(place.glyphAdvances);

// ---- applyCharacterSpacing ------------------------------------------------------------------
console.log("\napplyCharacterSpacing:");
{
  const identity = analyzer.applyCharacterSpacing({
    clusterMap: shaped.clusterMap, glyphAdvances: place.glyphAdvances,
    glyphOffsets: place.glyphOffsets, glyphProps: shaped.glyphProps,
  });
  check("one modified advance per glyph", identity.glyphAdvances.length === n, `${identity.glyphAdvances.length} vs ${n}`);
  check("zero spacing leaves advances unchanged",
    identity.glyphAdvances.every((a, i) => Math.abs(a - place.glyphAdvances[i]!) < 1e-3));

  const spaced = analyzer.applyCharacterSpacing({
    clusterMap: shaped.clusterMap, glyphAdvances: place.glyphAdvances,
    glyphOffsets: place.glyphOffsets, glyphProps: shaped.glyphProps,
    leadingSpacing: 3, trailingSpacing: 4,
  });
  check("positive spacing widens the run total", sum(spaced.glyphAdvances) > baseTotal,
    `${sum(spaced.glyphAdvances).toFixed(1)} > ${baseTotal.toFixed(1)}`);
}

// ---- justification chain --------------------------------------------------------------------
console.log("\ngetJustificationOpportunities -> justifyGlyphAdvances -> getJustifiedGlyphs:");
{
  const opps = analyzer.getJustificationOpportunities({
    fontFace: face, fontEmSize: emSize, scriptAnalysis: sa,
    textString: text, clusterMap: shaped.clusterMap, glyphProps: shaped.glyphProps,
  });
  check("one opportunity per glyph", opps.length === n, `${opps.length} vs ${n}`);
  // Packed bit-field members decode into their declared ranges (priorities are UINT8 sub-fields).
  check("opportunity bit-fields decode in range", opps.every((o) =>
    o.expansionMaximum >= 0 && o.compressionMaximum >= 0 &&
    o.expansionPriority >= 0 && o.expansionPriority <= 255 &&
    o.compressionPriority >= 0 && o.compressionPriority <= 255 &&
    o.allowResidualExpansion <= 1 && o.applyToLeadingEdge <= 1));

  const lineWidth = baseTotal * 1.6;
  const justified = analyzer.justifyGlyphAdvances({
    lineWidth, justificationOpportunities: opps,
    glyphAdvances: place.glyphAdvances, glyphOffsets: place.glyphOffsets,
  });
  check("one justified advance per glyph", justified.glyphAdvances.length === n);
  // Justification only expands (never shrinks below the natural advances) for a wider line.
  check("justified run is at least as wide as the original", sum(justified.glyphAdvances) >= baseTotal - 1e-3,
    `${sum(justified.glyphAdvances).toFixed(1)} >= ${baseTotal.toFixed(1)}`);

  const out = analyzer.getJustifiedGlyphs({
    fontFace: face, fontEmSize: emSize, scriptAnalysis: sa, textLength: text.length,
    clusterMap: shaped.clusterMap, glyphIndices: shaped.glyphIndices,
    glyphAdvances: place.glyphAdvances, justifiedGlyphAdvances: justified.glyphAdvances,
    justifiedGlyphOffsets: justified.glyphOffsets, glyphProps: shaped.glyphProps,
  });
  check("actualGlyphCount is sane (Latin keeps or grows the run)", out.actualGlyphCount >= n,
    `actual=${out.actualGlyphCount} in=${n}`);
  check("modified arrays are sized to actualGlyphCount",
    out.modifiedGlyphIndices.length === out.actualGlyphCount &&
    out.modifiedGlyphAdvances.length === out.actualGlyphCount &&
    out.modifiedGlyphOffsets.length === out.actualGlyphCount);
  check("modifiedClusterMap has one entry per code unit", out.modifiedClusterMap.length === text.length);

  // For Latin (no kashida insertion) the run is unchanged: same glyphs, advances == the justified ones.
  if (out.actualGlyphCount === n) {
    check("getJustifiedGlyphs round-trips glyph indices", out.modifiedGlyphIndices.every((g, i) => g === shaped.glyphIndices[i]));
    check("getJustifiedGlyphs round-trips justified advances",
      out.modifiedGlyphAdvances.every((a, i) => Math.abs(a - justified.glyphAdvances[i]!) < 1e-3));
  }
}

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
