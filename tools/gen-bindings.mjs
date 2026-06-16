// Generate DirectWrite COM binding metadata from the Windows SDK headers, using clang's
// JSON AST as the source of truth for structure (inheritance, vtable-ordered methods,
// parameter names/types, structs, enums) and a tiny regex pass for the interface GUIDs
// (clang's JSON UuidAttr does not emit the guid string).
//
// Emits:
//   src/core/slots.g.ts        - one `const enum <Iface>Slot` per interface version,
//                                         each the full cumulative vtable (absolute slots).
//   src/core/iids.g.ts         - `export const IID_<Iface> = new Guid("...")`.
//   src/core/dwrite-model.g.json - the full machine-readable interface model.
//
// Usage: node --max-old-space-size=6144 tools/gen-bindings.mjs [--sdk <dir>] [--clang <path>]

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildRegistry, layoutStruct, pascal, FIELD_SCALARS } from "./binding-spec.mjs";

const GENERATOR_VERSION = "1.0.0.0"

// ---- args ---------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const CLANG = getArg("--clang") ?? "clang";

// ---- locate the SDK -----------------------------------------------------------------------
function findSdk() {
  const override = getArg("--sdk");
  if (override) return override;
  const root = "C:/Program Files (x86)/Windows Kits/10/Include";
  const versions = fs
    .readdirSync(root)
    .filter((d) => /^\d+(\.\d+)+$/.test(d))
    .filter((d) => fs.existsSync(path.join(root, d, "um", "dwrite_3.h")))
    .sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  if (!versions.length) throw new Error(`no SDK with um/dwrite_3.h under ${root}`);
  return path.join(root, versions[versions.length - 1]);
}
const SDK = findSdk();
const SDK_VERSION = path.basename(SDK);
console.error(`[gen] SDK: ${SDK}`);

// ---- drive clang --------------------------------------------------------------------------
function dumpAst() {
  const args = [
    "-x", "c++", "-",
    "-Xclang", "-ast-dump=json",
    "-fsyntax-only",
    "--target=x86_64-pc-windows-msvc",
    "-fms-compatibility", "-fms-extensions",
    "-I", path.join(SDK, "um"),
    "-I", path.join(SDK, "shared"),
    "-I", path.join(SDK, "ucrt"),
    "-I", path.join(SDK, "winrt"),
  ];
  // Include windows.h first and undo the Win32 A/W text macros that would otherwise rewrite
  // DWrite method names (wingdi.h does `#define GetGlyphIndices GetGlyphIndicesA`). The
  // include guard keeps these undefined when dwrite_3.h re-includes windows.h, so the methods
  // parse under their real names.
  const tu =
    "#include <windows.h>\n" +
    "#undef GetGlyphIndices\n" +
    "#include <dwrite_3.h>\n";
  const res = spawnSync(CLANG, args, {
    input: tu,
    maxBuffer: 1024 * 1024 * 1024,
    encoding: "utf8",
  });
  if (res.error)
    throw new Error(
      `failed to run clang (${CLANG}): ${res.error.message}\n` +
        `Need clang on PATH (or --clang <path>) able to parse the MSVC SDK headers with:\n` +
        `  --target=x86_64-pc-windows-msvc -fms-compatibility -fms-extensions`,
    );
  if (!res.stdout || res.stdout.length < 1000)
    throw new Error(`clang produced no AST. stderr:\n${res.stderr}`);
  return JSON.parse(res.stdout);
}

// ---- walk the AST -------------------------------------------------------------------------
function walk(node, fn) {
  if (!node || typeof node !== "object") return;
  fn(node);
  for (const child of node.inner || []) walk(child, fn);
}

// Return type is the text before the first "(" in the function's qualType, e.g.
// "HRESULT (UINT32, ...) __attribute__(...)" -> "HRESULT".
function returnType(qualType) {
  return qualType.split("(")[0].trim();
}

function parseEnumValue(decl) {
  // EnumConstantDecl with an explicit initializer carries an inner expression we can read;
  // clang doesn't fold it for us, so fall back to sequential numbering when absent.
  const init = (decl.inner || []).find((c) => /Literal|Expr|Cast/.test(c.kind || ""));
  if (init && init.value !== undefined) return Number(init.value);
  return undefined;
}

// Bit-field width for a `FieldDecl` flagged `isBitfield`. clang carries the width as the field's
// first inner expression (a folded ConstantExpr with `.value`, e.g. `UINT16 reserved : 13`). Scan
// for the first node that has a numeric `value` so we tolerate an IntegerLiteral nested in a cast.
function bitfieldWidth(field) {
  let found;
  walk({ inner: field.inner }, (n) => {
    if (found === undefined && n !== field && n.value !== undefined && /Literal|Expr/.test(n.kind || ""))
      found = Number(n.value);
  });
  return found;
}

const typeBase = (t) => t.replace(/\bconst\b/g, "").replace(/[*&]/g, "").replace(/\[\d*\]/g, "").trim();

function buildModel(ast) {
  const interfaces = [];
  const enums = [];
  // candidate records (DWRITE_ and D2D, any header) keyed by name; pared to the referenced set
  // at the end so we don't pull in the whole D2D library.
  const candidateStructs = new Map();

  // clang's JSON AST only emits loc.file when the file CHANGES; mid-file nodes inherit it from
  // the preceding node in traversal order. Track it ourselves so the dwrite-file filter doesn't
  // drop enums/structs that simply followed another node in the same header (this silently lost
  // DWRITE_FONT_AXIS_TAG, DWRITE_FONT_PROPERTY_ID, DWRITE_PAINT_TYPE, ...).
  let curFile = "";
  walk(ast, (n) => {
    if (n.loc && n.loc.file) curFile = n.loc.file;
    const file = curFile;
    const isDwriteFile = /dwrite[^/\\]*\.h$/i.test(file);

    // interfaces: IDWrite* records with a base
    if (n.kind === "CXXRecordDecl" && n.name && n.inner && n.bases && /^IDWrite/.test(n.name)) {
      const methods = (n.inner || [])
        .filter((x) => x.kind === "CXXMethodDecl" && x.virtual)
        .map((x) => {
          // Safety net: a trailing A/W after a lowercase letter is the Win32 text-macro shape;
          // real DWrite method names never end that way. If one slips through, the prologue
          // needs another #undef.
          if (/[a-z][AW]$/.test(x.name))
            console.error(`[gen] WARN possibly A/W-mangled method name: ${n.name}::${x.name}`);
          const ret = returnType(x.type.qualType);
          return {
            name: x.name,
            ret,
            directReturn: ret !== "HRESULT",
            params: (x.inner || [])
              .filter((p) => p.kind === "ParmVarDecl")
              .map((p) => ({ name: p.name ?? null, type: p.type.qualType })),
          };
        });
      if (n.bases.length > 1)
        console.error(`[gen] WARN ${n.name} has ${n.bases.length} bases (expected 1)`);
      interfaces.push({
        name: n.name,
        iid: null, // filled by the regex pass
        base: (n.bases[0] && n.bases[0].type.qualType) || null,
        methods,
      });
    }

    // candidate structs: DWRITE_/D2D records (incl. DERIVED ones, which carry a base). Captured
    // from any header so referenced D2D types (D2D1_POINT_2F etc.) come along.
    if ((n.kind === "CXXRecordDecl" || n.kind === "RecordDecl") && n.name && n.inner &&
        /^(DWRITE_|D2D)/.test(n.name) && !candidateStructs.has(n.name)) {
      const fields = (n.inner || [])
        .filter((x) => x.kind === "FieldDecl")
        .map((f) => {
          const fld = { name: f.name, type: f.type.qualType };
          // Packed bit fields (DWRITE_SHAPING_*_PROPERTIES) carry a width; record it so the layout
          // pass can pack consecutive members of the same integer into one storage unit.
          if (f.isBitfield) fld.bits = bitfieldWidth(f);
          return fld;
        });
      const base = (n.bases && n.bases[0] && n.bases[0].type.qualType) || null;
      if (fields.length || base)
        candidateStructs.set(n.name, { name: n.name, base, fields, dwrite: /^DWRITE_/.test(n.name) && isDwriteFile });
    }

    if (n.kind === "EnumDecl" && n.name && /^DWRITE_/.test(n.name) && n.inner && isDwriteFile) {
      let next = 0;
      const values = (n.inner || [])
        .filter((x) => x.kind === "EnumConstantDecl")
        .map((e) => {
          let v = parseEnumValue(e);
          if (v === undefined) v = next;
          next = v + 1;
          return { name: e.name, value: v };
        });
      enums.push({ name: n.name, values });
    }
  });

  // Resolve which structs to keep: every DWRITE_ struct (prior behavior), plus any candidate
  // referenced by an interface method or transitively by a kept struct's base/fields.
  const keep = new Set();
  for (const [name, s] of candidateStructs) if (s.dwrite) keep.add(name);
  for (const i of interfaces)
    for (const me of i.methods)
      for (const t of [me.ret, ...me.params.map((p) => p.type)])
        if (candidateStructs.has(typeBase(t))) keep.add(typeBase(t));
  for (let changed = true; changed; ) {
    changed = false;
    for (const name of [...keep]) {
      const s = candidateStructs.get(name);
      if (!s) continue;
      for (const dep of [s.base, ...s.fields.map((f) => f.type)]) {
        const b = dep && typeBase(dep);
        if (b && candidateStructs.has(b) && !keep.has(b)) { keep.add(b); changed = true; }
      }
    }
  }
  const structs = [...keep].map((n) => candidateStructs.get(n)).map(({ name, base, fields }) => ({ name, base, fields }));

  return { interfaces, structs, enums };
}

// ---- GUID regex pass ----------------------------------------------------------------------
function readGuids() {
  const um = path.join(SDK, "um");
  const map = new Map();
  for (const f of ["dwrite.h", "dwrite_1.h", "dwrite_2.h", "dwrite_3.h"]) {
    const p = path.join(um, f);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    let m;
    const re1 = /DWRITE_DECLARE_INTERFACE\(\s*"([0-9a-fA-F-]+)"\s*\)\s+(\w+)/g;
    while ((m = re1.exec(text))) map.set(m[2], m[1].toLowerCase());
    const re2 = /DWRITE_BEGIN_INTERFACE\(\s*(\w+)\s*,\s*"([0-9a-fA-F-]+)"/g;
    while ((m = re2.exec(text))) map.set(m[1], m[2].toLowerCase());
  }
  return map;
}

// ---- cumulative slots ---------------------------------------------------------------------
// IUnknown occupies slots 0..2 (QueryInterface/AddRef/Release), so the first DWrite method
// is slot 3. Walk the single-inheritance ancestor chain (excluding IUnknown) and number every
// method absolutely. TS enum keys must be unique within one enum, so dedupe by suffixing the
// slot on later collisions.
function computeSlots(model) {
  const byName = new Map(model.interfaces.map((i) => [i.name, i]));

  // ancestor chain from the topmost DWrite interface down to (and including) `iface`.
  function chain(iface) {
    const out = [];
    let cur = iface;
    while (cur && cur.name !== "IUnknown") {
      out.unshift(cur);
      cur = cur.base && cur.base !== "IUnknown" ? byName.get(cur.base) : null;
    }
    return out;
  }

  const enums = []; // { name, members: [{key, slot}] }
  for (const iface of model.interfaces) {
    if (!iface.methods.length && iface.base === "IUnknown") {
      // still emit an (empty) enum so the name exists; rare.
    }
    let slot = 3;
    const members = [];
    const used = new Set(); // emitted enum keys, to keep them unique
    for (const anc of chain(iface)) {
      // version digits of the declaring interface (IDWriteFactory5 -> "5", base -> "").
      const ver = (anc.name.match(/\d+$/) || [""])[0];
      for (const m of anc.methods) {
        // Same-named methods declared in different interface versions are GENUINELY DISTINCT
        // (e.g. IDWriteFactory3/5/6 each add a CreateFontSetBuilder at a different slot,
        // returning a different type). Keep them all, but disambiguate later collisions with
        // the declaring version so the key documents which overload it is
        // (`CreateFontSetBuilder5` = the IDWriteFactory5 one). Bare name = first declarer.
        let key = m.name;
        if (used.has(key)) {
          key = ver ? `${m.name}${ver}` : `${m.name}_${slot}`;
          while (used.has(key)) key = `${m.name}_${slot}`; // final tiebreak
        }
        used.add(key);
        members.push({ key, slot, method: m, declIface: anc.name });
        // annotate the model's own methods with their absolute slot
        if (anc === iface) m.slot = slot;
        slot++;
      }
    }
    enums.push({ name: `${iface.name}Slot`, members });
  }
  return enums;
}

// ---- emit ---------------------------------------------------------------------------------
const BANNER = `//------------------------------------------------------------------------------
// <auto-generated>
//     This code was generated by a tool.
//     Runtime Version:${GENERATOR_VERSION}
// 
//     Changes to this file may cause incorrect behavior and will be lost if
//     the code is regenerated.
// </auto-generated>
//------------------------------------------------------------------------------
`;

function emitSlots(slotEnums) {
  let out = BANNER + "\n";
  for (const e of slotEnums) {
    if (!e.members.length) continue;
    out += `export const enum ${e.name} {\n`;
    for (const m of e.members) out += `  ${m.key} = ${m.slot},\n`;
    out += `}\n\n`;
  }
  return out;
}

function emitIids(model) {
  let out = BANNER + 'import { Guid } from "./guid.js";\n\n';
  for (const i of model.interfaces) {
    if (!i.iid) continue;
    out += `export const IID_${i.name} = new Guid("${i.iid}");\n`;
  }
  return out;
}

// ---- enum codegen -------------------------------------------------------------------------
// Member names keep the DWRITE_ enum NAME but drop the shared prefix (matching the hand enums:
// DWRITE_FONT_WEIGHT.THIN). The longest common prefix trimmed to a underscore boundary.
function commonPrefix(names) {
  if (!names.length) return "";
  if (names.length === 1) {
    const i = names[0].lastIndexOf("_");
    return i >= 0 ? names[0].slice(0, i + 1) : "";
  }
  let p = names[0];
  for (const n of names) while (!n.startsWith(p)) p = p.slice(0, -1);
  const i = p.lastIndexOf("_");
  return i >= 0 ? p.slice(0, i + 1) : "";
}

function emitEnums(model, suppress) {
  let out = BANNER + "\n";
  let count = 0;
  const emitted = new Set();
  for (const e of model.enums) {
    if (suppress.has(e.name)) continue; // hand types.ts owns it (as enum or const)
    const prefix = commonPrefix(e.values.map((v) => v.name));
    out += `export enum ${e.name} {\n`;
    for (const v of e.values) {
      let key = v.name.startsWith(prefix) ? v.name.slice(prefix.length) : v.name;
      if (/^\d/.test(key)) key = "_" + key;
      out += `  ${key} = ${v.value},\n`;
    }
    out += `}\n\n`;
    emitted.add(e.name);
    count++;
  }
  return { text: out, count, emitted };
}

// ---- struct codegen (interfaces + readers/writers/sizes from model.structs) ---------------
function emitStructs(model, hand, emittedEnums) {
  const structByName = new Map(model.structs.map((s) => [s.name, s]));
  const modelEnums = new Set(model.enums.map((e) => e.name));
  // enums usable as a TS *type*: hand `export enum`s + the enums we actually emit in enums.g.ts.
  // Model enums suppressed because types.ts owns them as a `const` (DWRITE_FONT_AXIS_TAG) are
  // deliberately excluded so their struct fields lower as a plain numeric enum (no broken import).
  const availableEnums = new Set([...hand.enums, ...emittedEnums]);

  const memo = new Map();
  const ctx = { availableEnums, modelEnums, structByName, layoutOf };
  function layoutOf(name) {
    if (memo.has(name)) return memo.get(name);
    const s = structByName.get(name);
    if (!s) return { unsupported: true, reason: `no struct ${name}` };
    memo.set(name, { unsupported: true, reason: "recursive" });
    const r = layoutStruct(s, ctx);
    memo.set(name, r);
    return r;
  }

  // import bookkeeping: symbol -> source module (relative to src/core). Interface type names
  // must be `import type` (verbatimModuleSyntax); enums/readers/sizes are value imports.
  const valImports = new Map();
  const typImports = new Map();
  const addTo = (map, mod, sym) => { if (!map.has(mod)) map.set(mod, new Set()); map.get(mod).add(sym); };
  const addVal = (mod, sym) => addTo(valImports, mod, sym);
  const addTyp = (mod, sym) => addTo(typImports, mod, sym);
  // where a referenced symbol lives, from this file's (src/core) vantage point.
  const enumMod = (name) => (hand.enums.has(name) ? "./types.js" : "./enums.g.js");

  let body = "";
  let needAlloc = false;
  let count = 0, skipped = 0;

  for (const struct of model.structs) {
    const base = pascal(struct.name);
    const reader = `read${base}`;
    const writer = `write${base}`;
    const sizeName = `${struct.name}_SIZE`;

    // What types.ts already provides, never redefine those, but fill in missing readers/sizes
    // (e.g. DWRITE_UNICODE_RANGE has a hand interface + writer but no reader). A hand helper may
    // be pluralised + count-batched (readFontAxisValues(abi,p,count)); accept that form too so we
    // defer to it rather than emit a clashing per-element reader.
    const handIface = hand.ifaces.has(struct.name);
    const handReader = hand.fns.has(reader) || hand.fns.has(reader + "s");
    const handWriter = hand.fns.has(writer) || hand.fns.has(writer + "s");
    const handSize = hand.sizes.has(sizeName);
    if (handIface && handReader && handWriter) continue; // fully hand-owned

    const lay = layoutOf(struct.name);
    if (lay.unsupported) { console.error(`[gen] struct skip ${struct.name}: ${lay.reason}`); skipped++; continue; }

    // collect imports for field types
    for (const { L } of lay.fields) {
      if (L.kind === "enum" && L.enumName) addVal(enumMod(L.enumName), L.enumName);
      if (L.kind === "struct") {
        const r = `read${pascal(L.struct)}`;
        if (hand.fns.has(r)) addVal("./types.js", r);
        if (hand.ifaces.has(L.struct)) addTyp("./types.js", L.struct);
      }
    }
    if (handIface) addTyp("./types.js", struct.name); // import the hand interface for our reader's type

    const iface = handIface ? "" :
      `export interface ${struct.name} {\n`
      + lay.fields.map((f) => `  ${f.name}: ${f.L.ts};`).join("\n") + `\n}\n`;

    const sizeLine = handSize ? "" : `export const ${sizeName} = ${lay.size};\n`;

    const rd = handReader ? "" :
      `export function ${reader}(abi: Abi, p: number): ${struct.name} {\n  return {\n`
      + lay.fields.map((f) => `    ${f.name}: ${readExpr(f.L, f.off, f.name)},`).join("\n")
      + `\n  };\n}\n`;

    // writer (only for flat structs: scalar/enum/bool/ptr fields). Emit both a single-element
    // writer (for by-value / by-ref params) and a batched plural writer `${writer}s` (for input
    // ARRAY params, e.g. IDWriteFontSetBuilder::AddFont(const DWRITE_FONT_PROPERTY*, count)), a
    // single-element writer can't lay out n contiguous elements.
    const flat = lay.fields.every((f) => ["scalar", "enum", "ptr", "bitfield"].includes(f.L.kind));
    let wr = "";
    if (flat && !handWriter) {
      needAlloc = true;
      if (handSize) addVal("./types.js", sizeName); // writer references a hand-owned SIZE
      wr = `export function ${writer}(abi: Abi, alloc: Allocator, v: ${struct.name}): number {\n`
        + `  const p = alloc.allocZeroed(${sizeName});\n`
        + lay.fields.map((f) => `  ${writeStmt(f.L, f.off, f.name)}`).join("\n")
        + `\n  return p;\n}\n`;
    }
    let wrArr = "";
    if (flat && !handIface && !handWriter && !hand.fns.has(writer + "s")) {
      needAlloc = true;
      if (handSize) addVal("./types.js", sizeName);
      wrArr = `export function ${writer}s(abi: Abi, alloc: Allocator, v: ${struct.name}[]): number {\n`
        + `  const p = alloc.allocZeroed(${sizeName} * v.length);\n`
        + `  v.forEach((e, i) => {\n`
        + `    const o = p + i * ${sizeName};\n`
        + lay.fields.map((f) => `    ${writeStmt(f.L, f.off, f.name, "o", "e")}`).join("\n")
        + `\n  });\n  return p;\n}\n`;
    }

    if (iface || sizeLine || rd || wr || wrArr) { body += `\n${iface}${sizeLine}${rd}${wr}${wrArr}`; count++; }
  }

  let header = BANNER + `import type { Abi${needAlloc ? ", Allocator" : ""} } from "./abi.js";\n`;
  for (const [mod, syms] of [...valImports].sort())
    header += `import { ${[...syms].sort().join(", ")} } from "${mod}";\n`;
  for (const [mod, syms] of [...typImports].sort())
    header += `import type { ${[...syms].sort().join(", ")} } from "${mod}";\n`;

  return { text: header + body + "\n", count, skipped };

  function readExpr(L, off, _name) {
    if (L.kind === "scalar" && L.bool) return `abi.dv.getUint32(p + ${off}, true) !== 0`;
    if (L.kind === "scalar") return `abi.dv.${L.get}(p + ${off}${L.endian ? ", true" : ""})`;
    if (L.kind === "bitfield")
      return `(abi.dv.${L.get}(p + ${off}${L.endian ? ", true" : ""}) >>> ${L.shift}) & ${L.mask}`;
    if (L.kind === "enum") return `abi.dv.getUint32(p + ${off}, true)`;
    if (L.kind === "ptr") return `abi.dv.getUint32(p + ${off}, true)`;
    if (L.kind === "struct") return `read${pascal(L.struct)}(abi, p + ${off})`;
    if (L.kind === "array") {
      if (L.el.size === 1) return `Array.from(abi.u8.subarray(p + ${off}, p + ${off + L.size}))`;
      return `Array.from({ length: ${L.n} }, (_, i) => ${readExpr(L.el, `${off} + i * ${L.el.size}`, _name)})`;
    }
    return `0 /* unsupported ${L.kind} */`;
  }
  function writeStmt(L, off, name, ptr = "p", src = "v") {
    if (L.kind === "scalar" && L.bool) return `abi.dv.setUint32(${ptr} + ${off}, ${src}.${name} ? 1 : 0, true);`;
    if (L.kind === "scalar") return `abi.dv.${L.set}(${ptr} + ${off}, ${src}.${name}${L.endian ? ", true" : ""});`;
    if (L.kind === "bitfield") {
      // Members share one storage unit; OR each into the (zero-initialised) word in turn.
      const e = L.endian ? ", true" : "";
      const cur = `abi.dv.${L.get}(${ptr} + ${off}${e})`;
      return `abi.dv.${L.set}(${ptr} + ${off}, ${cur} | ((${src}.${name} & ${L.mask}) << ${L.shift})${e});`;
    }
    if (L.kind === "enum" || L.kind === "ptr") return `abi.dv.setUint32(${ptr} + ${off}, ${src}.${name}, true);`;
    return `/* unsupported ${L.kind} ${name} */`;
  }
}

// Hand-written symbol sets from types.ts (so generated files don't redefine them).
function handSymbols() {
  const src = fs.readFileSync(path.resolve("src/core/types.ts"), "utf8");
  const grab = (re) => new Set([...src.matchAll(re)].map((m) => m[1]));
  return {
    enums: grab(/export enum (\w+)/g),
    // `export const NAME = {` objects (e.g. DWRITE_FONT_AXIS_TAG) stand in for an enum but are
    // NOT a TS type, generated code must not redeclare or import them as a type.
    consts: grab(/export const ([A-Z][A-Z0-9_]+)\s*=\s*\{/g),
    ifaces: grab(/export interface (\w+)/g),
    fns: grab(/export function (\w+)/g),
    sizes: grab(/export const (\w+_SIZE)\b/g),
  };
}

// ---- base generation (clang -> slots/iids/model) ------------------------------------------
function runGen() {
  console.error("[gen] running clang...");
  const ast = dumpAst();
  console.error("[gen] parsing AST...");
  const model = buildModel(ast);
  model.sdk = SDK_VERSION;

  const guids = readGuids();
  for (const i of model.interfaces) {
    i.iid = guids.get(i.name) ?? null;
    if (!i.iid && i.methods.length) console.error(`[gen] WARN no IID for ${i.name}`);
  }

  const slotEnums = computeSlots(model); // also annotates model methods with .slot

  const SRC = path.resolve("src/core");
  fs.writeFileSync(path.join(SRC, "slots.g.ts"), emitSlots(slotEnums));
  fs.writeFileSync(path.join(SRC, "iids.g.ts"), emitIids(model));

  const orderedModel = {
    sdk: model.sdk,
    interfaces: model.interfaces,
    structs: model.structs,
    enums: model.enums,
  };
  fs.writeFileSync(
    path.join(import.meta.dirname, "dwrite-model.g.json"),
    JSON.stringify(orderedModel, null, 2) + "\n",
  );

  // enums + structs not already hand-written in types.ts. Suppress model enums that types.ts
  // owns as an `export enum` OR an `export const {...}` (DWRITE_FONT_AXIS_TAG).
  const hand = handSymbols();
  const suppress = new Set([...hand.enums, ...hand.consts]);
  const enums = emitEnums(model, suppress);
  fs.writeFileSync(path.join(SRC, "enums.g.ts"), enums.text);
  const structs = emitStructs(model, hand, enums.emitted);
  fs.writeFileSync(path.join(SRC, "structs.g.ts"), structs.text);

  console.error(
    `[gen] done: ${model.interfaces.length} interfaces, ` +
      `${enums.count} enums, ${structs.count} structs (+${structs.skipped} skipped) (sdk ${model.sdk})`,
  );
}

// ---- idiomatic class emitter --------------------------------------------------------------
const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);
// property name: strip a leading Get (keep Is/Has), lowercase first letter.
const propName = (name) => lowerFirst(name.replace(/^Get(?=[A-Z])/, ""));

// Map of wrappable class name -> import module, from this batch + already-written interfaces.
function knownClassMap(batchFamilies) {
  const map = new Map();
  const handFiles = new Set(); // class names that have a hand (non-generated) .ts
  const dir = path.resolve("src/interfaces");
  // Two passes so a hand `<Iface>.ts` (e.g. a thin convenience subclass) wins over its generated
  // `<Iface>.g.ts` base, external wraps should point to the full hand API, not the base.
  for (const gen of [true, false]) {
    for (const f of fs.readdirSync(dir)) {
      if (!/\.ts$/.test(f)) continue;
      if (/\.g\.ts$/.test(f) !== gen) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      for (const m of src.matchAll(/export class (\w+)/g)) {
        map.set(m[1], "./" + f.replace(/\.ts$/, ".js"));
        if (!gen) handFiles.add(m[1]);
      }
    }
  }
  // Batch families resolve to their (to-be-written) .g.ts, UNLESS a hand subclass owns the name.
  for (const fam of batchFamilies) if (!handFiles.has(fam)) map.set(fam, `./${fam}.g.js`);
  return map;
}

function runEmitClass(family, classMap = knownClassMap([family])) {
  const model = JSON.parse(
    fs.readFileSync(path.resolve("tools/dwrite-model.g.json"), "utf8"),
  );
  const slotEnums = computeSlots(model); // members now carry .method/.declIface

  // The version family (IDWriteFont, IDWriteFont1, ...) sorted ascending; most-derived last.
  const fam = model.interfaces
    .filter((i) => new RegExp(`^${family}\\d*$`).test(i.name))
    .sort((a, b) => (+(a.name.match(/\d+$/)?.[0] || 0)) - (+(b.name.match(/\d+$/)?.[0] || 0)));
  if (!fam.length) throw new Error(`no interface family "${family}" in the model`);
  const mostDerived = fam[fam.length - 1];
  const slotEnumName = `${mostDerived.name}Slot`;
  let members = slotEnums.find((e) => e.name === slotEnumName).members;

  const annPath = path.resolve(`tools/annotations/${family}.json`);
  const ann = fs.existsSync(annPath) ? JSON.parse(fs.readFileSync(annPath, "utf8")) : {};

  // Drop skipped members FIRST (so a manual annotation that picks a specific version overload, 
  // e.g. IDWriteFont keeps CreateFontFace3, skips the base, wins over the auto-collapse below),
  // then collapse version REDECLARATIONS: a derived interface re-declares a method with the same
  // name + params but a more-derived return/object type (IDWriteFontCollection::GetFontFamily ->
  // IDWriteFontFamily**, IDWriteFontCollection1::GetFontFamily -> IDWriteFontFamily1**). These are
  // covariant refinements, not real overloads. Keep ONLY the LEAST-derived slot: it's the base
  // method present on EVERY object of the family (the most-derived slot may not exist when a base
  // object is wrapped, e.g. a FontFamily downcast to IDWriteFontList has no FontList1 vtable),
  // and wrapClass already wraps the more-derived return as the base family. Signatures compare with
  // IDWrite interface version digits normalised away (IDWriteFontFamily** == IDWriteFontFamily2**)
  // but struct/enum versions kept (GetMetrics(METRICS*) vs GetMetrics(METRICS1*) stay distinct).
  members = members.filter((mem) => (ann[`${family}.${mem.key}`] || {}).kind !== "skip");
  {
    const normType = (t) => t.replace(/\b(IDWrite[A-Za-z]+?)\d+\b/g, "$1");
    const sig = (m) => `${m.name}(${m.params.map((p) => normType(p.type)).join(",")})`;
    const best = new Map();
    for (const mem of members) {
      const k = sig(mem.method);
      const prev = best.get(k);
      if (!prev || mem.slot < prev.slot) best.set(k, mem);
    }
    members = members.filter((mem) => best.get(sig(mem.method)) === mem);
  }

  const reg = buildRegistry(model);

  const valueImports = new Map(); // module -> Set(symbols)   regular import
  const typeImports = new Map(); //  module -> Set(symbols)   import type
  const addImport = (map, mod, sym) => {
    if (!map.has(mod)) map.set(mod, new Set());
    map.get(mod).add(sym);
  };
  // Resolve a wrap target to a usable class. A versioned interface we don't wrap individually
  // (IDWriteFontSet2, IDWriteFontList2) is safely wrapped as its base family, a derived COM
  // pointer is directly usable through the base vtable. Otherwise fall back to base `IUnknown`.
  const wrapClass = (cls) => {
    if (cls === family || classMap.has(cls)) return cls;
    const base = cls.replace(/\d+$/, "");
    if (base !== cls && (base === family || classMap.has(base))) return base;
    return "IUnknown";
  };
  const need = (cls) => {
    if (cls === family || cls === "IUnknown") return; // self / already imported
    addImport(valueImports, classMap.get(cls), cls);
  };

  // JS member names must be unique within the class. Same-named version overloads (e.g. two
  // CreateFontFace) get the version digits from their slot key appended (createFontFace1).
  const usedNames = new Set();
  const uniqName = (name, key) => {
    if (!usedNames.has(name)) { usedNames.add(name); return name; }
    const ver = (key.match(/\d+$/) || [""])[0];
    let n = ver ? `${name}${ver}` : `${name}_${key}`;
    while (usedNames.has(n)) n = `${name}_${key}`;
    usedNames.add(n);
    return n;
  };

  // Pair Get<X>()/Set<X>(scalar) into a get/set ACCESSOR (the accessor-convention the hand files
  // use: `format.textAlignment = x`). The getter must be a no-arg scalar/enum property; the setter
  // takes exactly one scalar/enum arg. The setter is emitted as part of the getter and skipped on
  // its own. Per-range layout setters (SetFontSize(size, range)) have >1 param so never pair.
  const scalarish = (k) => k === "scalar" || k === "enum" || k === "enum-number";
  const setterByName = new Map(); // X (from Set<X>) -> setter member
  for (const mem of members) {
    const mm = mem.method;
    if (/^Set[A-Z]/.test(mm.name) && mm.params.length === 1 && scalarish(reg.classify(mm.params[0].type).kind))
      setterByName.set(mm.name.slice(3), mem);
  }
  const accessorSetter = new Map(); // getter mem.key -> setter member
  const pairedSetterKeys = new Set();
  for (const mem of members) {
    const mm = mem.method;
    if (!/^Get[A-Z]/.test(mm.name) || mm.params.length !== 0 || !mm.directReturn || mm.ret === "void") continue;
    if (!scalarish(reg.classify(mm.ret).kind)) continue;
    const setter = setterByName.get(mm.name.slice(3));
    if (!setter || pairedSetterKeys.has(setter.key)) continue;
    accessorSetter.set(mem.key, setter);
    pairedSetterKeys.add(setter.key);
  }
  // The `set name(v: ts)` half of an accessor pair (ts is the getter's TS type).
  function emitSetAccessor(name, ts, setterMem) {
    const sm = setterMem.method;
    const c = reg.classify(sm.params[0].type);
    const arg = c.prim && c.prim.bool ? "v ? 1 : 0" : "v";
    const call = `this.invoke(Slot.${setterMem.key}, ${arg})`;
    const body = sm.ret === "HRESULT" ? `checkHr(${call}, "${sm.name}");` : `${call};`;
    return `  set ${name}(v: ${ts}) { ${body} }`;
  }

  const methodsOut = [];
  let skippedMethods = 0;
  for (const mem of members) {
    const a = ann[`${family}.${mem.key}`] || {};
    if (a.kind === "skip") continue;
    if (pairedSetterKeys.has(mem.key) && a.kind !== "method") continue; // emitted as a set accessor
    try {
      methodsOut.push(emitMethod(mem, a));
    } catch (e) {
      // Breadth-robustness: a method we can't lower is skipped (with a breadcrumb), not fatal.
      console.error(`[gen]   skip ${family}.${mem.key}: ${e.message}`);
      methodsOut.push(`  // [gen] skipped ${mem.key}: ${e.message}`);
      skippedMethods++;
    }
  }

  function emitMethod(mem, a) {
    const m = mem.method;
    const slotRef = `Slot.${mem.key}`;
    const ret = reg.classify(m.ret);
    const directReturn = m.directReturn && m.ret !== "void";

    // ---- decide property vs method ----
    const isScalarRet =
      ret.kind === "scalar" || ret.kind === "enum" || ret.kind === "enum-number";
    const wantProperty =
      a.kind === "property" ||
      (a.kind !== "method" && directReturn && m.params.length === 0 && isScalarRet);

    // ---- classify params ---- (imports are collected per-case below, so a `wrap` override
    // doesn't drag in the original, possibly-unwrapped, interface type)
    const ps = m.params.map((p) => ({ ...p, cls: reg.classify(p.type) }));

    if (wantProperty) {
      const name = uniqName(a.name || propName(m.name), mem.key);
      const { ts, expr } = scalarReturn(ret, slotRef);
      const getter = `  get ${name}(): ${ts} { return ${expr}; }`;
      const setter = accessorSetter.get(mem.key);
      return setter ? `${getter}\n${emitSetAccessor(name, ts, setter)}` : getter;
    }

    // method
    const name = uniqName(a.name || lowerFirst(m.name), mem.key);

    // array-with-count out pattern: a non-const out-array sized by a capacity scalar, plus a
    // trailing UINT32* that receives the ACTUAL count. The capacity scalar and the array can sit in
    // either order, `(UINT32 maxCount, T* outArray, UINT32* actualCount)` (GetGlyphs-style) or
    // `(T* outArray, UINT32 maxCount, UINT32* actualCount)` (GetClusterMetrics/GetLineMetrics-style).
    // Two-call idiom: query the count with a zero capacity / null buffer, then allocate and fill, so
    // DWrite never writes past our allocation (it would otherwise overflow the single-element buffer
    // a naive out-struct lowering allocates). The actual count is the array length (no JS count arg).
    if (a.kind !== "method-plain" && ps.length === 3) {
      const arrIdx = ps.findIndex((p) => p.cls.kind === "out-struct" || p.cls.kind === "out-scalar");
      const capIdx = ps.findIndex((p) => p.cls.kind === "scalar" && /count|size|length|max/i.test(p.name || ""));
      const actIdx = ps.findIndex((p, i) => i !== arrIdx && p.cls.kind === "out-scalar" && /count|actual/i.test(p.name || ""));
      if (arrIdx >= 0 && capIdx >= 0 && actIdx >= 0 && new Set([arrIdx, capIdx, actIdx]).size === 3) {
        const arr = ps[arrIdx].cls;
        let elemTs, readElem, size;
        if (arr.kind === "out-struct" && arr.reader && arr.size) {
          elemTs = arr.struct; collectImport(arr.reader); collectImport(arr.size); collectTypeImport(arr.struct);
          readElem = `${arr.reader}(this.abi, buf + i * ${arr.size})`; size = arr.size;
        } else {
          elemTs = "number";
          readElem = `this.abi.readU32(buf + i * 4) >>> 0`; size = "4";
        }
        // Invoke args follow the C signature order; the array buffer and capacity slot into their
        // own positions (0 / null on the query call, buf / n on the fill call).
        const argsWith = (bufExpr, capExpr) => {
          const a3 = [];
          a3[arrIdx] = bufExpr; a3[capIdx] = capExpr; a3[actIdx] = "actual";
          return a3.join(", ");
        };
        return [
          `  ${name}(): ${elemTs}[] {`,
          `    using s = this.abi.scope();`,
          `    const actual = s.allocZeroed(4);`,
          `    this.invoke(${slotRef}, ${argsWith("0", "0")}); // query count (buffer-too-small expected)`,
          `    const n = this.abi.readU32(actual) >>> 0;`,
          `    if (n === 0) return [];`,
          `    const buf = s.allocZeroed(n * ${size});`,
          `    checkHr(this.invoke(${slotRef}, ${argsWith("buf", "n")}), "${m.name}");`,
          `    return Array.from({ length: n }, (_, i) => ${readElem});`,
          `  }`,
        ].join("\n");
      }
    }

    // out-array: (T* outArray, UINT32 count). The element count comes from EITHER a sibling
    // Get<Base>Count() (count hidden from the JS signature) OR the caller (when the reader is
    // count-batched and no sibling exists, e.g. GetDefaultFontAxisValues). Two-call idiom for the
    // sibling case; single call sized by the param otherwise.
    if (a.kind !== "method-plain" && ps.length === 2 &&
        (ps[0].cls.kind === "out-struct" || ps[0].cls.kind === "out-scalar") &&
        ps[1].cls.kind === "scalar" && /count|size|length/i.test(ps[1].name)) {
      const arr = ps[0].cls;
      const sibName = m.name.replace(/s$/, "") + "Count";
      const sib = members.find((x) => x.method.name === sibName &&
        x.method.directReturn && x.method.params.length === 0);
      // A sibling getter hides the count; otherwise the caller supplies it. Either way we need a
      // way to read n elements: a struct reader (per-element or batched) or a scalar.
      if ((sib || arr.kind === "out-scalar" || arr.reader) && !(arr.kind === "out-struct" && !arr.reader)) {
        let elemTs, readAll, size;
        if (arr.kind === "out-struct" && arr.reader && arr.size) {
          elemTs = arr.struct; collectImport(arr.reader); collectImport(arr.size); collectTypeImport(arr.struct);
          size = arr.size;
          readAll = arr.readerBatched
            ? `${arr.reader}(this.abi, buf, n)`
            : `Array.from({ length: n }, (_, i) => ${arr.reader}(this.abi, buf + i * ${size}))`;
        } else {
          elemTs = arr.ts || "number";
          if (arr.ts) collectImport(arr.ts);
          size = (arr.prim && arr.prim.size) || 4;
          readAll = `Array.from({ length: n }, (_, i) => this.abi.readU32(buf + i * ${size}) >>> 0)`;
        }
        const head = sib
          ? [`  ${name}(): ${elemTs}[] {`, `    const n = this.invoke(Slot.${sib.key}) >>> 0;`]
          : [`  ${name}(${ps[1].name}: number): ${elemTs}[] {`, `    const n = ${ps[1].name} >>> 0;`];
        return [
          ...head,
          `    if (n === 0) return [];`,
          `    using s = this.abi.scope();`,
          `    const buf = s.allocZeroed(n * ${size});`,
          `    checkHr(this.invoke(${slotRef}, buf, n), "${m.name}");`,
          `    return ${readAll};`,
          `  }`,
        ].join("\n");
      }
    }

    // out-string buffer pattern: (...lead, WCHAR* buffer, UINT32 size) paired with a sibling
    // <Method>Length(...lead, UINT32* length). Two-call: query length, alloc, fill, decode.
    const bufIdx = ps.findIndex((p) => p.cls.kind === "out-string");
    if (bufIdx >= 0) {
      // The length sibling is usually `<Method>Length`, but some insert "Length" mid-name
      // (GetFilePathFromKey -> GetFilePathLengthFromKey). Match either shape.
      const sib = members.find((x) => x.method.name === `${m.name}Length` ||
        x.method.name.replace("Length", "") === m.name);
      const sizeP = ps[bufIdx + 1];
      const lead = ps.slice(0, bufIdx);
      const leadOk = lead.every((p) => ["scalar", "enum", "enum-number"].includes(p.cls.kind));
      if (!sib || !sizeP || sizeP.cls.kind !== "scalar" || !leadOk)
        throw new Error(`out-string ${ps[bufIdx].name} without a paired ${m.name}Length / scalar lead`);
      lead.filter((p) => p.cls.kind === "enum").forEach((p) => collectImport(p.cls.ts));
      const leadParams = lead.map((p) => `${p.name}: ${p.cls.kind === "enum" ? p.cls.ts : "number"}`);
      const leadArgs = lead.map((p) => p.name).join(", ");
      const pfx = lead.length ? leadArgs + ", " : "";
      // The length sibling comes in two shapes: a direct-return getter `UINT32 GetXxxLength(...lead)`
      // (e.g. IDWriteTextFormat) vs. an HRESULT method with a trailing `UINT32* length` out-param
      // (e.g. IDWriteTextLayout / IDWriteLocalizedStrings). Reading the former through an out-pointer
      // yields 0, under-allocs the buffer, and DWrite returns E_NOT_SUFFICIENT_BUFFER (0x8007007A).
      const lenLines = sib.method.directReturn
        ? [`    const len = this.invoke(Slot.${sib.key}${lead.length ? `, ${leadArgs}` : ""}) >>> 0;`]
        : [
            `    const lenP = s.allocZeroed(4);`,
            `    checkHr(this.invoke(Slot.${sib.key}, ${pfx}lenP), "${sib.method.name}");`,
            `    const len = this.abi.readU32(lenP);`,
          ];
      return [
        `  ${name}(${leadParams.join(", ")}): string {`,
        `    using s = this.abi.scope();`,
        ...lenLines,
        `    const buf = s.allocZeroed((len + 1) * 2);`,
        `    checkHr(this.invoke(${slotRef}, ${pfx}buf, len + 1), "${m.name}");`,
        `    return this.abi.readWStringLen(buf, len);`,
        `  }`,
      ].join("\n");
    }

    const jsParams = [];
    const pre = [];
    // Invoke args are filled POSITIONALLY (slot[i] for param i) so the ABI call order always
    // matches the C signature even when a count param precedes its array. Each C param maps to
    // exactly one ABI arg; nulls (none yet) are filtered out at the end.
    const slots = new Array(ps.length).fill(null);
    const outs = []; // { name, valueExpr, tsType }
    let needScope = false;

    // Pre-pass: pair each input array / string with its count param (following preferred, else
    // preceding). A paired count is derived from `.length` and dropped from the JS signature.
    const isCount = (q) => q && q.cls.kind === "scalar" && /count|length|size/i.test(q.name || "");
    const countOf = new Map();      // arrayIdx -> countIdx | undefined
    const countConsumed = new Map(); // countIdx -> the array/string param it sizes
    for (let i = 0; i < ps.length; i++) {
      const k = ps[i].cls.kind;
      if (k !== "in-array" && k !== "in-string") continue;
      let ci;
      if (isCount(ps[i + 1]) && !countConsumed.has(i + 1)) ci = i + 1;
      else if (k === "in-array" && isCount(ps[i - 1]) && !countConsumed.has(i - 1)) ci = i - 1;
      countOf.set(i, ci);
      if (ci !== undefined) countConsumed.set(ci, ps[i]);
    }

    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const c = p.cls;
      // A count param sized from a paired array/string: derive from `.length`, no JS param.
      if (countConsumed.has(i)) { slots[i] = `${countConsumed.get(i).name}.length`; continue; }
      switch (c.kind) {
        case "scalar":
        case "enum":
        case "enum-number": {
          const tsType = c.kind === "enum" ? c.ts : (c.prim?.ts || "number");
          if (c.kind === "enum") collectImport(c.ts);
          jsParams.push(`${p.name}: ${tsType}`);
          // BOOL by value surfaces as a JS boolean; the ABI wants 0/1.
          slots[i] = (c.prim && c.prim.bool) ? `${p.name} ? 1 : 0` : p.name;
          break;
        }
        case "in-array": {
          const ci = countOf.get(i);
          needScope = true;
          if (c.elemKind === "struct") {
            collectTypeImport(c.struct);
            if (ci === undefined) {
              // No count param -> a single by-ref const struct input (e.g. const DWRITE_MATRIX*).
              if (!c.writer) throw new Error(`in-array of struct ${c.struct} needs a writer`);
              collectImport(c.writer);
              const arg = c.writerBatched ? `${c.writer}(this.abi, s, [${p.name}])` : `${c.writer}(this.abi, s, ${p.name})`;
              pre.push(`const ${p.name}Ptr = ${arg};`);
              jsParams.push(`${p.name}: ${c.struct}`);
            } else {
              // True input array -> needs a batched writer (a single-element writer can't lay out n).
              if (!c.writerArray) throw new Error(`in-array of struct ${c.struct} needs a batched writer`);
              collectImport(c.writerArray);
              pre.push(`const ${p.name}Ptr = ${c.writerArray}(this.abi, s, ${p.name});`);
              jsParams.push(`${p.name}: ${c.struct}[]`);
            }
            slots[i] = `${p.name}Ptr`;
            break;
          }
          // ci === undefined: no count param is paired with this array (it sits non-adjacent in the
          // signature, e.g. clusterMap...textLength). Still lower it as a number[]; the count param
          // stays a normal scalar arg the caller passes alongside.
          const tsEl = c.ts || c.prim.ts;
          if (c.ts) collectImport(c.ts);
          const sz = c.prim.size;
          jsParams.push(`${p.name}: ${tsEl}[]`);
          pre.push(`const ${p.name}Ptr = s.allocZeroed(${p.name}.length * ${sz});`);
          pre.push(`${p.name}.forEach((v, i) => this.abi.${c.prim.write}(${p.name}Ptr + i * ${sz}, v));`);
          slots[i] = `${p.name}Ptr`;
          break;
        }
        case "in-string": {
          needScope = true;
          jsParams.push(`${p.name}: string`);
          slots[i] = `s.allocWString(${p.name})`;
          break;
        }
        case "in-object": {
          const cls = wrapClass(c.cls);
          need(cls);
          jsParams.push(`${p.name}: ${cls}`);
          slots[i] = `${p.name}.ptr`;
          break;
        }
        case "in-struct": {
          if (!c.writer || !c.size) throw new Error(`no writer for by-value struct ${c.struct}`);
          needScope = true;
          collectImport(c.writer); collectImport(c.size); collectTypeImport(c.struct);
          pre.push(`const ${p.name}Ptr = ${c.writer}(this.abi, s, ${p.name});`);
          slots[i] = `${p.name}Ptr`;
          jsParams.push(`${p.name}: ${c.struct}`);
          break;
        }
        case "out-object": {
          needScope = true;
          const cls = wrapClass(a.wrap || c.cls);
          need(cls);
          pre.push(`const ${p.name} = s.out();`);
          slots[i] = p.name;
          const wrap = cls === "IUnknown"
            ? `new IUnknown(this.abi, this.abi.readPtr(${p.name}))`
            : `${cls}.from(this.abi, this.abi.readPtr(${p.name}))`;
          outs.push({ name: p.name, valueExpr: wrap, tsType: cls, isObj: true });
          break;
        }
        case "out-struct": {
          if (!c.reader || !c.size) throw new Error(`no reader for out struct ${c.struct}`);
          needScope = true;
          collectImport(c.reader); collectImport(c.size); collectTypeImport(c.struct);
          pre.push(`const ${p.name} = s.allocZeroed(${c.size});`);
          slots[i] = p.name;
          outs.push({ name: p.name, valueExpr: `${c.reader}(this.abi, ${p.name})`, tsType: c.struct });
          break;
        }
        case "out-scalar": {
          needScope = true;
          // Read back honoring the element primitive: a FLOAT* out must be readF32 (reading it as
          // U32 reinterprets the bits), a signed INT32* readI32, a 64-bit type readU64 (8 bytes).
          // Enum/handle/BOOL outs stay U32 (BOOL is refined to a boolean in the post-pass below).
          const sz = (c.prim && c.prim.size) || 4;
          pre.push(`const ${p.name} = s.allocZeroed(${sz});`);
          slots[i] = p.name;
          const tsType = c.ts || (c.prim ? c.prim.ts : "number");
          if (c.ts) collectImport(c.ts);
          let read;
          if (c.prim && c.prim.float) read = `this.abi.readF32(${p.name})`;
          else if (c.prim && c.prim.bits64) read = `this.abi.readU64(${p.name})`;
          else if (c.prim && c.prim.read === "readI32") read = `this.abi.readI32(${p.name})`;
          else read = `this.abi.readU32(${p.name}) >>> 0`;
          outs.push({ name: p.name, valueExpr: read, tsType });
          break;
        }
        default:
          throw new Error(`unsupported param ${p.name}: ${p.type} (${c.kind})`);
      }
    }
    const invokeArgs = slots.filter((x) => x !== null);

    // BOOL* out is classified as out-scalar with prim.bool; refine its read.
    for (let i = 0; i < ps.length; i++) {
      const c = ps[i].cls;
      if (c.kind === "out-scalar" && c.prim && c.prim.bool) {
        const o = outs.find((x) => x.name === ps[i].name);
        o.valueExpr = `(this.abi.readU32(${ps[i].name}) & 1) !== 0`;
        o.tsType = "boolean";
      }
    }

    // ---- assemble body ----
    const body = [];
    if (needScope) body.push(`using s = this.abi.scope();`);
    body.push(...pre);

    const call = `this.invoke(${slotRef}${invokeArgs.length ? ", " + invokeArgs.join(", ") : ""})`;

    // return type + return statement
    let retType, retStmt;

    // special-case: one out-object + one out-bool named "exists" -> nullable object
    const existsOut = outs.find((o) => o.tsType === "boolean" && /exists/i.test(o.name));
    const objOut = outs.find((o) => o.isObj);
    if (existsOut && objOut && outs.length === 2) {
      retType = `${objOut.tsType} | null`;
      body.push(`${m.ret === "HRESULT" ? `checkHr(${call}, "${m.name}");` : `${call};`}`);
      retStmt = `return (${existsOut.valueExpr}) ? ${objOut.valueExpr} : null;`;
    } else if (directReturn && outs.length === 0) {
      const { ts, expr } = scalarReturn(ret, slotRef, invokeArgs);
      retType = ts;
      retStmt = `return ${expr};`;
    } else {
      if (m.ret === "HRESULT") body.push(`checkHr(${call}, "${m.name}");`);
      else body.push(`${call};`);
      if (outs.length === 0) { retType = "void"; retStmt = ""; }
      else if (outs.length === 1) { retType = outs[0].tsType; retStmt = `return ${outs[0].valueExpr};`; }
      else {
        retType = `{ ${outs.map((o) => `${o.name}: ${o.tsType}`).join("; ")} }`;
        retStmt = `return { ${outs.map((o) => `${o.name}: ${o.valueExpr}`).join(", ")} };`;
      }
    }
    if (retStmt) body.push(retStmt);

    const sig = `  ${name}(${jsParams.join(", ")}): ${retType} {`;
    return `${sig}\n${body.map((l) => "    " + l).join("\n")}\n  }`;
  }

  // scalar/enum/bool return expression for a direct-return getter/method.
  function scalarReturn(ret, slotRef, invokeArgs) {
    const args = invokeArgs && invokeArgs.length ? ", " + invokeArgs.join(", ") : "";
    const call = `this.invoke(${slotRef}${args})`;
    if (ret.kind === "scalar" && ret.prim.bool) return { ts: "boolean", expr: `(${call} & 1) !== 0` };
    if (ret.kind === "scalar" && ret.prim.float) return { ts: "number", expr: call };
    if (ret.kind === "scalar") return { ts: "number", expr: ret.prim.umask ? `${call} ${ret.prim.umask}` : call };
    if (ret.kind === "enum") { collectImport(ret.ts); return { ts: ret.ts, expr: `${call} >>> 0` }; }
    return { ts: "number", expr: `${call} >>> 0` }; // enum-number / unknown
  }

  function collectImport(sym) {
    if (!sym) return;
    if (/^IDWrite/.test(sym)) { need(sym); return; }
    addImport(valueImports, reg.moduleOf(sym), sym);
  }
  function collectTypeImport(sym) {
    addImport(typeImports, reg.moduleOf(sym), sym);
  }

  // ---- header ----
  const header = [];
  header.push(BANNER);
  header.push(`import { IUnknown, checkHr } from "../core/com.js";`);
  header.push(`import type { Abi } from "../core/abi.js";`);
  if (methodsOut.some((m) => /\bSlot\./.test(m)))
    header.push(`import { ${slotEnumName} as Slot } from "../core/slots.g.js";`);
  for (const [mod, syms] of [...valueImports].sort())
    header.push(`import { ${[...syms].sort().join(", ")} } from "${mod}";`);
  for (const [mod, syms] of [...typeImports].sort())
    header.push(`import type { ${[...syms].sort().join(", ")} } from "${mod}";`);

  const cls = [
    ``,
    `export class ${family} extends IUnknown {`,
    `  static from(abi: Abi, ptr: number): ${family} {`,
    `    return new this(abi, ptr);`, // `new this` so a hand subclass over this base constructs correctly
    `  }`,
    ``,
    methodsOut.join("\n\n"),
    `}`,
    ``,
  ];

  const out = header.join("\n") + "\n" + cls.join("\n");
  const dest = path.resolve(`src/interfaces/${family}.g.ts`);
  fs.writeFileSync(dest, out);
  const real = methodsOut.filter((m) => !m.startsWith("  // [gen]")).length;
  console.error(`[gen] emitted ${family}.g.ts (${real} members${skippedMethods ? `, ${skippedMethods} skipped` : ""})`);
}

// Emit several families in one batch, so cross-references between them resolve.
function runEmitClasses(families) {
  const classMap = knownClassMap(families);
  for (const f of families) runEmitClass(f, classMap);
}

// ---- CLI ----------------------------------------------------------------------------------
const emitFamily = getArg("--emit-class");
if (emitFamily) runEmitClasses(emitFamily.split(",").map((s) => s.trim()).filter(Boolean));
else runGen();
