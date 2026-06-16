import type { Abi } from "../core/abi.js";
import { S_OK } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWriteTextAnalysisSink } from "../core/iids.js";
import { I32, type TrampolineSig } from "../core/trampoline.js";
import { readScriptAnalysis, type DWRITE_SCRIPT_ANALYSIS } from "../core/structs.g.js";
import { IDWriteNumberSubstitution } from "../interfaces/IDWriteNumberSubstitution.g.js";

const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },           // 0 QueryInterface
  { params: [I32], result: I32 },                     // 1 AddRef
  { params: [I32], result: I32 },                     // 2 Release
  { params: [I32, I32, I32, I32], result: I32 },      // 3 SetScriptAnalysis(pos, len, analysis*)
  { params: [I32, I32, I32, I32], result: I32 },      // 4 SetLineBreakpoints(pos, len, breakpoints*)
  { params: [I32, I32, I32, I32, I32], result: I32 }, // 5 SetBidiLevel(pos, len, explicit, resolved)
  { params: [I32, I32, I32, I32], result: I32 },      // 6 SetNumberSubstitution(pos, len, substitution*)
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_IDWriteTextAnalysisSink],
};

export interface LineBreakpoint {
  breakConditionBefore: number;
  breakConditionAfter: number;
  isWhitespace: boolean;
  isSoftHyphen: boolean;
}

export abstract class TextAnalysisSinkBase extends ComObject {
  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected setScriptAnalysis(_textPosition: number, _textLength: number, _scriptAnalysis: DWRITE_SCRIPT_ANALYSIS): void {}
  protected setLineBreakpoints(_textPosition: number, _textLength: number, _breakpoints: LineBreakpoint[]): void {}
  protected setBidiLevel(_textPosition: number, _textLength: number, _explicitLevel: number, _resolvedLevel: number): void {}
  protected setNumberSubstitution(_textPosition: number, _textLength: number, _numberSubstitution: IDWriteNumberSubstitution | null): void {}

  protected handlers(): Function[] {
    const abi = this.abi;
    return [
      (_t: number, pos: number, len: number, analysis: number) => {
        this.setScriptAnalysis(pos >>> 0, len >>> 0, readScriptAnalysis(abi, analysis));
        return S_OK;
      },
      (_t: number, pos: number, len: number, breakpoints: number) => {
        const n = len >>> 0, out: LineBreakpoint[] = [];
        for (let i = 0; i < n; i++) {
          const b = abi.readU8(breakpoints + i); // packed 1-byte bitfield (LSB first)
          out.push({
            breakConditionBefore: b & 0x3,
            breakConditionAfter: (b >> 2) & 0x3,
            isWhitespace: ((b >> 4) & 0x1) !== 0,
            isSoftHyphen: ((b >> 5) & 0x1) !== 0,
          });
        }
        this.setLineBreakpoints(pos >>> 0, n, out);
        return S_OK;
      },
      (_t: number, pos: number, len: number, explicitLevel: number, resolvedLevel: number) => {
        this.setBidiLevel(pos >>> 0, len >>> 0, explicitLevel & 0xff, resolvedLevel & 0xff);
        return S_OK;
      },
      (_t: number, pos: number, len: number, substitution: number) => {
        this.setNumberSubstitution(pos >>> 0, len >>> 0, substitution ? IDWriteNumberSubstitution.from(abi, substitution) : null);
        return S_OK;
      },
    ];
  }
}
