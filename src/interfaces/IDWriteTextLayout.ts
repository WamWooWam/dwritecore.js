import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import { IDWriteTextLayout as IDWriteTextLayoutBase } from "./IDWriteTextLayout.g.js";
import { IDWriteFontFallback } from "./IDWriteFontFallback.g.js";
import {
  writeTextRange, type DWRITE_TEXT_RANGE,
  DWRITE_FONT_WEIGHT,
  writeFontAxisValues, readFontAxisValues, DWRITE_FONT_AXIS_VALUE_SIZE, type DWRITE_FONT_AXIS_VALUE,
} from "../core/types.js";
import { IDWriteTextLayout4Slot as Slot } from "../core/slots.g.js";

export class IDWriteTextLayout extends IDWriteTextLayoutBase {
  static override from(abi: Abi, ptr: number): IDWriteTextLayout {
    return new IDWriteTextLayout(abi, ptr);
  }

  getFontWeightAt(currentPosition: number): DWRITE_FONT_WEIGHT {
    using s = this.abi.scope();
    const out = s.allocZeroed(4);
    checkHr(this.invoke(Slot.GetFontWeight_47, currentPosition, out, 0), "GetFontWeight");
    return this.abi.readU32(out) >>> 0;
  }

  get fontFallback(): IDWriteFontFallback | null {
    using s = this.abi.scope();
    const out = s.out();
    checkHr(this.invoke(Slot.GetFontFallback, out), "GetFontFallback");
    const p = this.abi.readPtr(out);
    return p ? IDWriteFontFallback.from(this.abi, p) : null;
  }
  set fontFallback(fallback: IDWriteFontFallback | null) {
    checkHr(this.invoke(Slot.SetFontFallback, fallback ? fallback.ptr : 0), "SetFontFallback");
  }

  override setFontAxisValues(values: DWRITE_FONT_AXIS_VALUE[], range: DWRITE_TEXT_RANGE = { startPosition: 0, length: 0xffffffff }): void {
    using s = this.abi.scope();
    const valuesPtr = writeFontAxisValues(this.abi, s, values);
    checkHr(this.invoke(Slot.SetFontAxisValues, valuesPtr, values.length, writeTextRange(this.abi, s, range)),
      "SetFontAxisValues");
  }

  getFontAxisValuesAt(currentPosition: number): { tag: string; value: number }[] {
    const n = this.invoke(Slot.GetFontAxisValueCount, currentPosition) >>> 0;
    if (n === 0) return [];
    using s = this.abi.scope();
    const buf = s.allocZeroed(n * DWRITE_FONT_AXIS_VALUE_SIZE);
    checkHr(this.invoke(Slot.GetFontAxisValues, currentPosition, buf, n, 0), "GetFontAxisValues");
    return readFontAxisValues(this.abi, buf, n);
  }

  // renderer: an IDWriteTextRenderer COM object (e.g. DWriteTextRenderer.ptr).
  draw(renderer: { ptr: number }, originX = 0, originY = 0): void {
    checkHr(this.invoke(Slot.Draw, 0, renderer.ptr, originX, originY), "Draw");
  }
}
