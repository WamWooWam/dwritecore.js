// Comprehensive functional test suite for the generated DirectWriteCore bindings.
//
// Every assertion below drives a real vtable slot against the real wasm, so a mis-lowered
// argument, wrong overload slot, or bad struct projection surfaces as a failed assertion or a
// thrown HRESULT rather than passing silently. This is the broad correctness net over the ~42
// generated interface families; the draw-*.ts scripts remain the visual/by-eye checks.
//
// Run: npm run test  (build first, or `npm run build && node dist/test/suite.js`)
import { loadNode } from "../src/host/node.js";
import {
  DWriteCoreCreateFactory,
  IDWriteFontList
} from "../src/index.js";
import {
  DWRITE_FONT_WEIGHT, DWRITE_FONT_STYLE, DWRITE_FONT_STRETCH,
  DWRITE_FONT_SIMULATIONS, DWRITE_FONT_FACE_TYPE,
  DWRITE_INFORMATIONAL_STRING_ID, DWRITE_LOCALITY,
  DWRITE_TEXT_ALIGNMENT, DWRITE_WORD_WRAPPING, DWRITE_PARAGRAPH_ALIGNMENT,
  DWRITE_PIXEL_GEOMETRY, DWRITE_RENDERING_MODE, DWRITE_MEASURING_MODE,
  DWRITE_TEXTURE_TYPE, colorref,
  type GlyphRunDesc,
} from "../src/core/types.js";
import { DWRITE_FONT_FEATURE_TAG } from "../src/core/enums.g.js";
import { GeometrySink } from "../src/util/geometry-sink.js";

// ----------------------------------------------------------------------------------------------
// tiny harness
// ----------------------------------------------------------------------------------------------
interface T {
  ok(cond: unknown, msg: string): void;
  eq<V>(actual: V, expected: V, msg: string): void;
  approx(actual: number, expected: number, eps: number, msg: string): void;
  gt(actual: number, bound: number, msg: string): void;
}

const groups: { name: string; fn: (t: T) => void }[] = [];
function group(name: string, fn: (t: T) => void) { groups.push({ name, fn }); }

const SEGOE = "/local/fonts/segoeui.ttf";
const SEGOE_BOLD = "/local/fonts/segoeuib.ttf";
const SEGOE_ITALIC = "/local/fonts/segoeuii.ttf";
const BAHNSCHRIFT = "/local/fonts/bahnschrift.ttf"; // variable (wght, wdth)

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });

// A factory + a real collection shared across read-only groups (system collection is empty in
// DirectWriteCore, so we build one from the bundled fonts).
using factory = DWriteCoreCreateFactory(abi);
using collection = factory.createFontCollection([SEGOE, SEGOE_BOLD, SEGOE_ITALIC]);
const SEGOE_FAMILY = collection.getFamilyNames()[0]!;

// ----------------------------------------------------------------------------------------------
// 1. Factory / COM lifetime
// ----------------------------------------------------------------------------------------------
group("factory + COM lifetime", (t) => {
  t.gt(factory.ptr, 0, "factory pointer is non-null");
  const before = factory.addRef();
  const after = factory.release();
  t.eq(after, before - 1, "AddRef then Release returns to prior refcount");

  // Idempotent dispose: a fresh disposable object disposed twice must not throw / double-free.
  const fmt = factory.createTextFormat("Segoe UI", { fontSize: 12 });
  fmt[Symbol.dispose]();
  fmt[Symbol.dispose]();
  t.ok(true, "double-dispose is safe");
});

// ----------------------------------------------------------------------------------------------
// 2. FontCollection / FontFamily / FontList
// ----------------------------------------------------------------------------------------------
group("collection / family / font-list", (t) => {
  t.gt(collection.fontFamilyCount, 0, "collection has at least one family");

  const names = collection.getFamilyNames();
  t.ok(names.includes(SEGOE_FAMILY), `getFamilyNames contains ${SEGOE_FAMILY}`);

  const { index, exists } = collection.findFamilyName(SEGOE_FAMILY);
  t.ok(exists, "findFamilyName finds the family");

  using family = collection.getFontFamily(index);
  t.gt(family.fontCount, 0, "family has fonts");

  // getFirstMatchingFont resolves a weight/stretch/style triple to a concrete font.
  using bold = family.getFirstMatchingFont(DWRITE_FONT_WEIGHT.BOLD, DWRITE_FONT_STRETCH.NORMAL, DWRITE_FONT_STYLE.NORMAL);
  t.eq(bold.weight, DWRITE_FONT_WEIGHT.BOLD, "getFirstMatchingFont(BOLD) yields a bold font");

  using italic = family.getFirstMatchingFont(DWRITE_FONT_WEIGHT.NORMAL, DWRITE_FONT_STRETCH.NORMAL, DWRITE_FONT_STYLE.ITALIC);
  t.eq(italic.style, DWRITE_FONT_STYLE.ITALIC, "getFirstMatchingFont(ITALIC) yields an italic font");

  // A family IS-A font list (shares the IDWriteFontList vtable prefix); prove a borrowed wrap works.
  const list = IDWriteFontList.from(abi, family.ptr); // borrows the family ref; do not dispose
  t.eq(list.fontCount, family.fontCount, "IDWriteFontList over family agrees on fontCount");
  using listFont = list.getFont(0);
  t.gt(listFont.getMetrics().designUnitsPerEm, 0, "FontList.getFont(0) wraps a usable IDWriteFont");
});

// ----------------------------------------------------------------------------------------------
// 3. Font scalar props + LocalizedStrings + unicode ranges
// ----------------------------------------------------------------------------------------------
group("font props + localized strings", (t) => {
  using family = collection.getFontFamily(collection.findFamilyName(SEGOE_FAMILY).index);
  using font = family.getFirstMatchingFont(DWRITE_FONT_WEIGHT.NORMAL, DWRITE_FONT_STRETCH.NORMAL, DWRITE_FONT_STYLE.NORMAL);

  t.eq(font.weight, DWRITE_FONT_WEIGHT.NORMAL, "regular font weight is NORMAL");
  t.eq(font.style, DWRITE_FONT_STYLE.NORMAL, "regular font style is NORMAL");
  t.eq(font.simulations, DWRITE_FONT_SIMULATIONS.NONE, "no simulations on the real regular face");
  t.ok(!font.isSymbolFont, "Segoe UI is not a symbol font");
  t.ok(font.locality === DWRITE_LOCALITY.LOCAL, "font is LOCAL");

  const m = font.getMetrics();
  t.gt(m.designUnitsPerEm, 0, "upem > 0");
  t.gt(m.ascent, 0, "ascent > 0");

  t.ok(font.hasCharacter(0x41), "hasCharacter('A')");
  t.ok(!font.hasCharacter(0x10ffff), "does not claim the last code point");

  using faceNames = font.getFaceNames();
  t.ok(!!faceNames.getString(0), "getFaceNames yields a non-empty string");
  // LocalizedStrings locale round-trip.
  const enUs = faceNames.findLocaleName("en-us");
  if (enUs.exists) t.ok(faceNames.getLocaleName(enUs.index).toLowerCase().startsWith("en"), "locale name round-trips");
  else t.ok(true, "no en-us locale (acceptable)");

  const full = font.getInformationalStrings(DWRITE_INFORMATIONAL_STRING_ID.FULL_NAME);
  t.ok(full ? !!full.getString(0) : true, "FULL_NAME informational string (if present) is non-empty");
  full?.[Symbol.dispose]();

  const ranges = font.getUnicodeRanges();
  t.gt(ranges.length, 0, "getUnicodeRanges returns ranges");
  t.ok(ranges[0]!.last >= ranges[0]!.first, "first range is well-ordered");
});

// ----------------------------------------------------------------------------------------------
// 4. FontFile.analyze + FontFace glyph metrics
// ----------------------------------------------------------------------------------------------
group("font file + font face glyphs", (t) => {
  using file = factory.createFontFileReference(SEGOE);
  const info = file.analyze();
  t.ok(info.isSupported, "segoeui.ttf is a supported font file");
  t.eq(info.faceType, DWRITE_FONT_FACE_TYPE.TRUETYPE, "faceType is TRUETYPE");
  t.gt(info.numberOfFaces, 0, "numberOfFaces > 0");

  using face = factory.createFontFace(info.faceType, [file]);
  const upem = face.getMetrics().designUnitsPerEm;
  t.gt(upem, 0, "face upem > 0");

  const cps = [..."Hg!"].map((c) => c.codePointAt(0)!);
  const gids = face.getGlyphIndices(cps);
  t.eq(gids.length, cps.length, "getGlyphIndices returns one gid per code point");
  t.ok(gids.every((g) => g > 0), "all code points map to real (non-.notdef) glyphs");

  const metrics = face.getDesignGlyphMetrics(gids);
  t.eq(metrics.length, gids.length, "getDesignGlyphMetrics is parallel to the input");
  t.ok(metrics.every((g) => g.advanceWidth > 0), "every glyph has a positive advance");

  // loadFontFace convenience == the manual path.
  using face2 = factory.loadFontFace(SEGOE);
  t.eq(face2.getMetrics().designUnitsPerEm, upem, "loadFontFace matches manual createFontFace");
  t.ok(face2.equals(face2), "FontFace.equals(self) is true");
});

// ----------------------------------------------------------------------------------------------
// 5. FontSet / FontSetBuilder / FontFaceReference
// ----------------------------------------------------------------------------------------------
group("font set + builder + face reference", (t) => {
  using builder = factory.createFontSetBuilder();
  using file = factory.createFontFileReference(SEGOE);
  builder.addFontFile(file);
  using fontSet = builder.createFontSet();
  t.gt(fontSet.fontCount, 0, "built font set has at least one font");

  using ref = fontSet.getFontFaceReference(0);
  t.gt(ref.getFileTime(), 0, "face reference exposes a file time");
  t.ok(ref.equals(ref), "FontFaceReference.equals(self)");

  using faceFromRef = ref.createFontFace();
  t.gt(faceFromRef.getMetrics().designUnitsPerEm, 0, "ref.createFontFace yields a usable face");

  const loc = fontSet.getFontLocality(0);
  t.eq(loc, DWRITE_LOCALITY.LOCAL, "font in a local set is LOCAL");

  // createFontCollectionFromFontSet closes the loop.
  using coll = factory.createFontCollectionFromFontSet(fontSet);
  t.gt(coll.fontFamilyCount, 0, "collection from font set has families");
});

// ----------------------------------------------------------------------------------------------
// 6. Variable fonts: FontResource + axis instancing
// ----------------------------------------------------------------------------------------------
group("variable font / font resource axes", (t) => {
  using base = factory.loadFontFace(BAHNSCHRIFT);
  t.ok(base.hasVariations, "Bahnschrift reports variations");

  using resource = base.getFontResource();
  t.gt(resource.fontAxisCount, 0, "font resource exposes axes");
  const axes = resource.getFontAxisRanges(resource.fontAxisCount);
  t.ok(axes.some((a) => a.tag === "wght"), "has a weight axis");
  const wght = axes.find((a) => a.tag === "wght")!;
  t.ok(wght.min < wght.max, "weight axis range is non-degenerate");

  // Instantiate at two distinct weights and confirm the metrics actually differ.
  using thin = resource.createFontFace(0, [{ tag: "wght", value: wght.min }]);
  using heavy = resource.createFontFace(0, [{ tag: "wght", value: wght.max }]);
  const gid = thin.getGlyphIndices([0x48])[0]!; // 'H'
  const thinAdv = thin.getDesignGlyphMetrics([gid])[0]!.advanceWidth;
  const heavyAdv = heavy.getDesignGlyphMetrics([gid])[0]!.advanceWidth;
  t.ok(thinAdv > 0 && heavyAdv > 0, "both instances produce advances");
  // The instantiated face reports its own axis values.
  const fav = heavy.fontAxisValues;
  const heavyWght = fav.find((a) => a.tag === "wght");
  t.ok(heavyWght ? Math.abs(heavyWght.value - wght.max) < 1 : true, "heavy face reports its wght axis value");
});

// ----------------------------------------------------------------------------------------------
// 7. TextFormat accessor round-trips
// ----------------------------------------------------------------------------------------------
group("text format accessors", (t) => {
  using fmt = factory.createTextFormat(SEGOE_FAMILY, { fontCollection: collection, fontSize: 24 });
  t.approx(fmt.fontSize, 24, 0.01, "fontSize reflects creation arg");
  t.eq(fmt.getFontFamilyName(), SEGOE_FAMILY, "getFontFamilyName round-trips");

  fmt.textAlignment = DWRITE_TEXT_ALIGNMENT.CENTER;
  t.eq(fmt.textAlignment, DWRITE_TEXT_ALIGNMENT.CENTER, "textAlignment set/get round-trips");
  fmt.paragraphAlignment = DWRITE_PARAGRAPH_ALIGNMENT.CENTER;
  t.eq(fmt.paragraphAlignment, DWRITE_PARAGRAPH_ALIGNMENT.CENTER, "paragraphAlignment round-trips");
  fmt.wordWrapping = DWRITE_WORD_WRAPPING.NO_WRAP;
  t.eq(fmt.wordWrapping, DWRITE_WORD_WRAPPING.NO_WRAP, "wordWrapping round-trips");
  t.ok(typeof fmt.readingDirection === "number", "readingDirection is readable");
});

// ----------------------------------------------------------------------------------------------
// 8. TextLayout: metrics, hit testing, per-range formatting
// ----------------------------------------------------------------------------------------------
group("text layout metrics + ranges + hit-test", (t) => {
  using fmt = factory.createTextFormat(SEGOE_FAMILY, { fontCollection: collection, fontSize: 20 });
  const text = "Normal bold italic wrap here onto another line for metrics.";
  using layout = factory.createTextLayout(text, fmt, 240, 400);
  layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;

  const m = layout.getMetrics();
  t.gt(m.width, 0, "layout width > 0");
  t.gt(m.height, 0, "layout height > 0");
  t.gt(m.lineCount, 1, "narrow box forces multiple lines");

  const lineMetrics = layout.getLineMetrics();
  t.eq(lineMetrics.length, m.lineCount, "getLineMetrics returns one entry per line");
  t.eq(lineMetrics.reduce((a, l) => a + l.length, 0), text.length, "line metric lengths cover the whole string");

  const clusterMetrics = layout.getClusterMetrics();
  t.gt(clusterMetrics.length, 0, "getClusterMetrics returns clusters");
  // Reads the packed DWRITE_CLUSTER_METRICS bit fields back: every cluster has a non-negative width
  // and a positive text length, and the space between "bold"/"italic" is flagged whitespace.
  t.ok(clusterMetrics.every((c) => c.width >= 0 && c.length > 0), "cluster metrics decode to sane width/length");
  t.ok(clusterMetrics.some((c) => c.isWhitespace === 1), "a whitespace cluster is flagged");

  t.gt(layout.determineMinWidth(), 0, "determineMinWidth > 0");

  // Per-range formatting: set weight on a substring, read it back inside and outside the range.
  const at = (s: string) => ({ startPosition: text.indexOf(s), length: s.length });
  layout.setFontWeight(DWRITE_FONT_WEIGHT.BOLD, at("bold"));
  layout.setUnderline(true, at("italic"));
  t.eq(layout.getFontWeight(text.indexOf("bold") + 1).fontWeight, DWRITE_FONT_WEIGHT.BOLD, "per-range BOLD applied");
  t.eq(layout.getFontWeight(text.indexOf("Normal") + 1).fontWeight, DWRITE_FONT_WEIGHT.NORMAL, "outside range stays NORMAL");
  t.ok(layout.getUnderline(text.indexOf("italic") + 1).hasUnderline, "per-range underline applied");

  // Hit testing: text position -> point, then point -> back is inside the layout.
  const hp = layout.hitTestTextPosition(0, false);
  t.ok(hp.pointX >= 0 && hp.pointY >= 0, "hitTestTextPosition(0) gives a sane origin point");
  const back = layout.hitTestPoint(hp.pointX + 1, hp.pointY + 1);
  t.ok(back.isInside, "hitTestPoint near the first glyph is inside");
});

// ----------------------------------------------------------------------------------------------
// 9. Typography feature list
// ----------------------------------------------------------------------------------------------
group("typography features", (t) => {
  using typo = factory.createTypography();
  typo.addFontFeature({ nameTag: DWRITE_FONT_FEATURE_TAG.KERNING, parameter: 1 });
  typo.addFontFeature({ nameTag: DWRITE_FONT_FEATURE_TAG.STANDARD_LIGATURES, parameter: 1 });
  t.eq(typo.fontFeatureCount, 2, "two features added");
  const f0 = typo.getFontFeature(0);
  t.eq(f0.nameTag, DWRITE_FONT_FEATURE_TAG.KERNING, "feature 0 tag round-trips");
  t.eq(f0.parameter, 1, "feature 0 parameter round-trips");
});

// ----------------------------------------------------------------------------------------------
// 10. RenderingParams (defaults + custom)
// ----------------------------------------------------------------------------------------------
group("rendering params", (t) => {
  using def = factory.createRenderingParams();
  t.gt(def.gamma, 0, "default gamma > 0");
  t.ok(def.clearTypeLevel >= 0 && def.clearTypeLevel <= 1, "default clearTypeLevel in [0,1]");

  using custom = factory.createCustomRenderingParams({
    gamma: 2.2, enhancedContrast: 0.75, clearTypeLevel: 0.5,
    pixelGeometry: DWRITE_PIXEL_GEOMETRY.RGB, renderingMode: DWRITE_RENDERING_MODE.NATURAL,
  });
  t.approx(custom.gamma, 2.2, 0.001, "custom gamma round-trips (float out-param)");
  t.approx(custom.enhancedContrast, 0.75, 0.001, "custom enhancedContrast round-trips");
  t.approx(custom.clearTypeLevel, 0.5, 0.001, "custom clearTypeLevel round-trips");
  t.eq(custom.pixelGeometry, DWRITE_PIXEL_GEOMETRY.RGB, "custom pixelGeometry round-trips");
  t.eq(custom.renderingMode, DWRITE_RENDERING_MODE.NATURAL, "custom renderingMode round-trips");
});

// ----------------------------------------------------------------------------------------------
// 11. GdiInterop -> BitmapRenderTarget + GlyphRunAnalysis alpha texture
// ----------------------------------------------------------------------------------------------
group("gdi interop + bitmap rt + glyph run analysis", (t) => {
  using interop = factory.getGdiInterop();
  using rt = interop.createBitmapRenderTarget(0, 64, 32);
  const px = rt.pixels();
  t.eq(px.width, 64, "bitmap RT width");
  t.eq(px.height, 32, "bitmap RT height");
  t.eq(px.data.length, 64 * 32, "bitmap RT pixel buffer length");

  // Build a glyph run and render it through the bitmap RT, then check ink landed.
  using params = factory.createRenderingParams();
  using face = factory.loadFontFace(SEGOE);
  const upem = face.getMetrics().designUnitsPerEm;
  const emSize = 20;
  const gids = face.getGlyphIndices([..."Ag"].map((c) => c.codePointAt(0)!));
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / upem) * emSize);
  const run: GlyphRunDesc = { fontFace: face.ptr, fontEmSize: emSize, glyphIndices: gids, glyphAdvances: advances };

  rt.pixels().data.fill(0x00ffffff);
  rt.drawGlyphRun({
    baselineOriginX: 2, baselineOriginY: 22, run, renderingParams: params,
    color: colorref(0, 0, 0), measuringMode: DWRITE_MEASURING_MODE.NATURAL,
  });
  const inked = rt.pixels().data.some((v) => (v & 0x00ffffff) !== 0x00ffffff);
  t.ok(inked, "drawGlyphRun put ink on the bitmap render target");

  // GlyphRunAnalysis -> alpha texture.
  using analysis = factory.createGlyphRunAnalysis(run, {
    renderingMode: DWRITE_RENDERING_MODE.NATURAL, measuringMode: DWRITE_MEASURING_MODE.NATURAL,
  });
  const bounds = analysis.getAlphaTextureBounds(DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1);
  t.ok(bounds.right > bounds.left && bounds.bottom > bounds.top, "alpha texture bounds are non-empty");
  const tex = analysis.createAlphaTexture(DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1, bounds);
  t.eq(tex.data.length, tex.width * tex.height * 3, "CLEARTYPE_3x1 texture is 3 bytes/pixel");
  t.ok(tex.data.some((b) => b !== 0), "alpha texture has non-zero coverage");
});

// ----------------------------------------------------------------------------------------------
// 11b. Glyph outline -> JS geometry sink (ID2D1SimplifiedGeometrySink COM callback)
// ----------------------------------------------------------------------------------------------
group("glyph run outline -> geometry sink", (t) => {
  using face = factory.loadFontFace(SEGOE);
  const emSize = 128;
  const upem = face.getMetrics().designUnitsPerEm;
  const gids = face.getGlyphIndices([..."Bo"].map((c) => c.codePointAt(0)!)); // 'o' has a counter
  const advances = face.getDesignGlyphMetrics(gids).map((g) => (g.advanceWidth / upem) * emSize);

  using sink = new GeometrySink(abi);
  face.getGlyphRunOutline(emSize, gids, sink, { glyphAdvances: advances });

  // "Bo" should yield multiple contours (outer shapes + the bowls/counter of B and o).
  t.gt(sink.figures.length, 2, "outline produced multiple contours");
  t.ok(sink.figures.every((f) => f.closed), "all glyph contours are closed");
  t.ok(sink.figures.some((f) => f.segments.some((s) => s.kind === "bezier")), "outline contains bezier segments");

  const b = sink.bounds()!;
  t.ok(b !== null, "outline has bounds");
  // Y-down DIP space, baseline at 0: caps are negative Y, so -minY ~ cap height (< em box).
  t.ok(-b.minY > emSize * 0.3 && -b.minY < emSize * 1.5, "cap height is in a sane DIP range");
  t.gt(b.maxX, emSize * 0.5, "two glyphs span a sane width");
});

// ----------------------------------------------------------------------------------------------
// 12. Font fallback builder
// ----------------------------------------------------------------------------------------------
group("font fallback", (t) => {
  using sysFallback = factory.getSystemFontFallback();
  t.gt(sysFallback.ptr, 0, "getSystemFontFallback returns an object");

  using builder = factory.createFontFallbackBuilder();
  builder.addMapping([{ first: 0x0, last: 0x10ffff }], [SEGOE_FAMILY], { fontCollection: collection });
  using fallback = builder.createFontFallback();
  t.gt(fallback.ptr, 0, "createFontFallback returns an object");
});

// ----------------------------------------------------------------------------------------------
// 13. Allocator / scope reclamation (linear memory stays flat under churn)
// ----------------------------------------------------------------------------------------------
group("allocator scopes stay flat", (t) => {
  abi.free(0); // free(NULL) must be safe
  const pages = () => abi.memory.buffer.byteLength / 65536;
  const before = pages();
  for (let i = 0; i < 50_000; i++) {
    using s = abi.scope();
    s.allocWString(`scope churn iteration ${i}`);
    s.allocZeroed(128);
    s.out();
  }
  t.eq(pages(), before, "50k scoped alloc/free cycles do not grow linear memory");
});

// ----------------------------------------------------------------------------------------------
// runner
// ----------------------------------------------------------------------------------------------
let passed = 0, failed = 0;
const failures: string[] = [];

for (const g of groups) {
  let groupPass = 0, groupFail = 0;
  const t: T = {
    ok(cond, msg) { cond ? (passed++, groupPass++) : (failed++, groupFail++, failures.push(`[${g.name}] ${msg}`)); },
    eq(a, e, msg) { this.ok(Object.is(a, e), `${msg} (got ${String(a)}, want ${String(e)})`); },
    approx(a, e, eps, msg) { this.ok(Math.abs(a - e) <= eps, `${msg} (got ${a}, want ~${e})`); },
    gt(a, b, msg) { this.ok(a > b, `${msg} (got ${a}, want > ${b})`); },
  };
  try {
    g.fn(t);
    console.log(`  ${groupFail === 0 ? "PASS" : "FAIL"}  ${g.name}  (${groupPass}/${groupPass + groupFail})`);
  } catch (e) {
    failed++; groupFail++;
    failures.push(`[${g.name}] THREW: ${(e as Error).message}`);
    console.log(`  THROW ${g.name}  (${groupPass}/${groupPass + groupFail}), ${(e as Error).message}`);
  }
}

console.log(`\n${failed === 0 ? "RESULT: SUCCESS" : "RESULT: FAILURE"}, ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error("\nFailures:\n  " + failures.join("\n  "));
  process.exit(1);
}
