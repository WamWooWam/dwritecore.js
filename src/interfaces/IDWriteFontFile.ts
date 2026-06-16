import type { Abi } from "../core/abi.js";
import { checkHr } from "../core/com.js";
import { DWRITE_FONT_FILE_TYPE, DWRITE_FONT_FACE_TYPE } from "../core/types.js";
import { IDWriteFontFile as IDWriteFontFileBase } from "./IDWriteFontFile.g.js";
import { IDWriteFontFileSlot as Slot } from "../core/slots.g.js";

export interface FontFileAnalysis {
  isSupported: boolean;
  fileType: DWRITE_FONT_FILE_TYPE;
  faceType: DWRITE_FONT_FACE_TYPE;
  numberOfFaces: number;
}

export class IDWriteFontFile extends IDWriteFontFileBase {
  static override from(abi: Abi, ptr: number): IDWriteFontFile {
    return new IDWriteFontFile(abi, ptr);
  }

  analyze(): FontFileAnalysis {
    using s = this.abi.scope();
    const sup = s.allocZeroed(4);
    const fileType = s.allocZeroed(4);
    const faceType = s.allocZeroed(4);
    const numFaces = s.allocZeroed(4);
    checkHr(this.invoke(Slot.Analyze, sup, fileType, faceType, numFaces), "Analyze");
    return {
      isSupported: this.abi.readU32(sup) !== 0,
      fileType: this.abi.readU32(fileType),
      faceType: this.abi.readU32(faceType),
      numberOfFaces: this.abi.readU32(numFaces),
    };
  }
}
