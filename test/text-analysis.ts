// In-depth tests for the JS-implemented text-analysis callback interfaces (TextAnalysisSourceBase /
// TextAnalysisSinkBase in ./util). Each test drives a real IDWriteTextAnalyzer analysis, Script,
// Bidi, LineBreakpoints, NumberSubstitution, against a JS source feeding text, and asserts the
// results DirectWrite writes back into the JS sink are correct and sensible (script itemization,
// Unicode bidi levels, line-break opportunities, the source block protocol). All expected values
// were captured from DirectWriteCore itself, then pinned to stable Unicode semantics.
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import {
  TextAnalysisSourceBase, TextAnalysisSinkBase,
  type LineBreakpoint, type LocaleRun, type NumberSubstitutionRun,
} from "../src/util/index.js";
import { callMethod } from "../src/core/com.js";
import { DWRITE_BREAK_CONDITION, DWRITE_NUMBER_SUBSTITUTION_METHOD } from "../src/core/enums.g.js";
import { DWRITE_READING_DIRECTION } from "../src/core/types.js";
import type { DWRITE_SCRIPT_ANALYSIS } from "../src/core/structs.g.js";
import { IDWriteNumberSubstitution } from "../src/interfaces/IDWriteNumberSubstitution.g.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail && !ok ? ` , ${detail}` : ""}`);
  ok ? pass++ : fail++;
};

// IDWriteFactory::CreateTextAnalyzer = slot 21. Analyzer methods: AnalyzeScript=3, AnalyzeBidi=4,
// AnalyzeNumberSubstitution=5, AnalyzeLineBreakpoints=6.
const analyzer = (() => {
  using s = abi.scope();
  const out = s.out();
  callMethod(abi, factory.ptr, 21, out);
  return abi.readU32(out);
})();
const AnalyzeScript = 3, AnalyzeBidi = 4, AnalyzeNumberSubstitution = 5, AnalyzeLineBreakpoints = 6;

// A configurable single- or multi-block text source. `chunk` splits the text into fixed-size
// blocks to exercise the GetTextAtPosition/GetTextBeforePosition block protocol (DWrite calls
// repeatedly, advancing by the returned length).
interface SourceOpts { rtl?: boolean; locale?: string; substitution?: IDWriteNumberSubstitution; chunk?: number }
class TextSource extends TextAnalysisSourceBase {
  constructor(private readonly text: string, private readonly opts: SourceOpts = {}) { super(abi); }
  private blockEnd(p: number): number {
    const c = this.opts.chunk ?? Infinity;
    return Math.min(this.text.length, p + c);
  }
  protected override getTextAtPosition(p: number): string | null {
    return p < this.text.length ? this.text.slice(p, this.blockEnd(p)) : null;
  }
  protected override getTextBeforePosition(p: number): string | null {
    if (p === 0 || p > this.text.length) return null;
    const start = this.opts.chunk ? Math.max(0, p - this.opts.chunk) : 0;
    return this.text.slice(start, p);
  }
  protected override get paragraphReadingDirection(): DWRITE_READING_DIRECTION {
    return this.opts.rtl ? DWRITE_READING_DIRECTION.RIGHT_TO_LEFT : DWRITE_READING_DIRECTION.LEFT_TO_RIGHT;
  }
  protected override getLocaleName(p: number): LocaleRun {
    return { localeName: this.opts.locale ?? "en-us", textLength: this.text.length - p };
  }
  protected override getNumberSubstitution(p: number): NumberSubstitutionRun {
    return { numberSubstitution: this.opts.substitution ?? null, textLength: this.text.length - p };
  }
}

interface Run { p: number; l: number }
class ScriptSink extends TextAnalysisSinkBase {
  readonly runs: (Run & DWRITE_SCRIPT_ANALYSIS)[] = [];
  protected override setScriptAnalysis(p: number, l: number, sa: DWRITE_SCRIPT_ANALYSIS): void { this.runs.push({ p, l, ...sa }); }
}
class BidiSink extends TextAnalysisSinkBase {
  readonly runs: (Run & { explicit: number; resolved: number })[] = [];
  protected override setBidiLevel(p: number, l: number, explicit: number, resolved: number): void { this.runs.push({ p, l, explicit, resolved }); }
}
class BreakSink extends TextAnalysisSinkBase {
  readonly bp: LineBreakpoint[] = [];
  protected override setLineBreakpoints(p: number, _l: number, bps: LineBreakpoint[]): void { bps.forEach((b, i) => { this.bp[p + i] = b; }); }
}
class NumberSink extends TextAnalysisSinkBase {
  readonly runs: (Run & { sub: IDWriteNumberSubstitution | null })[] = [];
  protected override setNumberSubstitution(p: number, l: number, sub: IDWriteNumberSubstitution | null): void { this.runs.push({ p, l, sub }); }
}

function run(slot: number, src: TextSource, sink: TextAnalysisSinkBase, len: number): void {
  callMethod(abi, analyzer, slot, src.ptr, 0, len, sink.ptr);
}

// Runs must tile [0, total) exactly: sorted, contiguous, no gaps or overlaps, covering everything.
function partitions(runs: Run[], total: number): boolean {
  if (runs.length === 0) return total === 0;
  const sorted = [...runs].sort((a, b) => a.p - b.p);
  if (sorted[0]!.p !== 0) return false;
  let next = 0;
  for (const r of sorted) { if (r.p !== next || r.l <= 0) return false; next += r.l; }
  return next === total;
}

// ============================================================ Script analysis
{
  console.log("\nAnalyzeScript:");
  const latin = "Hello world";
  using sL = new TextSource(latin);
  const skL = new ScriptSink(abi); run(AnalyzeScript, sL, skL, latin.length);
  check("Latin: single script run covering all text", skL.runs.length === 1 && skL.runs[0]!.p === 0 && skL.runs[0]!.l === latin.length);
  check("Latin: shapes = DEFAULT (0)", skL.runs.every(r => r.shapes === 0));
  const latinScript = skL.runs[0]!.script;

  const mixed = "Hi العربية"; // Latin "Hi " then Arabic
  using sM = new TextSource(mixed);
  const skM = new ScriptSink(abi); run(AnalyzeScript, sM, skM, mixed.length);
  check("Mixed: itemized into >1 script run", skM.runs.length >= 2, `got ${skM.runs.length}`);
  check("Mixed: runs partition the text", partitions(skM.runs, mixed.length));
  const arabicIdx = mixed.indexOf("ا");
  const arabicRun = skM.runs.find(r => r.p <= arabicIdx && arabicIdx < r.p + r.l)!;
  const latinRun = skM.runs.find(r => r.p === 0)!;
  check("Mixed: Latin run keeps the Latin script id", latinRun.script === latinScript);
  check("Mixed: Arabic run has a different script than Latin", arabicRun.script !== latinScript);

  using sH = new TextSource("שלום"); // Hebrew
  const skH = new ScriptSink(abi); run(AnalyzeScript, sH, skH, 4);
  check("Hebrew: distinct script from Latin and Arabic", skH.runs[0]!.script !== latinScript && skH.runs[0]!.script !== arabicRun.script);
}

// ============================================================ Bidi analysis
{
  console.log("\nAnalyzeBidi:");
  const isRTLChar = (c: string) => { const n = c.codePointAt(0)!; return (n >= 0x0590 && n <= 0x05ff) || (n >= 0x0600 && n <= 0x06ff); };
  const runIsRTL = (text: string, r: Run) => isRTLChar(text[r.p]!);

  const latin = "Hello world";
  using sL = new TextSource(latin);
  const bL = new BidiSink(abi); run(AnalyzeBidi, sL, bL, latin.length);
  check("Latin LTR: all resolved levels even (LTR)", bL.runs.every(r => r.resolved % 2 === 0));
  check("Latin LTR: base resolved level 0", bL.runs.every(r => r.resolved === 0));

  using sHe = new TextSource("שלום");
  const bHe = new BidiSink(abi); run(AnalyzeBidi, sHe, bHe, 4);
  check("Hebrew in LTR paragraph: resolved level odd (RTL)", bHe.runs.every(r => r.resolved % 2 === 1));

  const mixed = "Hi العربية 12"; // Latin, Arabic, European digits
  using sM = new TextSource(mixed);
  const bM = new BidiSink(abi); run(AnalyzeBidi, sM, bM, mixed.length);
  check("Mixed: bidi runs partition the text", partitions(bM.runs, mixed.length));
  check("Mixed: RTL runs odd level, LTR runs even level",
    bM.runs.every(r => runIsRTL(mixed, r) ? r.resolved % 2 === 1 : r.resolved % 2 === 0));

  using sR = new TextSource("مرحبا abc", { rtl: true }); // RTL paragraph, Latin embedded
  const bR = new BidiSink(abi); run(AnalyzeBidi, sR, bR, 9);
  check("RTL paragraph: explicit embedding level odd everywhere", bR.runs.every(r => r.explicit % 2 === 1));
  check("RTL paragraph: embedded Latin resolves even but > 0",
    bR.runs.filter(r => !runIsRTL("مرحبا abc", r)).every(r => r.resolved % 2 === 0 && r.resolved > 0));
}

// ============================================================ Line breakpoints
{
  console.log("\nAnalyzeLineBreakpoints:");
  const text = "ab cd\nef­gh"; // space@2, newline@5, soft hyphen@8
  using src = new TextSource(text);
  const sink = new BreakSink(abi); run(AnalyzeLineBreakpoints, src, sink, text.length);

  check("one breakpoint per character", sink.bp.filter(Boolean).length === text.length);
  check("space @2: whitespace, may break after", sink.bp[2]!.isWhitespace && sink.bp[2]!.breakConditionAfter === DWRITE_BREAK_CONDITION.CAN_BREAK);
  check("interior letter @1: must-not-break before", sink.bp[1]!.breakConditionBefore === DWRITE_BREAK_CONDITION.MAY_NOT_BREAK);
  check("newline @5: mandatory break after", sink.bp[5]!.breakConditionAfter === DWRITE_BREAK_CONDITION.MUST_BREAK);
  check("char after newline @6: mandatory break before", sink.bp[6]!.breakConditionBefore === DWRITE_BREAK_CONDITION.MUST_BREAK);
  check("soft hyphen @8: flagged + may break after", sink.bp[8]!.isSoftHyphen && sink.bp[8]!.breakConditionAfter === DWRITE_BREAK_CONDITION.CAN_BREAK);
  check("non-whitespace letters not flagged whitespace", !sink.bp[0]!.isWhitespace && !sink.bp[6]!.isWhitespace);
}

// ============================================================ Number substitution
{
  console.log("\nAnalyzeNumberSubstitution:");
  // DWriteCore's AnalyzeNumberSubstitution consults the SOURCE (GetNumberSubstitution) but does not
  // report runs back through the sink, so we validat, he source side: a real IDWriteNumberSubstitution
  // is advertised (exercising the AddRef-on-out-param the base performs - a missing addRef crashes
  // here), the queries tile the text via the block protocol, and the analysis succeeds.
  using sub = (() => {
    using s = abi.scope();
    const out = s.out();
    const loc = s.allocWString("ar-eg");
    callMethod(abi, factory.ptr, 22 /* CreateNumberSubstitution */, DWRITE_NUMBER_SUBSTITUTION_METHOD.CONTEXTUAL, loc, 0, out);
    return IDWriteNumberSubstitution.from(abi, abi.readU32(out));
  })();
  check("created IDWriteNumberSubstitution", sub.ptr !== 0);

  const text = "price 42 now";
  // Advertise the substitution over digit/non-digit runs, recording every position DWrite queries.
  const queried: Run[] = [];
  class CountingSource extends TextAnalysisSourceBase {
    constructor() { super(abi); }
    protected override getTextAtPosition(p: number): string | null { return p < text.length ? text.slice(p) : null; }
    protected override getTextBeforePosition(p: number): string | null { return p > 0 && p <= text.length ? text.slice(0, p) : null; }
    protected override getNumberSubstitution(p: number): NumberSubstitutionRun {
      const isDigit = (c: string) => c >= "0" && c <= "9";
      let q = p; const cls = isDigit(text[p]!);
      while (q < text.length && isDigit(text[q]!) === cls) q++;
      queried.push({ p, l: q - p });
      return { numberSubstitution: sub, textLength: q - p };
    }
  }
  using src = new CountingSource();
  const sink = new NumberSink(abi);
  const hr = callMethod(abi, analyzer, AnalyzeNumberSubstitution, src.ptr, 0, text.length, sink.ptr);
  check("AnalyzeNumberSubstitution succeeded (S_OK)", hr === 0, `hr=0x${(hr >>> 0).toString(16)}`);
  check("source was consulted for number substitution", queried.length > 0);
  check("source queries tile the whole text (block protocol)", partitions(queried, text.length));
}

// ============================================================ Source block protocol
{
  console.log("\nSource block protocol (chunked text):");
  // A source that hands DirectWrite the text in 4-char blocks must yield the SAME script
  // itemization as a single-block source - proving the base's GetTextAtPosition/GetTextBeforePosition
  // block handling and per-block string pinning are correct.
  const text = "Hi العربية world";
  using whole = new TextSource(text);
  using chunked = new TextSource(text, { chunk: 4 });
  const a = new ScriptSink(abi); run(AnalyzeScript, whole, a, text.length);
  const b = new ScriptSink(abi); run(AnalyzeScript, chunked, b, text.length);
  const norm = (s: ScriptSink) => s.runs.map(r => `${r.p}:${r.l}:${r.script}`).join("|");
  check("chunked source partitions the text", partitions(b.runs, text.length));
  check("chunked itemization matches single-block", norm(a) === norm(b), `${norm(a)} vs ${norm(b)}`);
}

console.log(`\nRESULT: ${fail === 0 ? "SUCCESS" : "FAILURE"} - ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
