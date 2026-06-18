import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import { DWRITE_TEXTURE_TYPE, type RECT, readRect, RECT_SIZE } from "../core/types.js";
import { IDWriteGlyphRunAnalysis as IDWriteGlyphRunAnalysisBase } from "./IDWriteGlyphRunAnalysis.g.js";
import { IDWriteGlyphRunAnalysisSlot as Slot } from "../core/slots.g.js";

export interface AlphaTexture {
  bounds: RECT;
  width: number;
  height: number;
  bytesPerPixel: number;
  data: Uint8Array;
}

export class IDWriteGlyphRunAnalysis extends IDWriteGlyphRunAnalysisBase {
  static override from(abi: Abi, ptr: number): IDWriteGlyphRunAnalysis {
    return new IDWriteGlyphRunAnalysis(abi, ptr);
  }

  getAlphaTextureBounds(type: DWRITE_TEXTURE_TYPE): RECT {
    using s = this.abi.scope();
    const rect = s.allocZeroed(RECT_SIZE);
    checkHr(this.invoke(Slot.GetAlphaTextureBounds, type, rect), "GetAlphaTextureBounds");
    return readRect(this.abi, rect);
  }

  createAlphaTexture(type: DWRITE_TEXTURE_TYPE, bounds = this.getAlphaTextureBounds(type)): AlphaTexture {
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const bytesPerPixel = type === DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1 ? 3 : 1;
    // .slice() copies the coverage out of wasm so it outlives the scratch buffer.
    const data = this.withAlphaTexture(type, bounds, (cov) => cov.slice());
    return { bounds, width, height, bytesPerPixel, data };
  }

  // Render the coverage for `bounds` into wasm scratch and hand a transient Uint8Array VIEW of it to
  // `consume` (valid only for the synchronous call - the scratch is freed when this returns). Lets a
  // hot caller read coverage straight from wasm into its own buffer without the per-run intermediate
  // Uint8Array.slice() that createAlphaTexture otherwise allocates.
  withAlphaTexture<T>(type: DWRITE_TEXTURE_TYPE, bounds: RECT, consume: (coverage: Uint8Array) => T): T {
    using s = this.abi.scope();
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    const bytesPerPixel = type === DWRITE_TEXTURE_TYPE.CLEARTYPE_3x1 ? 3 : 1;
    const size = width * height * bytesPerPixel;

    const rect = s.allocZeroed(RECT_SIZE);
    this.abi.writeU32(rect + 0, bounds.left);
    this.abi.writeU32(rect + 4, bounds.top);
    this.abi.writeU32(rect + 8, bounds.right);
    this.abi.writeU32(rect + 12, bounds.bottom);

    const buf = s.allocZeroed(size || 1);
    checkHr(this.invoke(Slot.CreateAlphaTexture, type, rect, buf, size), "CreateAlphaTexture");
    return consume(new Uint8Array(this.abi.memory.buffer, buf, size));
  }
}
