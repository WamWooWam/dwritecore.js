import type { Abi } from "./abi.js";
import { S_OK, E_NOINTERFACE } from "./com.js";
import type { Guid } from "./guid.js";
import { buildTrampolineModule, type TrampolineSig } from "./trampoline.js";

export interface ComInterfaceDescriptor {
  readonly sigs: TrampolineSig[];
  readonly iids: Guid[];
}

const registry = new Map<number, ComObject>();

interface SharedVtable {
  vtablePtr: number;
  instance: WebAssembly.Instance;
}

const sharedByTable = new WeakMap<WebAssembly.Table, Map<ComInterfaceDescriptor, SharedVtable>>();

export abstract class ComObject implements Disposable {
  readonly ptr: number;
  protected refCount = 1; // born with the JS owner reference
  private released = false;
  private readonly objPtr: number;

  // handlers are materialised lazily on first call and cached here
  private handlerCache: Function[] | null = null;

  constructor(protected readonly abi: Abi, private readonly desc: ComInterfaceDescriptor) {
    const shared = ComObject.sharedVtable(abi, desc);
    this.objPtr = abi.alloc(4);
    abi.writeU32(this.objPtr, shared.vtablePtr);
    this.ptr = this.objPtr;
    registry.set(this.objPtr, this);
  }

  protected abstract handlers(): Function[];
  protected dispose(): void { }

  private static sharedVtable(abi: Abi, desc: ComInterfaceDescriptor): SharedVtable {
    let perTable = sharedByTable.get(abi.table);
    if (!perTable) sharedByTable.set(abi.table, perTable = new Map());
    const existing = perTable.get(desc);
    if (existing) return existing;

    const module = new WebAssembly.Module(buildTrampolineModule(desc.sigs) as unknown as BufferSource);
    const env: Record<string, Function> = {};
    for (let i = 0; i < desc.sigs.length; i++) {
      const slot = i;
      env["f" + i] = (...args: number[]): number | void => {
        const inst = registry.get(args[0]!);
        return inst ? inst.dispatch(slot, args) : 0;
      };
    }
    const instance = new WebAssembly.Instance(module, { e: env });

    const base = abi.table.grow(desc.sigs.length);
    for (let i = 0; i < desc.sigs.length; i++) {
      abi.table.set(base + i, instance.exports["g" + i] as Function);
    }
    const vtablePtr = abi.alloc(desc.sigs.length * 4);
    for (let i = 0; i < desc.sigs.length; i++) abi.writeU32(vtablePtr + i * 4, base + i);

    const shared: SharedVtable = { vtablePtr, instance };
    perTable.set(desc, shared);
    return shared;
  }

  private dispatch(slot: number, args: number[]): number | void {
    switch (slot) {
      case 0: return this.queryInterface(args[1]!, args[2]!);
      case 1: return ++this.refCount;
      case 2: {
        const n = --this.refCount;
        if (n <= 0) this.cleanup();
        return Math.max(0, n);
      }
      default:
        this.handlerCache ??= this.handlers();
        return this.handlerCache[slot - 3]!(...args);
    }
  }

  private queryInterface(riid: number, ppv: number): number {
    for (const iid of this.desc.iids) {
      if (iid.matchesMemory(this.abi, riid)) {
        this.abi.writeU32(ppv, this.objPtr);
        this.refCount++;
        return S_OK;
      }
    }
    this.abi.writeU32(ppv, 0);
    return E_NOINTERFACE;
  }

  protected cleanup(): void {
    if (this.released) return;
    this.released = true;
    registry.delete(this.objPtr);
    this.dispose();
    this.abi.free(this.objPtr);
  }

  [Symbol.dispose](): void {
    if (this.released) return;
    const n = --this.refCount;
    if (n <= 0) this.cleanup();
  }
}
