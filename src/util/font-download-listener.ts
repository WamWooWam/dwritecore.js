import type { Abi } from "../core/abi.js";
import { IUnknown } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_IDWriteFontDownloadListener } from "../core/iids.js";
import { I32, type TrampolineSig } from "../core/trampoline.js";
import { IDWriteFontDownloadQueue } from "../interfaces/IDWriteFontDownloadQueue.g.js";

const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },      // 0 QueryInterface
  { params: [I32], result: I32 },                // 1 AddRef
  { params: [I32], result: I32 },                // 2 Release
  { params: [I32, I32, I32, I32], result: null }, // 3 DownloadCompleted(queue*, context*, HRESULT) -> void
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_IDWriteFontDownloadListener],
};

export abstract class FontDownloadListenerBase extends ComObject {
  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected abstract downloadCompleted(queue: IDWriteFontDownloadQueue, context: IUnknown | null, downloadResult: number): void;

  protected handlers(): Function[] {
    const abi = this.abi;
    return [
      (_t: number, queue: number, context: number, downloadResult: number) => {
        this.downloadCompleted(
          IDWriteFontDownloadQueue.from(abi, queue),
          context ? new IUnknown(abi, context) : null,
          downloadResult | 0,
        );
      },
    ];
  }
}
