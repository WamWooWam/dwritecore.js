// Validates the new IDWriteFactory8::TranslateColorGlyphRun binding (tryTranslateColorGlyphRun8 +
// IDWriteColorGlyphRunEnumerator.getCurrentRun1) before the bitmap renderer is wired to it. Three
// things to confirm:
//   1. ABI: baselineOrigin is a by-value D2D1_POINT_2F we pass as a struct pointer - the enumerated
//      sub-runs' origins must echo a non-zero (17,42) input, or the marshalling is wrong.
//   2. COLRv1 grouping: seguiemj here is COLRv1, so emoji should come back as a COMPLEX format
//      (COLR_PAINT_TREE / SVG / bitmap) - we print whether they're grouped whole-run or per-glyph.
//   3. A plain Latin run returns null (DWRITE_E_NOCOLOR).
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import {
  DWRITE_MEASURING_MODE, DWRITE_GLYPH_IMAGE_FORMATS, DWRITE_GLYPH_IMAGE_FORMATS_OUTLINE,
  writeGlyphRun, type GlyphRunDesc,
} from "../src/core/types.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` , ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const formatName = (f: number): string => {
  const names: string[] = [];
  for (const [k, v] of Object.entries(DWRITE_GLYPH_IMAGE_FORMATS)) {
    if (typeof v === "number" && v !== 0 && (f & v) === v) names.push(k);
  }
  return names.length ? names.join("|") : (f === 0 ? "NONE" : `0x${f.toString(16)}`);
};

// Build a native DWRITE_GLYPH_RUN* for a string in a given face, returning the pointer + the scope
// that owns it (must stay alive while the enumerator is iterated).
function runFor(face: ReturnType<typeof factory.loadFontFace>, text: string, emSize: number) {
  const fm = face.getMetrics();
  const gids = face.getGlyphIndices([...text].map((c) => c.codePointAt(0)!));
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / fm.designUnitsPerEm) * emSize);
  const run: GlyphRunDesc = { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances };
  return run;
}

const OX = 17, OY = 42;

// ============================================================ COLRv1 emoji decomposition
{
  console.log("\nTranslateColorGlyphRun8 on seguiemj (emoji 😁🌈🚀):");
  using face = factory.loadFontFace("/local/fonts/seguiemj.ttf");
  const run = runFor(face, "😁🌈🚀", 64);

  using s = abi.scope();
  const runPtr = writeGlyphRun(abi, s, run);
  using layers = factory.tryTranslateColorGlyphRun8(OX, OY, runPtr, DWRITE_MEASURING_MODE.NATURAL, {});
  check("emoji run reports colour (enumerator, not null)", !!layers);

  if (layers) {
    const sub: { fmt: number; glyphs: number; palette: number; x: number; y: number }[] = [];
    while (layers.moveNext()) {
      const r = layers.getCurrentRun1();
      sub.push({ fmt: r.glyphImageFormat, glyphs: r.glyphRun.glyphCount, palette: r.paletteIndex, x: r.baselineOriginX, y: r.baselineOriginY });
    }
    for (const [i, r] of sub.entries()) {
      console.log(`    sub[${i}] format=${formatName(r.fmt)} glyphs=${r.glyphs} palette=0x${r.palette.toString(16)} origin=(${r.x.toFixed(1)}, ${r.y.toFixed(1)})`);
    }
    check("enumerated at least one sub-run", sub.length >= 1, `count=${sub.length}`);
    // ABI gate: first sub-run's origin must echo the (17,42) we passed via the POINT_2F pointer.
    const first = sub[0]!;
    check("baselineOrigin echoes input (POINT_2F marshalled correctly)",
      Math.abs(first.x - OX) < 1 && Math.abs(first.y - OY) < 1, `got (${first.x.toFixed(2)}, ${first.y.toFixed(2)}) want (${OX}, ${OY})`);
    // COLRv1 => emoji should NOT be plain outline; they must be a complex format routed to the RT.
    const anyComplex = sub.some((r) => (r.fmt & DWRITE_GLYPH_IMAGE_FORMATS_OUTLINE) === 0 && r.fmt !== 0);
    check("at least one sub-run is a complex (non-outline) format", anyComplex);
    // Grouping (informational): one run for all 3 glyphs vs one per glyph - decides coalesce need.
    console.log(`    grouping: ${sub.length === 1 ? "WHOLE-RUN" : sub.length >= run.glyphIndices.length ? "PER-GLYPH (or finer)" : "MIXED"} (${sub.length} sub-runs for ${run.glyphIndices.length} glyphs)`);
  }
}

// ============================================================ plain text => no colour
{
  console.log("\nTranslateColorGlyphRun8 on segoeui (plain 'Ag'):");
  using face = factory.loadFontFace("/local/fonts/segoeui.ttf");
  const run = runFor(face, "Ag", 32);
  using s = abi.scope();
  const runPtr = writeGlyphRun(abi, s, run);
  const layers = factory.tryTranslateColorGlyphRun8(OX, OY, runPtr, DWRITE_MEASURING_MODE.NATURAL, {});
  check("plain Latin run returns null (DWRITE_E_NOCOLOR)", layers === null);
  layers?.release();
}

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
