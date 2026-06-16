// Unit test for the generated packed-bit-field struct readers/writers in src/core/structs.g.ts.
// These structs pack several C bit fields into one storage integer; the codegen (tools/binding-spec
// layoutStruct + the emitter's bitfield read/write) must size them to the native ABI width and
// decode/encode each member with the right shift+mask. A regression here silently misreads any array
// DirectWriteCore fills. We exercise the readers/writers directly against a scratch buffer (no wasm),
// asserting: native sizes, distinct-value round-trips (overlapping fields would corrupt neighbours),
// and the exact packed-word bit layout for the two shaping structs the public API hands back raw.
import {
  DWRITE_SHAPING_TEXT_PROPERTIES_SIZE, readShapingTextProperties, writeShapingTextProperties,
  DWRITE_SHAPING_GLYPH_PROPERTIES_SIZE, readShapingGlyphProperties, writeShapingGlyphProperties,
  DWRITE_CLUSTER_METRICS_SIZE, readClusterMetrics, writeClusterMetrics,
  DWRITE_LINE_BREAKPOINT_SIZE, readLineBreakpoint, writeLineBreakpoint,
  DWRITE_SCRIPT_PROPERTIES_SIZE, readScriptProperties, writeScriptProperties,
  DWRITE_JUSTIFICATION_OPPORTUNITY_SIZE, readJustificationOpportunity, writeJustificationOpportunity,
} from "../src/core/structs.g.js";

// Minimal Abi + Allocator over one scratch ArrayBuffer (a bump allocator), enough for the
// struct helpers which only touch abi.dv / alloc.allocZeroed.
const buf = new ArrayBuffer(256);
const dv = new DataView(buf);
const u8 = new Uint8Array(buf);
let top = 0;
const abi = { dv, u8 } as never;
const alloc = { allocZeroed(n: number) { const p = top; top += n; u8.fill(0, p, top); return p; } } as never;

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? `  , ${detail}` : ""}`);
  ok ? pass++ : fail++;
};
// Deep-equal a struct round-trip with distinct values per field.
function roundTrip<T extends Record<string, number>>(
  name: string, size: number, expectedSize: number,
  write: (abi: never, alloc: never, v: T) => number, read: (abi: never, p: number) => T, v: T,
) {
  check(`${name} size == ${expectedSize}`, size === expectedSize, `got ${size}`);
  const p = write(abi, alloc, v);
  const back = read(abi, p);
  const mismatches = Object.keys(v).filter((k) => !Object.is(v[k], (back as Record<string, number>)[k]));
  check(`${name} round-trips all fields`, mismatches.length === 0,
    `mismatched: ${mismatches.map((k) => `${k} ${v[k]}!=${(back as Record<string, number>)[k]}`).join(", ")}`);
}

console.log("\nShaping structs (2-byte packed UINT16):");
// Distinct values chosen to fill each field's width (4/1/1/1/9 bits) without overlap.
roundTrip("DWRITE_SHAPING_GLYPH_PROPERTIES", DWRITE_SHAPING_GLYPH_PROPERTIES_SIZE, 2,
  writeShapingGlyphProperties, readShapingGlyphProperties,
  { justification: 11, isClusterStart: 1, isDiacritic: 0, isZeroWidthSpace: 1, reserved: 300 });
roundTrip("DWRITE_SHAPING_TEXT_PROPERTIES", DWRITE_SHAPING_TEXT_PROPERTIES_SIZE, 2,
  writeShapingTextProperties, readShapingTextProperties,
  { isShapedAlone: 1, reserved1: 0, canBreakShapingAfter: 1, reserved: 5000 });

// The public shaping API (ShapedGlyphs.glyphProps/textProps) returns these as raw packed UINT16;
// the hand decoder masks must match the packed bit positions the writer produces.
{
  const p = writeShapingGlyphProperties(abi, alloc,
    { justification: 11, isClusterStart: 1, isDiacritic: 0, isZeroWidthSpace: 1, reserved: 0 });
  const word = dv.getUint16(p, true);
  check("glyph props pack into the documented bit positions",
    (word & 0xf) === 11 && (word & 0x10) !== 0 && (word & 0x20) === 0 && (word & 0x40) !== 0,
    `word=0x${word.toString(16)}`);
}

console.log("\nMixed scalar + packed-tail structs:");
roundTrip("DWRITE_CLUSTER_METRICS", DWRITE_CLUSTER_METRICS_SIZE, 8,
  writeClusterMetrics, readClusterMetrics,
  { width: 1.5, length: 7, canWrapLineAfter: 1, isWhitespace: 0, isNewline: 1, isSoftHyphen: 0, isRightToLeft: 1, padding: 1000 });
roundTrip("DWRITE_LINE_BREAKPOINT", DWRITE_LINE_BREAKPOINT_SIZE, 1,
  writeLineBreakpoint, readLineBreakpoint,
  { breakConditionBefore: 2, breakConditionAfter: 1, isWhitespace: 1, isSoftHyphen: 0, padding: 3 });
roundTrip("DWRITE_SCRIPT_PROPERTIES", DWRITE_SCRIPT_PROPERTIES_SIZE, 20,
  writeScriptProperties, readScriptProperties,
  { isoScriptCode: 215, isoScriptNumber: 42, clusterLookahead: 3, justificationCharacter: 0x20,
    restrictCaretToClusters: 1, usesWordDividers: 0, isDiscreteWriting: 1, isBlockWriting: 0,
    isDistributedWithinCluster: 1, isConnectedWriting: 0, isCursiveWriting: 1, reserved: 1234567 });
roundTrip("DWRITE_JUSTIFICATION_OPPORTUNITY", DWRITE_JUSTIFICATION_OPPORTUNITY_SIZE, 16,
  writeJustificationOpportunity, readJustificationOpportunity,
  { expansionMinimum: 0.25, expansionMaximum: 2.5, compressionMaximum: 0.75,
    expansionPriority: 200, compressionPriority: 100, allowResidualExpansion: 1,
    allowResidualCompression: 0, applyToLeadingEdge: 1, applyToTrailingEdge: 0, reserved: 3000 });

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
