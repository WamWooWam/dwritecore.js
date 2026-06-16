import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

const files = ["segoeui.ttf", "arial.ttf", "times.ttf"];
const text = "Hg";
const codePoints = [...text].map((c) => c.codePointAt(0)!);

for (const file of files) {
  using face = factory.loadFontFace(`/local/fonts/${file}`);
  const m = face.getMetrics();
  const glyphs = face.getGlyphIndices(codePoints);
  const adv = face.getDesignGlyphMetrics(glyphs).map((g) => g.advanceWidth);
  console.log(
    `${file.padEnd(12)} upem=${m.designUnitsPerEm} ascent=${m.ascent} descent=${m.descent} ` +
    `cap=${m.capHeight} x=${m.xHeight} | "${text}" glyphs=[${glyphs}] advances=[${adv}]`,
  );
}
