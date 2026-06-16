import type { Abi } from "../core/abi.js";
import { S_OK } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWriteTextAnalysisSource } from "../core/iids.js";
import { I32, type TrampolineSig } from "../core/trampoline.js";
import { DWRITE_READING_DIRECTION } from "../core/types.js";
import type { IDWriteNumberSubstitution } from "../interfaces/IDWriteNumberSubstitution.g.js";

const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },      // 0 QueryInterface
  { params: [I32], result: I32 },                // 1 AddRef
  { params: [I32], result: I32 },                // 2 Release
  { params: [I32, I32, I32, I32], result: I32 }, // 3 GetTextAtPosition(pos, string**, length*)
  { params: [I32, I32, I32, I32], result: I32 }, // 4 GetTextBeforePosition(pos, string**, length*)
  { params: [I32], result: I32 },                // 5 GetParagraphReadingDirection() -> enum (direct)
  { params: [I32, I32, I32, I32], result: I32 }, // 6 GetLocaleName(pos, length*, localeName**)
  { params: [I32, I32, I32, I32], result: I32 }, // 7 GetNumberSubstitution(pos, length*, substitution**)
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_IDWriteTextAnalysisSource],
};

export interface LocaleRun { localeName: string | null; textLength: number }
export interface NumberSubstitutionRun { numberSubstitution: IDWriteNumberSubstitution | null; textLength: number }

export abstract class TextAnalysisSourceBase extends ComObject {
  private readonly pinned: number[] = [];

  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected getTextAtPosition(_textPosition: number): string | null { return null; }
  protected getTextBeforePosition(_textPosition: number): string | null { return null; }
  protected get paragraphReadingDirection(): DWRITE_READING_DIRECTION { return DWRITE_READING_DIRECTION.LEFT_TO_RIGHT; }
  protected getLocaleName(_textPosition: number): LocaleRun { return { localeName: null, textLength: 0 }; }
  protected getNumberSubstitution(_textPosition: number): NumberSubstitutionRun { return { numberSubstitution: null, textLength: 0 }; }

  // pin a string as a NUL-terminated WCHAR buffer that outlives the callback
  private pin(s: string): number {
    const p = this.abi.allocWString(s);
    this.pinned.push(p);
    return p;
  }

  protected handlers(): Function[] {
    const abi = this.abi;
    const text = (s: string | null, strOut: number, lenOut: number) => {
      if (s == null || s.length === 0) { abi.writeU32(strOut, 0); abi.writeU32(lenOut, 0); return S_OK; }
      abi.writeU32(strOut, this.pin(s));
      abi.writeU32(lenOut, s.length); // UTF-16 code units = WCHARs
      return S_OK;
    };
    return [
      (_t: number, pos: number, strOut: number, lenOut: number) => text(this.getTextAtPosition(pos >>> 0), strOut, lenOut),
      (_t: number, pos: number, strOut: number, lenOut: number) => text(this.getTextBeforePosition(pos >>> 0), strOut, lenOut),
      (_t: number) => this.paragraphReadingDirection >>> 0,
      (_t: number, pos: number, lenOut: number, nameOut: number) => {
        const run = this.getLocaleName(pos >>> 0);
        abi.writeU32(nameOut, run.localeName ? this.pin(run.localeName) : 0);
        abi.writeU32(lenOut, run.textLength >>> 0);
        return S_OK;
      },
      (_t: number, pos: number, lenOut: number, subOut: number) => {
        const run = this.getNumberSubstitution(pos >>> 0);
        if (run.numberSubstitution) { run.numberSubstitution.addRef(); abi.writeU32(subOut, run.numberSubstitution.ptr); }
        else abi.writeU32(subOut, 0);
        abi.writeU32(lenOut, run.textLength >>> 0);
        return S_OK;
      },
    ];
  }

  protected override dispose(): void {
    for (const p of this.pinned) this.abi.free(p);
    this.pinned.length = 0;
  }
}
