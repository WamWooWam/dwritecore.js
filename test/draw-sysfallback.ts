import { loadNode } from "../src/host/node.js";
import { DWRITE_WORD_WRAPPING, DWriteCoreCreateFactory } from "../src/index.js";
import { DWRITE_FONT_FAMILY_MODEL } from "../src/core/enums.g.js";
import { readdir } from "fs/promises";
import { TextCanvas } from "../src/util/canvas.js";
import { snapshot } from "./harness.js";
import { createCanvas } from "@napi-rs/canvas";
import path from "path";

const fontsDir = path.resolve(process.env.SYSTEMROOT!, "Fonts");
const localFontsDir = path.resolve(process.env.LOCALAPPDATA!, "Microsoft", "Windows", "Fonts");

console.log(fontsDir, localFontsDir);

const { abi } = await loadNode({
  wasmPath: "./linelayout-core.patched.wasm",
  preopens: {
    "/fonts": fontsDir,
    "/fonts/local": localFontsDir
  }
});

using factory = DWriteCoreCreateFactory(abi);
using setBuilder = factory.createFontSetBuilder();

const fonts = [
  ...(await readdir(fontsDir, { recursive: false })).map(f => `/fonts/${f}`),
  ...(await readdir(localFontsDir, { recursive: false })).map(f => `/fonts/local/${f}`),
]
for (const font of fonts) {
  try {
    if (font.toLowerCase().endsWith("ttf") || font.toLowerCase().endsWith("ttc"))
      setBuilder.addFontFile2(font);
  }
  catch (e) {
    console.log("cant load", font)
  }
}

using set = setBuilder.createFontSet();
console.log(`font set count = ${set.fontCount}`)
using collection = factory.createFontCollectionFromFontSet6(set, DWRITE_FONT_FAMILY_MODEL.TYPOGRAPHIC);
console.log(`font collection count = ${collection.fontFamilyCount}`)
for (const element of collection.getFamilyNames()) {
  console.log('font family:', element);
}

using fallback = factory.getSystemFontFallback();

const canvas = createCanvas(500, 500);
const ctx = canvas.getContext('2d');
ctx.fillStyle = 'white';
ctx.fillRect(0, 0, 500, 500)

using format = factory.createTextFormat("Segoe UI", { fontCollection: collection, fontSize: 30 });
using layout = factory.createTextLayout(
  "Mixed text 👨‍👩‍👧‍👦 and emoji ❤️ in 🌈 one 🚀 run, auto-fallback!\r\n" +
  "テキスト👨‍👩‍👧‍👦と絵文字❤️が1回の🚀実行で混在、自動フォールバック!\r\n" +
  "שילוב של טקסט 👨‍👩‍👧‍👦 ואימוג'י ❤️ בהפעלה אחת 🌈 🚀, פתרון אוטומטי\r\n" +
  "نص مختلط 👨‍👩‍👧‍👦 ورمز تعبيري ❤️ في 🌈 تشغيل واحد 🚀، مع خاصية الرجوع التلقائي!",
  format, 500, 500,
);
layout.wordWrapping = DWRITE_WORD_WRAPPING.WRAP;
layout.fontFallback = fallback;

using dw = new TextCanvas(factory, ctx);
dw.drawLayout(layout, { x: 20, y: 20, color: [0x18, 0x18, 0x18, 1], colorGlyphs: true });

await snapshot("sysfallback", canvas.toBuffer("image/png"));
