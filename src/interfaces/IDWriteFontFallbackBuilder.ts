import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import type { IDWriteFontCollection } from "./IDWriteFontCollection.js";
import { writeUnicodeRanges, type DWRITE_UNICODE_RANGE } from "../core/types.js";
import { IDWriteFontFallbackBuilder as IDWriteFontFallbackBuilderBase } from "./IDWriteFontFallbackBuilder.g.js";
import { IDWriteFontFallbackBuilderSlot as Slot } from "../core/slots.g.js";

export interface AddMappingOptions {
  fontCollection?: IDWriteFontCollection | null;
  localeName?: string | null;
  baseFamilyName?: string | null;
  scale?: number;
}

export class IDWriteFontFallbackBuilder extends IDWriteFontFallbackBuilderBase {
  static override from(abi: Abi, ptr: number): IDWriteFontFallbackBuilder {
    return new IDWriteFontFallbackBuilder(abi, ptr);
  }

  addMapping(ranges: DWRITE_UNICODE_RANGE[], targetFamilyNames: string[], opts: AddMappingOptions = {}): void {
    using s = this.abi.scope();
    const rangesPtr = writeUnicodeRanges(this.abi, s, ranges);
    // WCHAR const** : array of pointers to wide strings.
    const namesPtr = s.alloc(targetFamilyNames.length * 4);
    targetFamilyNames.forEach((n, i) => this.abi.writeU32(namesPtr + i * 4, s.allocWString(n)));
    checkHr(this.invoke(
      Slot.AddMapping,
      rangesPtr, ranges.length,
      namesPtr, targetFamilyNames.length,
      opts.fontCollection ? opts.fontCollection.ptr : 0,
      opts.localeName ? s.allocWString(opts.localeName) : 0,
      opts.baseFamilyName ? s.allocWString(opts.baseFamilyName) : 0,
      opts.scale ?? 1.0,
    ), "AddMapping");
  }
}
