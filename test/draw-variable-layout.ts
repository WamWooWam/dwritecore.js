import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_WORD_WRAPPING, type DWRITE_FONT_AXIS_VALUE } from "../src/core/types.js";
import { TextCanvas } from "../src/util/canvas.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);

using collection = factory.createFontCollection(["/local/fonts/googlesansflex.ttf"]);
const family = collection.getFamilyNames()[0]!;
console.log("family:", family);

// Introspect every axis (Google Sans Flex: GRAD, ROND, opsz, slnt, wdth, wght).
using face0 = factory.loadFontFace("/local/fonts/googlesansflex.ttf");
using resource = face0.getFontResource();
const ranges = resource.getFontAxisRanges(resource.fontAxisCount);
const defaults = new Map(resource.getDefaultFontAxisValues(resource.fontAxisCount).map((d) => [d.tag, d.value]));
console.log("axes:");
for (const r of ranges) console.log(`  ${r.tag}: ${r.min} .. ${r.max} (default ${defaults.get(r.tag)})`);
const rangeOf = new Map(ranges.map((r) => [r.tag, r]));

// One word per axis; each word pushes its own axis to an extreme (slant -> min, others -> max).
const tags = ["wght", "wdth", "opsz", "slnt", "GRAD", "ROND"].filter((t) => rangeOf.has(t));
const text = tags.join("  ");

const W = 820, H = 220;
const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#ffffff";
ctx.fillRect(0, 0, W, H);

using format = factory.createTextFormat(family, { fontCollection: collection, fontSize: 60 });
using layout = factory.createTextLayout(text, format, W - 40, H - 40);
layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;

let pos = 0;
for (const tag of tags) {
  const r = rangeOf.get(tag)!;
  const value = tag === "slnt" ? r.min : r.max;
  const axes: DWRITE_FONT_AXIS_VALUE[] = [{ tag, value }];
  layout.setFontAxisValues(axes, { startPosition: pos, length: tag.length });
  pos += tag.length + 2; // word + two spaces
}

// Round-trip: read back what each word resolved to.
let p = 0;
for (const tag of tags) {
  const got = layout.getFontAxisValuesAt(p);
  const mine = got.find((g) => g.tag === tag);
  console.log(`@"${tag}" -> ${got.map((g) => `${g.tag}:${g.value}`).join(", ")}  (this axis = ${mine?.value})`);
  p += tag.length + 2;
}

using dw = new TextCanvas(factory, ctx);
dw.drawLayout(layout, { x: 20, y: 20, color: [0x14, 0x14, 0x14, 1] });

await snapshot("variable_layout", canvas.toBuffer("image/png"));
