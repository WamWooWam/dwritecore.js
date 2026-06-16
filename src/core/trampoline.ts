// Builds a tiny WebAssembly module whose n-th export ("g{n}") forwards all of its
// arguments to its n-th import ("e"."f{n}"). The exports are real wasm function objects,
// so they can be table.set into the main module's indirect table (unlike plain JS
// functions) and called from wasm via call_indirect, letting JS implement COM vtables.

export const I32 = 0x7f;
export const F32 = 0x7d;
export type WasmValType = typeof I32 | typeof F32;
export interface TrampolineSig { params: WasmValType[]; result: WasmValType | null }

function uleb(v: number): number[] {
  const out: number[] = [];
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return out;
}
function vec<T>(items: T[], enc: (t: T) => number[]): number[] {
  return [...uleb(items.length), ...items.flatMap(enc)];
}
function name(s: string): number[] {
  return [...uleb(s.length), ...[...s].map((c) => c.charCodeAt(0))];
}
function section(id: number, payload: number[]): number[] {
  return [id, ...uleb(payload.length), ...payload];
}

export function buildTrampolineModule(sigs: TrampolineSig[]): Uint8Array {
  const key = (s: TrampolineSig) => s.params.join(",") + ">" + (s.result ?? "");
  const distinct: TrampolineSig[] = [];
  const typeIndex = new Map<string, number>();
  for (const s of sigs) {
    const k = key(s);
    if (!typeIndex.has(k)) { typeIndex.set(k, distinct.length); distinct.push(s); }
  }
  const typeOf = (s: TrampolineSig) => typeIndex.get(key(s))!;

  const typeSec = section(1, vec(distinct, (s) => [
    0x60,
    ...vec(s.params, (p) => [p]),
    ...vec(s.result == null ? [] : [s.result], (r) => [r]),
  ]));
  const importSec = section(2, vec(sigs.map((s, i) => ({ s, i })), ({ s, i }) =>
    [...name("e"), ...name("f" + i), 0x00, ...uleb(typeOf(s))]));
  const funcSec = section(3, vec(sigs, (s) => uleb(typeOf(s))));
  const exportSec = section(7, vec(sigs.map((_, i) => i), (i) =>
    [...name("g" + i), 0x00, ...uleb(sigs.length + i)])); // funcidx = nImports + i
  const codeSec = section(10, vec(sigs.map((s, i) => ({ s, i })), ({ s, i }) => {
    const body = [0x00]; // 0 local declarations
    for (let p = 0; p < s.params.length; p++) body.push(0x20, ...uleb(p)); // local.get p
    body.push(0x10, ...uleb(i), 0x0b);                                     // call import i; end
    return [...uleb(body.length), ...body];
  }));

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...typeSec, ...importSec, ...funcSec, ...exportSec, ...codeSec,
  ]);
}
