import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import { IDWriteColorGlyphRunEnumerator as IDWriteColorGlyphRunEnumeratorBase } from "./IDWriteColorGlyphRunEnumerator.g.js";
import { IDWriteColorGlyphRunEnumerator1Slot as Slot } from "../core/slots.g.js";
import {
  readColorGlyphRun, readColorGlyphRun1,
  type DWRITE_COLOR_GLYPH_RUN, type DWRITE_COLOR_GLYPH_RUN1,
} from "../core/structs.js";

export class IDWriteColorGlyphRunEnumerator extends IDWriteColorGlyphRunEnumeratorBase {
  static override from(abi: Abi, ptr: number): IDWriteColorGlyphRunEnumerator {
    return new IDWriteColorGlyphRunEnumerator(abi, ptr);
  }

  getCurrentRun(): DWRITE_COLOR_GLYPH_RUN {
    using s = this.abi.scope();
    const out = s.allocZeroed(4);
    checkHr(this.invoke(Slot.GetCurrentRun, out), "GetCurrentRun");
    return readColorGlyphRun(this.abi, this.abi.readPtr(out));
  }
  
  getCurrentRun1(): DWRITE_COLOR_GLYPH_RUN1 & { ptr: number } {
    using s = this.abi.scope();
    const out = s.allocZeroed(4);
    checkHr(this.invoke(Slot.GetCurrentRun1, out), "GetCurrentRun1");
    const ptr = this.abi.readPtr(out);
    return { ...readColorGlyphRun1(this.abi, ptr), ptr };
  }

  currentRunFormat(): number {
    using s = this.abi.scope();
    const out = s.allocZeroed(4);
    checkHr(this.invoke(Slot.GetCurrentRun1, out), "GetCurrentRun1");
    return this.abi.readU32(this.abi.readPtr(out) + 64);
  }
}
