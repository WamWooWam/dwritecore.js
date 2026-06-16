import type { Abi } from "../core/abi.js";
import { S_OK, E_FAIL } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWriteFontFileLoader } from "../core/iids.js";
import { I32, type TrampolineSig } from "../core/trampoline.js";

const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },      // 0 QueryInterface
  { params: [I32], result: I32 },                // 1 AddRef
  { params: [I32], result: I32 },                // 2 Release
  { params: [I32, I32, I32, I32], result: I32 }, // 3 CreateStreamFromKey(key*, keySize, stream**)
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_IDWriteFontFileLoader],
};

export interface FontFileStreamLike { readonly ptr: number }

export abstract class FontFileLoaderBase extends ComObject {
  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected abstract createStreamFromKey(referenceKey: Uint8Array): FontFileStreamLike | null;

  protected handlers(): Function[] {
    const abi = this.abi;
    return [
      (_t: number, keyPtr: number, keySize: number, streamOut: number) => {
        const key = new Uint8Array(keySize >>> 0);
        for (let i = 0; i < key.length; i++) key[i] = abi.readU8(keyPtr + i);
        const stream = this.createStreamFromKey(key);
        if (!stream) { abi.writeU32(streamOut, 0); return E_FAIL; }
        abi.writeU32(streamOut, stream.ptr);
        return S_OK;
      },
    ];
  }
}
