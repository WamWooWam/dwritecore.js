// Surgically add export-section entries to linelayout-core.wasm so JavaScript can
// reach DirectWriteCore: the indirect function table, the allocator, and the factory
// entry point. Everything else (every COM method) is then reachable from JS by reading
// vtables out of linear memory and calling through the exported table.
//
// The binary has no embedded `name` section, so functions are resolved by their Ghidra
// entry address: image base is 0x80000000 and the `.module` block maps 1:1 onto the
// file, so (ghidraAddr - 0x80000000) is the file offset of a function body's first byte
// (the byte right after its size LEB). We match that against the code section.
//
// Usage: node tools/patch-exports.mjs [in.wasm] [out.wasm]

import fs from "node:fs";

const IN = process.argv[2] ?? "./old/linelayout-core.wasm";
const OUT = process.argv[3] ?? "./linelayout-core.patched.wasm";
const IMAGE_BASE = 0x80000000;

// Exports to add. Function targets are given by Ghidra entry address; table/memory by index.
const FUNC_EXPORTS = [
  { name: "malloc", addr: 0x802416ba },
  { name: "free", addr: 0x80241747 },
  { name: "DWriteCreateFactory", addr: 0x800aab17 },
];
const TABLE_EXPORTS = [{ name: "__indirect_function_table", index: 0 }];

const EXPORT_KIND = { func: 0x00, table: 0x01, mem: 0x02, global: 0x03 };

const buf = fs.readFileSync(IN);

// --- minimal LEB128 reader bound to a cursor object ---
function readU32Leb(b, c) {
  let r = 0, s = 0, byte;
  do { byte = b[c.o++]; r |= (byte & 0x7f) << s; s += 7; } while (byte & 0x80);
  return r >>> 0;
}
function encodeU32Leb(v) {
  const out = [];
  do { let byte = v & 0x7f; v >>>= 7; if (v) byte |= 0x80; out.push(byte); } while (v);
  return out;
}
function encodeName(name) {
  const bytes = Buffer.from(name, "utf8");
  return Buffer.concat([Buffer.from(encodeU32Leb(bytes.length)), bytes]);
}

// --- parse top-level sections ---
if (buf.readUInt32LE(0) !== 0x6d736100) throw new Error("not a wasm module");
const c = { o: 8 };
const sections = [];
while (c.o < buf.length) {
  const id = buf[c.o++];
  const size = readU32Leb(buf, c);
  const contentStart = c.o;
  sections.push({ id, contentStart, size });
  c.o = contentStart + size;
}

// --- count imported functions (they occupy the low function-index space) ---
let importedFuncs = 0;
const importSec = sections.find((s) => s.id === 2);
if (importSec) {
  c.o = importSec.contentStart;
  const n = readU32Leb(buf, c);
  for (let i = 0; i < n; i++) {
    const mlen = readU32Leb(buf, c); c.o += mlen; // module name
    const flen = readU32Leb(buf, c); c.o += flen; // field name
    const kind = buf[c.o++];
    if (kind === 0x00) { readU32Leb(buf, c); importedFuncs++; }       // func: typeidx
    else if (kind === 0x01) { c.o++; const f = buf[c.o++]; readU32Leb(buf, c); if (f) readU32Leb(buf, c); } // table
    else if (kind === 0x02) { const f = buf[c.o++]; readU32Leb(buf, c); if (f) readU32Leb(buf, c); }        // mem
    else if (kind === 0x03) { c.o += 2; }                              // global: valtype + mut
    else throw new Error("unknown import kind " + kind);
  }
}

// --- enumerate code-section function bodies -> file-offset ranges per index ---
const codeSec = sections.find((s) => s.id === 10);
if (!codeSec) throw new Error("no code section");
c.o = codeSec.contentStart;
const bodyCount = readU32Leb(buf, c);
const bodies = []; // { index, codeStart, end }
for (let i = 0; i < bodyCount; i++) {
  const bsz = readU32Leb(buf, c);
  const codeStart = c.o;
  bodies.push({ index: importedFuncs + i, codeStart, end: codeStart + bsz });
  c.o = codeStart + bsz;
}

function funcIndexForAddr(addr) {
  const off = addr - IMAGE_BASE;
  const b = bodies.find((b) => off >= b.codeStart && off < b.end);
  if (!b) throw new Error(`no function body at addr 0x${addr.toString(16)} (off 0x${off.toString(16)})`);
  if (b.codeStart !== off) {
    console.warn(`warn: addr 0x${addr.toString(16)} is inside func ${b.index} but not at its entry (codeStart 0x${b.codeStart.toString(16)})`);
  }
  return b.index;
}

// --- raise the table's max so JS can table.grow() at runtime (for callback thunks) ---
// In-place edit: only valid while the new max LEB is the same byte length as the old.
const TABLE_HEADROOM = 1024;
const tableSec = sections.find((s) => s.id === 4);
if (tableSec) {
  const tc = { o: tableSec.contentStart };
  readU32Leb(buf, tc);     // table count
  tc.o++;                  // reftype (0x70 funcref)
  const flags = buf[tc.o++];
  const min = readU32Leb(buf, tc);
  if (flags & 1) {
    const maxPos = tc.o;
    const oldMax = readU32Leb(buf, tc);
    const oldLen = tc.o - maxPos;
    const enc = encodeU32Leb(min + TABLE_HEADROOM);
    if (enc.length === oldLen) {
      enc.forEach((b, i) => { buf[maxPos + i] = b; });
      console.log(`table max ${oldMax} -> ${min + TABLE_HEADROOM} (growable)`);
    } else {
      console.warn(`table max LEB length would change (${oldLen}->${enc.length}); skipping`);
    }
  } else {
    console.warn("table has no max; skipping headroom patch");
  }
}

// --- parse existing export entries (count + names, for dedupe) ---
const exportSec = sections.find((s) => s.id === 7);
if (!exportSec) throw new Error("no export section");
c.o = exportSec.contentStart;
const existingCount = readU32Leb(buf, c);
const afterCountOffset = c.o; // start of the entry list, after the count LEB
const existingNames = new Set();
for (let i = 0; i < existingCount; i++) {
  const nlen = readU32Leb(buf, c);
  existingNames.add(buf.toString("utf8", c.o, c.o + nlen));
  c.o += nlen;
  c.o++;                 // kind
  readU32Leb(buf, c);    // index
}
const entriesEndOld = exportSec.contentStart + exportSec.size;
const existingEntriesBytes = buf.subarray(afterCountOffset, entriesEndOld); // raw bytes of all entries after the count

// --- build new entries ---
const newEntries = [];
let added = 0;
for (const e of TABLE_EXPORTS) {
  if (existingNames.has(e.name)) { console.log(`skip (exists): ${e.name}`); continue; }
  newEntries.push(Buffer.concat([encodeName(e.name), Buffer.from([EXPORT_KIND.table]), Buffer.from(encodeU32Leb(e.index))]));
  console.log(`+ table  ${e.name} -> table ${e.index}`);
  added++;
}
for (const e of FUNC_EXPORTS) {
  if (existingNames.has(e.name)) { console.log(`skip (exists): ${e.name}`); continue; }
  const idx = funcIndexForAddr(e.addr);
  newEntries.push(Buffer.concat([encodeName(e.name), Buffer.from([EXPORT_KIND.func]), Buffer.from(encodeU32Leb(idx))]));
  console.log(`+ func   ${e.name} -> funcidx ${idx}`);
  added++;
}

if (added === 0) {
  console.log("nothing to add; writing copy");
  fs.writeFileSync(OUT, buf);
  process.exit(0);
}

// --- reassemble the export section ---
const newCount = existingCount + added;
const newContent = Buffer.concat([
  Buffer.from(encodeU32Leb(newCount)),
  existingEntriesBytes,
  ...newEntries,
]);
const newSectionHeader = Buffer.concat([
  Buffer.from([7]),
  Buffer.from(encodeU32Leb(newContent.length)),
]);

// --- reassemble the whole module: bytes before section header | new header+content | bytes after ---
// The export section header begins just before contentStart by the size of its size-LEB.
// Recompute the header start by re-encoding the original size length.
const origSizeLebLen = encodeU32Leb(exportSec.size).length;
const sectionHeaderStart = exportSec.contentStart - 1 - origSizeLebLen; // 1 for id byte
const before = buf.subarray(0, sectionHeaderStart);
const after = buf.subarray(entriesEndOld);
const out = Buffer.concat([before, newSectionHeader, newContent, after]);

fs.writeFileSync(OUT, out);
console.log(`\nwrote ${OUT} (${out.length} bytes, was ${buf.length}); exports ${existingCount} -> ${newCount}`);
