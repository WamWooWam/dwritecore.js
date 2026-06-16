import type { Abi } from "./abi.js";

export class Guid {
  readonly str: string;
  readonly bytes: Uint8Array;

  constructor(str: string) {
    this.str = str.toLowerCase();
    const hex = this.str.replace(/-/g, "");

    if (hex.length !== 32 || /[^0-9a-f]/.test(hex))
      throw new Error(`bad GUID: ${str}`);

    const b = new Uint8Array(16);
    const byte = (i: number) => parseInt(hex.substring(i * 2, (i * 2) + 2), 16);

    b[0] = byte(3); b[1] = byte(2);
    b[2] = byte(1); b[3] = byte(0);

    b[4] = byte(5); b[5] = byte(4);
    b[6] = byte(7); b[7] = byte(6);

    for (let i = 0; i < 8; i++)
      b[8 + i] = byte(8 + i);

    this.bytes = b;
  }

  pin(abi: Abi): number {
    let p = abi.alloc(16);
    abi.writeBytes(p, this.bytes);

    return p;
  }

  equals(other: Guid): boolean {
    for (let i = 0; i < 16; i++) if (this.bytes[i] !== other.bytes[i]) return false;
    return true;
  }

  matchesMemory(abi: Abi, ptr: number): boolean {
    const u8 = abi.u8;
    for (let i = 0; i < 16; i++) if (u8[ptr + i] !== this.bytes[i]) return false;
    return true;
  }

  toString(): string { return `{${this.str}}`; }
}
