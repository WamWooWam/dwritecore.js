import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });

using factory = DWriteCoreCreateFactory(abi);
console.log("factory ptr      = 0x" + factory.ptr.toString(16));

const before = factory.addRef();
const after = factory.release();
console.log(`AddRef/Release   = ${before} -> ${after}`);

using fontCollection = factory.getSystemFontCollection();
console.log("fontCollection   = 0x" + fontCollection.ptr.toString(16));

using format = factory.createTextFormat("Segoe UI", { fontSize: 16 });
console.log("textFormat ptr   = 0x" + format.ptr.toString(16));

using layout = factory.createTextLayout(
  "Hello, world! This is a really long text string that should wrap onto multiple lines.",
  format, 300, 100,
);
console.log("textLayout ptr   = 0x" + layout.ptr.toString(16));

console.log("metrics          =", layout.getMetrics());

layout[Symbol.dispose]();
layout[Symbol.dispose]();
console.log("\nRESULT: SUCCESS, drove DirectWriteCore COM objects from JS end-to-end");
