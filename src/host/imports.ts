//
// these imports are required by linelayout-core.wasm but we dont actually touch any of them because
// we patch it to expose raw DirectWrite interfaces instead of whatever this bullshit is

export interface EnvImportOptions {
  onTrace?: (msg: number) => void;
  rendering?: Partial<Record<string, (...args: number[]) => void>>;
}

export function buildEnvImports(opts: EnvImportOptions = {}): WebAssembly.Imports {
  const trace = opts.onTrace ?? (() => {});
  return {
    Log: {
      trace: (ptr: number) => trace(ptr),
      failFast: (ptr: number) => { throw new Error(`Fail fast: ${ptr}`); },
    },
    Experimentation: {
      getBooleanFeatureGate: () => 0,
      isChangeGateEnabled: () => 0,
    },
    WasiFont: {
      download: () => {},
      getLocal: () => {},
      downloadInvalidationCallback: () => 0,
    },
    Rendering: {
      drawGlyphRun: () => {},
      drawHighlight: () => {},
      drawUnderline: () => {},
      drawStrikethrough: () => {},
      ...opts.rendering,
    },
  };
}
