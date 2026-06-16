import type { Abi } from "./abi.js";
import type { Guid } from "./guid.js";

export const S_OK = 0;
export const E_NOINTERFACE = 0x80004002 | 0;
export const E_FAIL = 0x80004005 | 0;
export const E_NOT_SUFFICIENT_BUFFER = 0x8007007a | 0;

export type ComArg = number | bigint;
type VtableFn = (...args: ComArg[]) => number;

export function FAILED(hr: number): boolean { return (hr | 0) < 0; }
export function SUCCEEDED(hr: number): boolean { return (hr | 0) >= 0; }
export function hrString(hr: number): string { return "0x" + (hr >>> 0).toString(16).padStart(8, "0"); }

export function checkHr(hr: number, what: string): number {
  if (FAILED(hr)) throw new Error(`${what} failed: HRESULT ${hrString(hr)}`);
  return hr;
}

// *ptr = vtable; vtable[slot] = indirect-table index; call(thisPtr, ...args).
export function callMethod(abi: Abi, thisPtr: number, slot: number, ...args: ComArg[]): number {
  const vtable = abi.readU32(thisPtr);
  const fnIndex = abi.readU32(vtable + slot * 4);
  const fn = abi.table.get(fnIndex) as VtableFn | null;
  if (!fn) throw new Error(`vtable slot ${slot} -> empty table index ${fnIndex}`);
  return fn(thisPtr, ...args);
}

export const enum IUnknownSlot {
  QueryInterface = 0,
  AddRef = 1,
  Release = 2,
}

export class IUnknown implements Disposable {
  readonly abi: Abi;
  readonly ptr: number;
  protected disposed = false;

  constructor(abi: Abi, ptr: number) {
    if (!ptr) throw new Error(`${new.target.name}: null pointer`);
    this.abi = abi;
    this.ptr = ptr;
  }

  protected invoke(slot: number, ...args: ComArg[]): number {
    if (this.disposed) throw new Error(`${this.constructor.name}: use after dispose`);
    return callMethod(this.abi, this.ptr, slot, ...args);
  }

  addRef(): number { return this.invoke(IUnknownSlot.AddRef) >>> 0; }

  release(): number {
    if (this.disposed) return 0;
    return this.invoke(IUnknownSlot.Release) >>> 0;
  }

  queryInterface(iid: Guid): IUnknown | null;
  
  queryInterface<T extends IUnknown>(iid: Guid, wrap: (abi: Abi, ptr: number) => T): T | null;

  queryInterface<T extends IUnknown>(iid: Guid, wrap?: (abi: Abi, ptr: number) => T): T | IUnknown | null {
    using s = this.abi.scope();
    const out = s.out();
    const hr = this.invoke(IUnknownSlot.QueryInterface, iid.pin(this.abi), out);
    if (hr === E_NOINTERFACE) return null;
    checkHr(hr, `QueryInterface(${iid})`);
    const p = this.abi.readPtr(out);
    return wrap ? wrap(this.abi, p) : new IUnknown(this.abi, p);
  }

  [Symbol.dispose](): void {
    if (this.disposed) return;
    this.disposed = true;
    callMethod(this.abi, this.ptr, IUnknownSlot.Release);
  }
}
