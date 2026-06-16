// Low-level color/CPAL APIs that the emitter drops: IDWriteColorGlyphRunEnumerator.getCurrentRun
// (the COLR layer enumeration behind drawGlyphRunWithColorSupport), IDWriteFontFace.getPaletteEntries,
// and getPanose. Drives a real color emoji glyph through TranslateColorGlyphRun and asserts the
// enumerated layers and palette are sane.
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_MEASURING_MODE, type GlyphRunDesc } from "../src/core/types.js";
import type { DWRITE_GLYPH_RUN_DESCRIPTION, DWRITE_MATRIX } from "../src/core/structs.g.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` , ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

const identity: DWRITE_MATRIX = { m11: 1, m12: 0, m21: 0, m22: 1, dx: 0, dy: 0 };
const noDesc: DWRITE_GLYPH_RUN_DESCRIPTION = { localeName: 0, string: 0, stringLength: 0, clusterMap: 0, textPosition: 0 };

// ============================================================ Color layer enumeration
{
  console.log("\nColor glyph run enumeration (seguiemj):");
  using face = factory.loadFontFace("/local/fonts/seguiemj.ttf");
  const fm = face.getMetrics();
  const emSize = 64;
  const gids = face.getGlyphIndices([..."😁"].map((c) => c.codePointAt(0)!));
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / fm.designUnitsPerEm) * emSize);
  const run: GlyphRunDesc = { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances };

  using layers = factory.translateColorGlyphRun(0, 0, run, noDesc, DWRITE_MEASURING_MODE.NATURAL, identity, 0);
  const collected: { glyphCount: number; paletteIndex: number; hasColor: boolean }[] = [];
  while (layers.moveNext()) {
    const r = layers.getCurrentRun();
    collected.push({
      glyphCount: r.glyphRun.glyphCount,
      paletteIndex: r.paletteIndex,
      // paletteIndex 0xFFFF means "use runColor as-is"; otherwise it indexes the CPAL palette.
      hasColor: r.paletteIndex !== 0xffff || r.runColor.a > 0,
    });
  }
  check("enumerated at least one color layer", collected.length >= 1, `layers=${collected.length}`);
  check("every layer has glyphs", collected.every((l) => l.glyphCount > 0));
  check("every layer carries a color (palette index or run color)", collected.every((l) => l.hasColor));

  // ---- palette entries ----
  const paletteCount = face.colorPaletteCount;
  const entryCount = face.paletteEntryCount;
  check("font advertises a CPAL palette", paletteCount >= 1 && entryCount >= 1, `palettes=${paletteCount} entries=${entryCount}`);
  if (paletteCount >= 1 && entryCount >= 1) {
    const entries = face.getPaletteEntries(0, 0, Math.min(entryCount, 8));
    check("palette entries read as RGBA in [0,1]", entries.length > 0 && entries.every((c) =>
      [c.r, c.g, c.b, c.a].every((v) => v >= 0 && v <= 1)));
    check("at least one entry is not fully transparent", entries.some((c) => c.a > 0));
  }
}

// ============================================================ PANOSE
{
  console.log("\nPANOSE classification:");
  using face = factory.loadFontFace("/local/fonts/segoeui.ttf");
  const panose = face.getPanose();
  check("PANOSE is 10 bytes", panose.length === 10);
  // familyKind (values[0]): 0=any,1=no-fit,2=text&display,3=script,4=decorative,5=pictorial.
  check("PANOSE family kind is a Latin text face (2)", panose[0] === 2, `familyKind=${panose[0]}`);
}

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
