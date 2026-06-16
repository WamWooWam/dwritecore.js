// Type registry for the idiomatic class emitter: maps DirectWrite C types (as they appear in
// dwrite-model.g.json qualTypes) to ABI lowering descriptors, bound to the existing
// helpers in src/core/types.ts. Knowledge that clang's AST can't carry (which enums/structs we
// already marshal) is recovered by scanning types.ts so we never reference a helper that isn't
// there.

import fs from "node:fs";
import path from "node:path";

const PRIMITIVES = {
  UINT32: { ts: "number", read: "readU32", write: "writeU32", size: 4, umask: ">>> 0" },
  INT32:  { ts: "number", read: "readI32", write: "writeU32", size: 4 },
  UINT16: { ts: "number", read: "readU16", write: "writeU16", size: 2, umask: ">>> 0" },
  FLOAT:  { ts: "number", read: "readF32", write: "writeF32", size: 4, float: true },
  BOOL:   { ts: "boolean", read: "readU32", write: "writeU32", size: 4, bool: true },
  UINT64: { ts: "bigint", read: "readU64", write: "writeU64", size: 8, bits64: true },
  INT64:  { ts: "bigint", read: "readU64", write: "writeU64", size: 8, bits64: true },
};

// Derive the conventional helper base name: DWRITE_FONT_METRICS -> FontMetrics.
export function pascal(structName) {
  return structName
    .replace(/^DWRITE_/, "")
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// Where each exported symbol lives, so the emitter can import from the right module.
// Order matters: hand-written types.ts wins over generated files.
const SYMBOL_SOURCES = [
  { mod: "../core/types.js", file: "src/core/types.ts" },
  { mod: "../core/enums.g.js", file: "src/core/enums.g.ts" },
  { mod: "../core/structs.g.js", file: "src/core/structs.g.ts" },
];

export function buildRegistry(model) {
  const availableEnums = new Set();
  const fns = new Set();
  const sizes = new Set();
  const ifaces = new Set();
  const symbolModule = new Map(); // symbol -> module specifier

  for (const { mod, file } of SYMBOL_SOURCES) {
    const p = path.resolve(file);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    const remember = (name) => { if (!symbolModule.has(name)) symbolModule.set(name, mod); };
    for (const m of src.matchAll(/export enum (\w+)/g)) { availableEnums.add(m[1]); remember(m[1]); }
    for (const m of src.matchAll(/export function (\w+)/g)) { fns.add(m[1]); remember(m[1]); }
    for (const m of src.matchAll(/export const (\w+_SIZE)\b/g)) { sizes.add(m[1]); remember(m[1]); }
    for (const m of src.matchAll(/export interface (\w+)/g)) { ifaces.add(m[1]); remember(m[1]); }
  }

  const structNames = new Set(model.structs.map((s) => s.name));

  // Some structs are marshalled INTO native memory by a hand-written ergonomic writer whose
  // input shape differs from the raw generated struct projection. DWRITE_GLYPH_RUN is the
  // canonical case: the generated interface is a pointer-bag (glyphIndices: number, ...) while
  // the hand `writeGlyphRun` consumes the array-based `GlyphRunDesc` (glyphIndices: number[]).
  // For input params (by-value / by-ref const*), project the parameter as that hand type so the
  // emitted call type-checks and the caller passes ergonomic arrays. Output (reader-based) params
  // keep the raw struct type, since `readGlyphRun` returns the pointer view.
  const INPUT_STRUCT_TS = { DWRITE_GLYPH_RUN: "GlyphRunDesc" };

  // struct C name -> { reader, writer, size, readerBatched, writerBatched } restricted to helpers
  // that exist. A hand helper may be pluralised + count-batched (readFontAxisValues(abi,p,count) /
  // writeFontAxisValues(abi,alloc,values[])); prefer the exact per-element name, else fall back to
  // the plural form and flag it so callers pass/consume a count. Reader and writer are flagged
  // independently (a struct can have a per-element reader but only a batched array writer).
  function structHelpers(name) {
    const base = pascal(name);
    const size = `${name}_SIZE`;
    const single = (verb) => (fns.has(`${verb}${base}`) ? `${verb}${base}` : null);
    const plural = (verb) => (fns.has(`${verb}${base}s`) ? `${verb}${base}s` : null);
    const rS = single("read"), rP = plural("read");
    const wS = single("write"), wP = plural("write");
    return {
      // `reader`/`writer` prefer the per-element helper (used for by-value / by-ref single params);
      // `writerArray` is the batched plural helper that lays out an input ARRAY of n elements.
      reader: rS || rP,
      writer: wS || wP,
      writerArray: wP,
      size: sizes.has(size) ? size : null,
      readerBatched: !rS && !!rP,
      writerBatched: !wS && !!wP,
    };
  }

  // Parse "const DWRITE_FONT_AXIS_VALUE *" -> { base, stars, isConst }.
  function parse(cType) {
    const isConst = /\bconst\b/.test(cType);
    const stars = (cType.match(/\*/g) || []).length;
    const base = cType.replace(/\bconst\b/g, "").replace(/\*/g, "").trim();
    return { base, stars, isConst };
  }

  // Classify a parameter or return type into a lowering role. Direction for single pointers
  // uses the `const` heuristic (clang drops SAL): const T* = input, T* = output.
  // `count`-pairing and string-length pairing are resolved by the emitter (method-level).
  function classify(cType) {
    const { base, stars, isConst } = parse(cType);
    const imports = new Set();

    // by value
    if (stars === 0) {
      if (PRIMITIVES[base]) return { kind: "scalar", prim: PRIMITIVES[base], imports };
      if (availableEnums.has(base)) { imports.add(base); return { kind: "enum", ts: base, imports }; }
      if (structNames.has(base)) {
        const h = structHelpers(base);
        if (h.writer && h.size) { imports.add(h.writer).add(h.size); return { kind: "in-struct", struct: INPUT_STRUCT_TS[base] || base, ...h, imports }; }
        return { kind: "unsupported", reason: `no writer/size for by-value struct ${base}`, imports };
      }
      // unknown DWRITE_* scalar enum we don't model in TS -> plain number
      return { kind: "enum-number", ts: "number", imports };
    }

    // WCHAR* (WCHAR is a typedef for wchar_t; some headers spell the unaliased form).
    if ((base === "WCHAR" || base === "wchar_t") && stars === 1) {
      return isConst ? { kind: "in-string", imports } : { kind: "out-string", imports };
    }

    // void* / void** : an opaque handle, buffer, or context (font-file reference KEYS, fragment
    // contexts, raw font data). There's nothing to marshal, surface it as a plain number. A single
    // pointer is an input the caller supplies; a double pointer is an out-param receiving a pointer.
    if (base === "void") {
      if (stars >= 2) return { kind: "out-scalar", prim: PRIMITIVES.UINT32, imports };
      if (stars === 1) return { kind: "scalar", prim: PRIMITIVES.UINT32, imports };
    }

    // interface pointers (IUnknown lowers to the base wrapper via the emitter's fallback)
    if (/^(IDWrite|IUnknown)/.test(base)) {
      if (stars === 2) { imports.add(base); return { kind: "out-object", cls: base, imports }; }
      if (stars === 1) { imports.add(base); return { kind: "in-object", cls: base, imports }; }
    }

    // single pointer to primitive/enum/struct: const = input, non-const = output.
    // A const pointer to a scalar/enum is an input ARRAY (paired with a count param);
    // a non-const pointer is a single out-param.
    if (stars === 1) {
      const out = !isConst;
      if (PRIMITIVES[base]) {
        const prim = PRIMITIVES[base];
        return out ? { kind: "out-scalar", prim, imports } : { kind: "in-array", elemKind: "scalar", prim, imports };
      }
      if (availableEnums.has(base)) {
        imports.add(base);
        return out ? { kind: "out-scalar", prim: PRIMITIVES.UINT32, ts: base, imports }
                   : { kind: "in-array", elemKind: "scalar", prim: PRIMITIVES.UINT32, ts: base, imports };
      }
      if (structNames.has(base)) {
        const h = structHelpers(base);
        imports2(imports, h);
        return out ? { kind: "out-struct", struct: base, ...h, imports }
                   : { kind: "in-array", elemKind: "struct", struct: INPUT_STRUCT_TS[base] || base, ...h, imports };
      }
      // unknown enum pointer
      return out ? { kind: "out-scalar", prim: PRIMITIVES.UINT32, imports }
                 : { kind: "in-array", elemKind: "scalar", prim: PRIMITIVES.UINT32, imports };
    }

    return { kind: "unsupported", reason: `cannot classify "${cType}"`, imports };
  }

  function imports2(set, h) {
    if (h.reader) set.add(h.reader);
    if (h.writer) set.add(h.writer);
    if (h.size) set.add(h.size);
  }

  // Module specifier for an imported symbol (which generated/hand file exports it).
  function moduleOf(sym) { return symbolModule.get(sym) || "../core/types.js"; }

  return { classify, availableEnums, ifaces, structHelpers, moduleOf, structNames };
}

// ---- struct layout (C ABI, wasm32 natural alignment) --------------------------------------
// Field scalar layouts. Pointers and enums are 4 bytes; BOOL is a 4-byte int surfaced as a
// boolean. Used to generate readers/writers + sizes from model.structs.
export const FIELD_SCALARS = {
  UINT8:  { size: 1, align: 1, get: "getUint8", set: "setUint8", endian: false, ts: "number" },
  INT8:   { size: 1, align: 1, get: "getInt8",  set: "setInt8",  endian: false, ts: "number" },
  BYTE:   { size: 1, align: 1, get: "getUint8", set: "setUint8", endian: false, ts: "number" },
  UINT16: { size: 2, align: 2, get: "getUint16", set: "setUint16", endian: true, ts: "number" },
  INT16:  { size: 2, align: 2, get: "getInt16", set: "setInt16", endian: true, ts: "number" },
  UINT32: { size: 4, align: 4, get: "getUint32", set: "setUint32", endian: true, ts: "number" },
  INT32:  { size: 4, align: 4, get: "getInt32", set: "setInt32", endian: true, ts: "number" },
  FLOAT:  { size: 4, align: 4, get: "getFloat32", set: "setFloat32", endian: true, ts: "number" },
  BOOL:   { size: 4, align: 4, get: "getUint32", set: "setUint32", endian: true, ts: "boolean", bool: true },
  UINT64: { size: 8, align: 8, get: "getBigUint64", set: "setBigUint64", endian: true, ts: "bigint" },
  INT64:  { size: 8, align: 8, get: "getBigInt64", set: "setBigInt64", endian: true, ts: "bigint" },
};

const alignUp = (off, a) => (off + (a - 1)) & ~(a - 1);

// Resolve a struct field's C type to a layout cell. `ctx` carries enum/struct knowledge.
// Returns { size, align, ts, kind, ... } or { unsupported, reason }.
export function layoutField(cType, ctx) {
  const arr = cType.match(/^(.*)\[(\d+)\]$/);
  if (arr) {
    const el = layoutField(arr[1].trim(), ctx);
    if (el.unsupported) return el;
    const n = +arr[2];
    return { size: el.size * n, align: el.align, ts: `${el.ts}[]`, kind: "array", el, n };
  }
  const isPtr = /\*/.test(cType);
  const base = cType.replace(/\bconst\b/g, "").replace(/\*/g, "").trim();
  if (isPtr) return { size: 4, align: 4, ts: "number", kind: "ptr" };
  if (FIELD_SCALARS[base]) return { ...FIELD_SCALARS[base], kind: "scalar" };
  if (ctx.availableEnums.has(base)) return { size: 4, align: 4, ts: base, kind: "enum", enumName: base };
  if (ctx.modelEnums.has(base)) return { size: 4, align: 4, ts: "number", kind: "enum" };
  if (ctx.structByName.has(base)) {
    const sub = ctx.layoutOf(base);
    if (sub.unsupported) return { unsupported: true, reason: `nested ${base}: ${sub.reason}` };
    return { size: sub.size, align: sub.align, ts: base, kind: "struct", struct: base };
  }
  return { unsupported: true, reason: `unknown field type "${cType}"` };
}

// A derived struct (DWRITE_FONT_METRICS1 : DWRITE_FONT_METRICS) lays out the base subobject
// first, then its own fields. Flatten the whole base chain, base-most first.
function flattenFields(struct, ctx) {
  const out = [];
  const baseName = struct.base && struct.base.replace(/\bconst\b/g, "").replace(/[*&]/g, "").trim();
  if (baseName && ctx.structByName.has(baseName)) out.push(...flattenFields(ctx.structByName.get(baseName), ctx));
  out.push(...struct.fields);
  return out;
}

// Full layout for a named struct: assigns offsets, total size, alignment.
//
// Consecutive bit-field members (clang gives them a `.bits` width) of the same underlying integer
// are packed into ONE storage unit of that integer's width, exactly like the native C ABI, e.g.
// DWRITE_SHAPING_GLYPH_PROPERTIES's five members all live in a single UINT16. Each packed member
// lays out at the unit's byte offset with a `shift`/`mask` so the reader/writer can project it; a
// new unit starts when the type changes or the next member would overflow the current one.
export function layoutStruct(struct, ctx) {
  let off = 0, align = 1;
  const fields = [];
  let bf = null; // active bit-field run: { type, scalar, unitOff, bitPos }
  for (const f of flattenFields(struct, ctx)) {
    if (f.bits != null) {
      const base = f.type.replace(/\bconst\b/g, "").trim();
      const scalar = FIELD_SCALARS[base];
      if (!scalar || scalar.size > 4)
        return { unsupported: true, reason: `${struct.name}.${f.name}: bitfield of unsupported type "${f.type}"` };
      const unitBits = scalar.size * 8;
      // A zero-width bit field only forces alignment to the next unit; it has no member.
      if (f.bits === 0) { bf = null; continue; }
      if (!bf || bf.type !== base || bf.bitPos + f.bits > unitBits) {
        off = alignUp(off, scalar.align);
        bf = { type: base, scalar, unitOff: off, bitPos: 0 };
        off += scalar.size;
        align = Math.max(align, scalar.align);
      }
      fields.push({
        name: f.name,
        off: bf.unitOff,
        L: {
          kind: "bitfield", ts: "number",
          shift: bf.bitPos, mask: (1 << f.bits) - 1,
          get: scalar.get, set: scalar.set, endian: scalar.endian,
        },
      });
      bf.bitPos += f.bits;
      continue;
    }
    bf = null; // any non-bitfield ends the current run
    const L = layoutField(f.type, ctx);
    if (L.unsupported) return { unsupported: true, reason: `${struct.name}.${f.name}: ${L.reason}` };
    off = alignUp(off, L.align);
    fields.push({ name: f.name, off, L });
    off += L.size;
    align = Math.max(align, L.align);
  }
  return { size: alignUp(off, align), align, fields };
}
