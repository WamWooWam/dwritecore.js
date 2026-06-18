import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { TextRendererBase } from "../src/util/text-renderer.js";
import { callMethod } from "../src/core/com.js";
import { IID_IDWriteTextRenderer, IID_IUnknown, IID_IDWriteFactory } from "../src/core/iids.js";
import { Guid } from "../src/core/guid.js";
import type { Abi } from "../src/core/abi.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
void factory;

// Minimal concrete IDWriteTextRenderer for exercising the ComObject vtable plumbing (QI, refcounts,
// shared per-interface trampolines, per-instance routing). Carries one piece of per-instance state -
// pixelsPerDip - so dispatch routing can be observed.
class Probe extends TextRendererBase {
  ppd = 1;
  constructor(abi: Abi) { super(abi); }
  protected override getPixelsPerDip(): number { return this.ppd; }
}

const QI = 0, AddRef = 1, Release = 2;

function qi(ptr: number, iid: Guid): { hr: number; out: number } {
  using s = abi.scope();
  const out = s.out();
  const hr = callMethod(abi, ptr, QI, iid.pin(abi), out);
  return { hr, out: abi.readU32(out) };
}

// --- QI + refcount semantics --------------------------------------------------------
const r = new Probe(abi);

const okText = qi(r.ptr, IID_IDWriteTextRenderer);
const okUnk = qi(r.ptr, IID_IUnknown);
const bad = qi(r.ptr, IID_IDWriteFactory); // not implemented -> E_NOINTERFACE
console.log("QI(TextRenderer):", okText.hr === 0 && okText.out === r.ptr ? "S_OK -> self" : "FAIL");
console.log("QI(IUnknown):    ", okUnk.hr === 0 && okUnk.out === r.ptr ? "S_OK -> self" : "FAIL");
console.log("QI(Factory):     ", (bad.hr >>> 0) === 0x80004002 && bad.out === 0 ? "E_NOINTERFACE -> null" : "FAIL");

// Each successful QI did an implicit AddRef; balance them, then AddRef/Release round-trip.
callMethod(abi, r.ptr, Release); // undo QI(TextRenderer)
callMethod(abi, r.ptr, Release); // undo QI(IUnknown)
const afterAdd = callMethod(abi, r.ptr, AddRef);
const afterRel = callMethod(abi, r.ptr, Release);
console.log(`AddRef -> ${afterAdd}, Release -> ${afterRel} (expect 2 then 1)`);

r[Symbol.dispose](); // owner ref -> 0 -> cleanup

// --- shared per-interface vtable ----------------------------------------------------
// The vtable is allocated ONCE per interface (not per instance): the first TextRenderer grew
// the table; every later renderer reuses the shared trampoline slots, routed by `this`. So the
// table stays flat no matter how many renderers are created OR live concurrently.
const lenAfterFirst = abi.table.length;
for (let i = 0; i < 50; i++) {
  const t = new Probe(abi);
  t[Symbol.dispose]();
}
const lenAfterMany = abi.table.length;
console.log(`table: ${lenAfterFirst} after 1st -> ${lenAfterMany} after +50 cycles`);
console.log(lenAfterFirst === lenAfterMany ? "SHARED VTABLE (table flat)" : "table GREW, sharing broken");

// Many concurrent instances must NOT grow the table, they all share the one interface vtable.
const live = Array.from({ length: 8 }, () => new Probe(abi));
const lenManyLive = abi.table.length;
for (const t of live) t[Symbol.dispose]();
console.log(`8 concurrent live -> table ${lenManyLive} (still flat: ${lenManyLive === lenAfterFirst})`);

// --- per-instance dispatch routing --------------------------------------------------
// Distinct instances share one vtable, so a callback must route to the right object by thisPtr.
// GetPixelsPerDip (slot 5) reads per-instance state, so two renderers with different pixelsPerDip
// must each answer their own value when called through the SAME shared vtable slot.
const GetPixelsPerDip = 5;
function pixelsPerDip(ptr: number): number {
  using s = abi.scope();
  const out = s.out();
  callMethod(abi, ptr, GetPixelsPerDip, 0, out);
  return abi.readF32(out);
}
const r1 = new Probe(abi);
const r2 = new Probe(abi);
r1.ppd = 2;
r2.ppd = 3;
const p1 = pixelsPerDip(r1.ptr), p2 = pixelsPerDip(r2.ptr);
console.log(`routing: r1 -> ${p1} (expect 2), r2 -> ${p2} (expect 3) ${p1 === 2 && p2 === 3 ? "OK" : "FAIL"}`);
r1[Symbol.dispose](); r2[Symbol.dispose]();
