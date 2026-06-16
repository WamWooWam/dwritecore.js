import { readFile } from "node:fs/promises";
import { WASI } from "node:wasi";
import { Abi, type WasmExports } from "../core/abi.js";
import { buildEnvImports, type EnvImportOptions } from "./imports.js";

export interface LoadNodeOptions extends EnvImportOptions {
  wasmPath?: string;
  preopens?: Record<string, string>;
  env?: Record<string, string>;
}

export interface LoadedRuntime {
  abi: Abi;
  instance: WebAssembly.Instance;
  wasi: WASI;
}

export async function loadNode(opts: LoadNodeOptions = {}): Promise<LoadedRuntime> {
  const wasmPath = opts.wasmPath ?? "./linelayout-core.patched.wasm";
  const wasi = new WASI({
    version: "preview1",
    args: process.argv,
    env: opts.env ?? (process.env as Record<string, string>),
    preopens: opts.preopens ?? { "/local": "./" },
  });

  const imports: WebAssembly.Imports = {
    wasi_snapshot_preview1: wasi.wasiImport,
    ...buildEnvImports(opts),
  };
  
  const bytes = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, imports);
  wasi.initialize(instance as { exports: { memory: WebAssembly.Memory; _initialize: () => unknown } });

  const exports = instance.exports as unknown as WasmExports;
  exports.init?.();

  return { abi: new Abi(exports), instance, wasi };
}
