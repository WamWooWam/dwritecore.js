import type { Abi } from "../core/abi.js";
import { IDWriteFontCollection as IDWriteFontCollectionBase } from "./IDWriteFontCollection.g.js";

export class IDWriteFontCollection extends IDWriteFontCollectionBase {
  static from(abi: Abi, ptr: number): IDWriteFontCollection {
    return new IDWriteFontCollection(abi, ptr);
  }

  getFamilyNames(): string[] {
    const names: string[] = [];
    const count = this.fontFamilyCount;
    for (let i = 0; i < count; i++) {
      using family = this.getFontFamily(i);
      using strings = family.getFamilyNames();
      names.push(strings.getString(0));
    }
    return names;
  }
}
