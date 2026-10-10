export interface WasmExports {
  memory: WebAssembly.Memory;
  __indirect_function_table: WebAssembly.Table;
  malloc(size: number): number;
  free?(ptr: number): void;
  DWriteCreateFactory(type: number, iid: number, out: number): number;
  init?(): void;
  _initialize?(): void;
  _start(): unknown;
  [name: string]: unknown;
}

export interface Allocator {
  alloc(size: number): number;
  allocZeroed(size: number): number;
  allocWString(str: string): number;
  out(): number;
}


export class Abi {
  readonly exports: WasmExports;
  readonly memory: WebAssembly.Memory;
  readonly table: WebAssembly.Table;

  constructor(exports: WasmExports) {
    this.exports = exports;
    this.memory = exports.memory;
    this.table = exports.__indirect_function_table;
    if (!this.memory) throw new Error("module does not export `memory`");
    if (!this.table) throw new Error("module does not export `__indirect_function_table` (run `pnpm patch`)");
    if (typeof exports.malloc !== "function") throw new Error("module does not export `malloc`");
    if (typeof exports.free !== "function") throw new Error("module does not export `free`");
    if (typeof exports.DWriteCreateFactory !== "function") throw new Error("module does not export `DWriteCreateFactory`");
  }

  private _dv: DataView | null = null;
  private _u8: Uint8Array | null = null;

  get dv(): DataView {
    const buf = this.memory.buffer;
    let dv = this._dv;
    if (dv === null || dv.buffer !== buf) this._dv = dv = new DataView(buf);
    return dv;
  }
  get u8(): Uint8Array {
    const buf = this.memory.buffer;
    let u8 = this._u8;
    if (u8 === null || u8.buffer !== buf) this._u8 = u8 = new Uint8Array(buf);
    return u8;
  }

  
  alloc(size: number): number {
    const p = this.exports.malloc(size >>> 0);
    if (p === 0) throw new Error(`malloc(${size}) failed`);
    return p;
  }

  allocZeroed(size: number): number {
    const p = this.alloc(size);
    this.u8.fill(0, p, p + size);
    return p;
  }

  free(ptr: number): void {
    this.exports.free?.(ptr);
  }

  out(): number {
    const p = this.alloc(4);
    this.writeU32(p, 0);
    return p;
  }

  scope(): AllocScope {
    return new AllocScope(this);
  }

  readU8(p: number): number { return this.dv.getUint8(p); }
  readU16(p: number): number { return this.dv.getUint16(p, true); }
  readU32(p: number): number { return this.dv.getUint32(p, true) >>> 0; }
  readI32(p: number): number { return this.dv.getInt32(p, true); }
  readF32(p: number): number { return this.dv.getFloat32(p, true); }
  readF64(p: number): number { return this.dv.getFloat64(p, true); }
  readU64(p: number): bigint { return this.dv.getBigUint64(p, true); }
  readPtr(p: number): number { return this.readU32(p); }

  writeU8(p: number, v: number): void { this.dv.setUint8(p, v); }
  writeU16(p: number, v: number): void { this.dv.setUint16(p, v, true); }
  writeU32(p: number, v: number): void { this.dv.setUint32(p, v >>> 0, true); }
  writeF32(p: number, v: number): void { this.dv.setFloat32(p, v, true); }
  writeBytes(p: number, bytes: ArrayLike<number>): void { this.u8.set(bytes, p); }

  readWString(ptr: number): string | null {
    if (ptr === 0) return null;
    const dv = this.dv;
    let end = ptr;
    while (dv.getUint16(end, true) !== 0) end += 2;
    return new TextDecoder("utf-16le").decode(new Uint8Array(this.memory.buffer, ptr, end - ptr));
  }

  readWStringLen(ptr: number, len: number): string {
    return new TextDecoder("utf-16le").decode(new Uint8Array(this.memory.buffer, ptr, len * 2));
  }

  writeWString(ptr: number, str: string): void {
    const dv = this.dv;
    const units = str.length;
    for (let i = 0; i < units; i++) dv.setUint16(ptr + i * 2, str.charCodeAt(i), true);
    dv.setUint16(ptr + units * 2, 0, true);
  }

  allocWString(str: string): number {
    const ptr = this.alloc((str.length + 1) * 2);
    this.writeWString(ptr, str);
    return ptr;
  }
}

/**
 * Convenience class to scope allocations via `using`
 */
export class AllocScope implements Allocator, Disposable {
  readonly abi: Abi;
  private readonly ptrs: number[] = [];

  constructor(abi: Abi) { this.abi = abi; }

  alloc(size: number): number {
    const p = this.abi.alloc(size);
    this.ptrs.push(p);
    return p;
  }

  allocZeroed(size: number): number {
    const p = this.alloc(size);
    this.abi.u8.fill(0, p, p + size);
    return p;
  }

  allocWString(str: string): number {
    const p = this.alloc((str.length + 1) * 2);
    this.abi.writeWString(p, str);
    return p;
  }

  out(): number {
    const p = this.alloc(4);
    this.abi.writeU32(p, 0);
    return p;
  }

  [Symbol.dispose](): void {
    for (let i = this.ptrs.length - 1; i >= 0; i--) this.abi.free(this.ptrs[i]!);
    this.ptrs.length = 0;
  }
}
