import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import { IDWriteRenderingParams } from "./IDWriteRenderingParams.g.js";
import {
  DWRITE_MEASURING_MODE,
  writeGlyphRun, type GlyphRunDesc,
} from "../core/types.js";
import { IDWriteBitmapRenderTarget as IDWriteBitmapRenderTargetBase } from "./IDWriteBitmapRenderTarget.g.js";
import { IDWriteBitmapRenderTarget3Slot as Slot } from "../core/slots.g.js";

export interface DrawGlyphRunOptions {
  baselineOriginX: number;
  baselineOriginY: number;
  run: GlyphRunDesc;
  renderingParams: IDWriteRenderingParams;
  color: number; // COLORREF (0x00BBGGRR)
  measuringMode?: DWRITE_MEASURING_MODE;
}

export class IDWriteBitmapRenderTarget extends IDWriteBitmapRenderTargetBase {
  static override from(abi: Abi, ptr: number): IDWriteBitmapRenderTarget {
    return new IDWriteBitmapRenderTarget(abi, ptr);
  }

  drawGlyphRun(opts: DrawGlyphRunOptions): void {
    using s = this.abi.scope();
    const run = writeGlyphRun(this.abi, s, opts.run);
    const blackBox = s.allocZeroed(16);
    checkHr(this.invoke(
      Slot.DrawGlyphRun,
      opts.baselineOriginX,
      opts.baselineOriginY,
      opts.measuringMode ?? DWRITE_MEASURING_MODE.NATURAL,
      run,
      opts.renderingParams.ptr,
      opts.color,
      blackBox,
    ), "DrawGlyphRun");
  }

  drawGlyphRunWithColorSupport(opts: DrawGlyphRunOptions & { colorPaletteIndex?: number }): void {
    using s = this.abi.scope();
    const run = writeGlyphRun(this.abi, s, opts.run);
    const blackBox = s.allocZeroed(16);
    checkHr(this.invoke(
      Slot.DrawGlyphRunWithColorSupport,
      opts.baselineOriginX,
      opts.baselineOriginY,
      opts.measuringMode ?? DWRITE_MEASURING_MODE.NATURAL,
      run,
      opts.renderingParams.ptr,
      opts.color,
      opts.colorPaletteIndex ?? 0,
      blackBox,
    ), "DrawGlyphRunWithColorSupport");
  }

  pixels(): { width: number; height: number; data: Uint32Array } {
    const bd = this.getBitmapData();
    return {
      width: bd.width,
      height: bd.height,
      data: new Uint32Array(this.abi.memory.buffer, bd.pixels, bd.width * bd.height),
    };
  }
}
