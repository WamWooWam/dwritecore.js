import { Abi, type WasmExports } from "../core/abi.js";
import { buildEnvImports, type EnvImportOptions } from "./imports.js";

type DirectWriteInstance = WebAssembly.Instance & { exports: WasmExports }

export interface LoadBrowserOptions extends EnvImportOptions {
  wasm: string | URL | Response | Promise<Response> | BufferSource;
  // A WASI preview1 import object (e.g. from @bjorn3/browser_wasi_shim).
  wasiImport: WebAssembly.ModuleImports;
  initialize?: (instance: DirectWriteInstance) => void;
}

export async function loadBrowser(opts: LoadBrowserOptions): Promise<{ abi: Abi; instance: WebAssembly.Instance }> {
  if (!opts.wasiImport) throw new Error("loadBrowser: supply a `wasiImport` (preview1)");
  const imports: WebAssembly.Imports = {
    wasi_snapshot_preview1: opts.wasiImport,
    ...buildEnvImports(opts),
  };

  let source = opts.wasm;
  if (typeof source === "string" || source instanceof URL) source = fetch(source);

  const result = source instanceof Response || source instanceof Promise
    ? await WebAssembly.instantiateStreaming(source, imports)
    : await WebAssembly.instantiate(source as BufferSource, imports);

  const { instance } = result;
  const exports = { ...instance.exports as unknown as WasmExports, _start() { } };

  if (opts.initialize) opts.initialize({ ...instance, exports });
  else { exports._initialize?.(); exports.init?.(); }

  return { abi: new Abi(exports), instance };
}
