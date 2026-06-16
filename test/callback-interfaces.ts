// Exercises the JS-implemented callback-interface bases in ./util that have no reference impl:
// a real IDWriteTextAnalyzer::AnalyzeLineBreakpoints round-trip drives a TextAnalysisSourceBase
// (feeding a string) into a TextAnalysisSinkBase (collecting breakpoints), validating the
// descriptors, the source's pinned-string lifetime, and the hand-unpacked DWRITE_LINE_BREAKPOINT
// bitfield. FontFileLoaderBase / FontDownloadListenerBase get a QI + shared-vtable check (they
// need registration / remote fonts to run for real).
import { loadNode } from "../src/host/node.js";
import {
  DWriteCoreCreateFactory
} from "../src/index.js";
import {
  TextAnalysisSourceBase, TextAnalysisSinkBase,
  FontFileLoaderBase, FontDownloadListenerBase, type LineBreakpoint,
} from "../src/util/index.js"
import { callMethod } from "../src/core/com.js";
import { Guid } from "../src/core/guid.js";
import { DWRITE_BREAK_CONDITION } from "../src/core/enums.g.js";
import {
  IID_IUnknown, IID_IDWriteTextAnalysisSource, IID_IDWriteTextAnalysisSink,
  IID_IDWriteFontFileLoader, IID_IDWriteFontDownloadListener,
} from "../src/core/iids.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean) => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}`); ok ? pass++ : fail++; };

// --- QI + shared-vtable for the no-runtime interfaces -------------------------------------------
function qiSelf(ptr: number, iid: Guid): boolean {
  using s = abi.scope();
  const out = s.out();
  const hr = callMethod(abi, ptr, 0 /* QueryInterface */, iid.pin(abi), out);
  return hr === 0 && abi.readU32(out) === ptr;
}
function qiBad(ptr: number): boolean {
  using s = abi.scope();
  const out = s.out();
  const hr = callMethod(abi, ptr, 0, new Guid("00000000-0000-0000-0000-000000000001").pin(abi), out);
  return (hr >>> 0) === 0x80004002 && abi.readU32(out) === 0;
}

class NoopLoader extends FontFileLoaderBase { protected createStreamFromKey() { return null; } }
class NoopListener extends FontDownloadListenerBase { protected downloadCompleted() { } }

const lenBefore = abi.table.length;
{
  using l1 = new NoopLoader(abi);
  using l2 = new NoopLoader(abi); // second instance must reuse the shared vtable
  check("FontFileLoaderBase QI(self/IUnknown)", qiSelf(l1.ptr, IID_IDWriteFontFileLoader) && qiSelf(l1.ptr, IID_IUnknown));
  check("FontFileLoaderBase QI(bad)->E_NOINTERFACE", qiBad(l1.ptr));
  void l2;
}
{
  using d1 = new NoopListener(abi);
  check("FontDownloadListenerBase QI(self/IUnknown)", qiSelf(d1.ptr, IID_IDWriteFontDownloadListener) && qiSelf(d1.ptr, IID_IUnknown));
  check("FontDownloadListenerBase QI(bad)->E_NOINTERFACE", qiBad(d1.ptr));
}
// 3 interfaces × one shared vtable each (loader + listener here; source/sink below also share).
const grewBlocks = abi.table.length - lenBefore;
check(`shared vtable: 3 instances grew table by 2 interface blocks (got ${grewBlocks} slots)`, grewBlocks === 4 + 4);

// --- real analysis round-trip: source -> AnalyzeLineBreakpoints -> sink -------------------------
const TEXT = "Hello world, breaking.";

class StringSource extends TextAnalysisSourceBase {
  constructor(private readonly text: string) { super(abi); }
  protected override getTextAtPosition(p: number): string | null { return p < this.text.length ? this.text.slice(p) : null; }
  protected override getTextBeforePosition(p: number): string | null { return p > 0 && p <= this.text.length ? this.text.slice(0, p) : null; }
  protected override getLocaleName(p: number) { return { localeName: "en-us", textLength: this.text.length - p }; }
  protected override getNumberSubstitution(p: number) { return { numberSubstitution: null, textLength: this.text.length - p }; }
}

class CollectingSink extends TextAnalysisSinkBase {
  readonly breakpoints: LineBreakpoint[] = [];
  protected override setLineBreakpoints(pos: number, _len: number, bps: LineBreakpoint[]): void {
    this.breakpoints[pos] = bps[0]!; // bps covers [pos, pos+len); store per-position
    for (let i = 1; i < bps.length; i++) this.breakpoints[pos + i] = bps[i]!;
  }
}

// IDWriteFactory::CreateTextAnalyzer (slot 21) -> IDWriteTextAnalyzer; AnalyzeLineBreakpoints = 6.
let analyzer = 0;
{
  using s = abi.scope();
  const out = s.out();
  callMethod(abi, factory.ptr, 21, out);
  analyzer = abi.readU32(out);
}

using src = new StringSource(TEXT);
using sink = new CollectingSink(abi);
callMethod(abi, analyzer, 6, src.ptr, 0, TEXT.length, sink.ptr);

check(`sink received a breakpoint per character (${sink.breakpoints.filter(Boolean).length}/${TEXT.length})`,
  sink.breakpoints.filter(Boolean).length === TEXT.length);
const spaceIdx = TEXT.indexOf(" ");
check(`space @${spaceIdx} decoded isWhitespace=true`, sink.breakpoints[spaceIdx]?.isWhitespace === true);
check("letter 'H' @0 decoded isWhitespace=false", sink.breakpoints[0]?.isWhitespace === false);
check("break conditions in valid range 0..3", sink.breakpoints.filter(Boolean).every(b =>
  b.breakConditionBefore >= 0 && b.breakConditionBefore <= 3 && b.breakConditionAfter >= 0 && b.breakConditionAfter <= 3));
// A space permits a line break after it (DWRITE_BREAK_CONDITION.CAN_BREAK).
check(`break allowed after space @${spaceIdx} (CAN_BREAK)`, sink.breakpoints[spaceIdx]?.breakConditionAfter === DWRITE_BREAK_CONDITION.CAN_BREAK);

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"}, ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
