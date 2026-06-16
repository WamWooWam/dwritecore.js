// Static assertions that the generated cumulative vtable slots match values verified live
// against the real DirectWriteCore wasm. A wrong slot calls the wrong vtable entry, so these
// guard the generator against silent off-by-one / dedup regressions.
import {
  IDWriteTextLayout4Slot,
  IDWriteFontFace5Slot,
  IDWriteFactory7Slot,
  IDWriteTextFormat3Slot,
  IDWriteBitmapRenderTarget3Slot,
} from "../src/core/slots.g.js";

let failures = 0;
function eq(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    console.error(`FAIL ${label}: got ${actual}, expected ${expected}`);
    failures++;
  }
}

eq("IDWriteTextLayout4Slot.Draw", IDWriteTextLayout4Slot.Draw, 58);
eq("IDWriteTextLayout4Slot.GetMetrics", IDWriteTextLayout4Slot.GetMetrics, 60);
eq("IDWriteTextLayout4Slot.SetFontAxisValues", IDWriteTextLayout4Slot.SetFontAxisValues, 84);
// the layout positional getter collides by name with the inherited format getter (22),
// so it is suffixed with its slot.
eq("IDWriteTextLayout4Slot.GetFontWeight_47", IDWriteTextLayout4Slot.GetFontWeight_47, 47);

eq("IDWriteFontFace5Slot.GetMetrics", IDWriteFontFace5Slot.GetMetrics, 8);
eq("IDWriteFontFace5Slot.GetGlyphIndices", IDWriteFontFace5Slot.GetGlyphIndices, 11);
eq("IDWriteFontFace5Slot.GetFontResource", IDWriteFontFace5Slot.GetFontResource, 56);

// the IDWriteFactory5 overload (slot 43, returns IDWriteFontSetBuilder1), distinct from the
// older IDWriteFactory3 CreateFontSetBuilder (slot 36).
eq("IDWriteFactory7Slot.CreateFontSetBuilder5", IDWriteFactory7Slot.CreateFontSetBuilder5, 43);
eq("IDWriteFactory7Slot.CreateFontSetBuilder", IDWriteFactory7Slot.CreateFontSetBuilder, 36);

eq("IDWriteTextFormat3Slot.SetFontAxisValues", IDWriteTextFormat3Slot.SetFontAxisValues, 38);
eq("IDWriteTextFormat3Slot.GetFontWeight", IDWriteTextFormat3Slot.GetFontWeight, 22);

eq("IDWriteBitmapRenderTarget3Slot.GetBitmapData", IDWriteBitmapRenderTarget3Slot.GetBitmapData, 13);

if (failures) {
  console.error(`\n${failures} slot assertion(s) FAILED`);
  process.exit(1);
}
console.log("all slot assertions passed");
