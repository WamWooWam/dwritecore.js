import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });

// free(NULL) must be safe.
abi.free(0);

// Pointer reuse: malloc -> free -> malloc of the same size returns the same block.
const a = abi.alloc(128);
abi.free(a);
const b = abi.alloc(128);
abi.free(b);
console.log(`reuse: a=0x${a.toString(16)} b=0x${b.toString(16)} ->`, a === b ? "REUSED" : "different");

// Scopes must actually reclaim: hammer allocations and watch linear memory stay flat.
const pages = () => abi.memory.buffer.byteLength / 65536;
const before = pages();
using factory = DWriteCoreCreateFactory(abi);
for (let i = 0; i < 200_000; i++) {
  using s = abi.scope();
  s.allocWString(`measure this string number ${i} with some length`);
  s.allocZeroed(256);
  s.out();
}
const after = pages();
console.log(`memory pages: before=${before} after=${after} -> ${after === before ? "FLAT (free works)" : "GREW by " + (after - before)}`);
