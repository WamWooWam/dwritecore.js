# dwritecore.js
JavaScript/TypeScript bindings for DirectWriteCore in WebAssembly, works in browser + Node.js

```ts
// load
const { abi } = await loadNode({ wasmPath: "/path/to/webassembly", preopens: { "/fonts": "./fonts" } })

// create a factory
using factory = DWriteCoreCreateFactory(abi)

// load fonts
using fontCollection = factory.createFontCollection(["/fonts/segoeui.ttf"])

// create a text format
using format = factory.createTextFormat("Segoe UI", { fontSize: 24, fontCollection })
format.wordWrapping = DWRITE_WORD_WRAPPING.NO_WRAP;

// layout some text
using layout = factory.createTextLayout("Hello, world!", format, 500, 500);

// draw to a <canvas>!
const ctx = canvas.getContext("2d");
using renderer = new BasicTextRenderer(factory, canvas, ctx);
layout.draw(renderer, 0, 0);
```

## Using the module
- You will need to source a WebAssembly copy of DirectWriteCore, it is not included in this repository. It's also not that hard to find if you know where to look ;)
    - A tool to patch modules that don't directly export DWriteCoreCreateFactory is included in `tools/patch-exports.mjs`.
- The wrapper assumes this is a WASI module, so to use it in a browser you will need to provide an appropriate implementation. The Node wrappers handle this for you using `node:wasi`.
- This module makes extensive use of the [Explicit Resource Management](https://tc39.es/proposal-explicit-resource-management/) language feature, and is far easier to use with it, so modern versions of Node.js/Chrome/Firefox are required. At the time of writing WebKit does not appear to have support, so you'll need a shim (I heard the author of core-js is still looking for a good job).
- It **has** been tested in Node, Chrome and Firefox, + Safari with shims.
- It has **not** been tested in Bun or Deno, nor any other constrained environments (Cloudflare Workers, etc.).

## Mapping/Projection notes
- All interfaces have been flattened, i.e. `IDWriteFactory`, `IDWriteFactory1`, `IDWriteFactory2`... -> `IDWriteFactory`.
- All names are camelCase (i.e. `CreateRenderingParams` -> `createRenderingParams`).
- Plain GetXXX/SetXXX methods have become JS properties (i.e. `GetTextAlignment`/`SetTextAlignment` -> `textAlignment`).
- Out parameters become returns, failure HRESULTs become exceptions.

## What's added?
- Helpers for writing to `<canvas>`, including raw text, layouts and outlines.
- GeometrySink wraps `ID2D1SimplifiedGeometrySink`, buffering geometry in a format that can be replayed to a `<canvas>` drawing context.
- There's a number of helper functions scattered throughout that make common situations easier e.g. getting pixel buffers.

## What's missing?
- COLRv1 paint tree enumeration (`IDWritePaintReader`).
- GDI interop (duh).
    - With that said, `IDWriteGdiInterop.createBitmapRenderTarget()` is functional and [works as described for POSIX platforms](https://learn.microsoft.com/en-us/windows/win32/directwrite/dwritecore-overview#drawing-glyphs-to-a-system-memory-bitmap).
- Direct2D (duh).
- PANOSE isn't mapped very nicely

## What's untested?
- Remote font loaders.

# Examples
These examples should give you an idea of how DirectWrite gets projected, [for more detail and sample code, see the official docs.](https://learn.microsoft.com/en-us/windows/win32/DirectWrite/direct-write-portal)

### Setup (Node.js)
```ts
// loads the WebAssembly from wasmPath, binds local folders to make them visible to DirectWrite.
// in this case `./fonts` on the host becomes `/fonts` in WASM
const { abi } = await loadNode({ wasmPath: "/path/to/webassembly.wasm", preopens: { "/fonts": "./fonts" } })

// create a factory, used to create all other DirectWrite objects
using factory = DWriteCoreCreateFactory(abi)
```


### Setup (Browser)
```ts
// example using browser_wasi_shim
import { WASI, File, OpenFile, ConsoleStdout, PreopenDirectory } from "@bjorn3/browser_wasi_shim";

// fetch our WASM and a font to render with
const [wasm, font] = await Promise.all([
    fetch("/assets/webassembly.wasm"),
    fetch("/assets/googlesansflex.ttf").then(t => t.arrayBuffer()) 
])

let fds = [
    new OpenFile(new File([])),
    ConsoleStdout.lineBuffered(msg => console.log(`[WASI stdout] ${msg}`)),
    ConsoleStdout.lineBuffered(msg => console.warn(`[WASI stderr] ${msg}`)),
    new PreopenDirectory('/fonts', new Map([
        // seed the /fonts folder with our downloaded ttf
        ["googlesansflex.ttf", new File(font)],
    ]))
]

// create a WASI instance, and pass it to loadBrowser
const wasi = new WASI([], [], fds);
const { abi } = await loadBrowser({
    wasm,
    wasiImport: wasi.wasiImport,
    initialize(instance) {
        wasi.start(instance)
    }
})

// create a factory, used to create all other DirectWrite objects
using factory = DWriteCoreCreateFactory(abi)
```

### COM
```ts
// get the system font collection, which in WASM is typically 0 fonts
const collection = factory.getSystemFontCollection();
collection.addRef();  // ref++
collection.release(); // ref--
collection.release(); // free

// `using` automatically calls `release` when object leaves scope
using collection = factory.getSystemFontCollection(); 
```

### Layout
```ts
// create a text format (combo font + size + properties)
using format = factory.createTextFormat("Segoe UI", { fontSize: 16, fontCollection });

// create a layout, max width/height, shaping
using layout = factory.createTextLayout("Hello, world!", format, 400, 200);

// set some range properties
layout.setFontWeight(DWRITE_FONT_WEIGHT.BOLD, { startPosition: 0, length: 5 });
layout.setUnderline(true, { startPosition: 7, length: 5 });

// draw!
const ctx = canvas.getContext("2d");
using renderer = new BasicTextRenderer(factory, canvas, ctx);
layout.draw(renderer, 0, 0);
```

### Layout (Emoji fallback)
```ts
// load an appropriate set of fonts, in this case Segoe UI and Segoe UI Emoji
using collection = factory.createFontCollection(["/fonts/segoeui.ttf", "/fonts/seguiemj.ttf"]);

// helper to create a fallback that covers the entire emoji range
using fallback = factory.createEmojiFontFallback(collection, "Segoe UI Emoji"); 

using format = factory.createTextFormat("Segoe UI", { fontSize: 24, fontCollection: collection });
using layout = factory.createTextLayout("Hi there 👋! We can mix emoji and text 🎉", format, 400, 100);

// specify the fallback on the layout
layout.fontFallback = fallback;

// draw!
const ctx = canvas.getContext("2d");
using renderer = new BasicTextRenderer(factory, canvas, ctx, { colorGlyphs: true });
layout.draw(renderer, 0, 0);
```

### Rendering options (aliased text)
```ts
// custom render parameters allow us to specify rendering modes
using params = factory.createCustomRenderingParams({ renderingMode: DWRITE_RENDERING_MODE.ALIASED });

// creating a GDI compatible layout snaps to the pixel grid, meaning aliased text can still look okay
// test with a font like Times New Roman or Comic Sans MS
using layout = factory.createGdiCompatibleTextLayout(
  "This string is nice, small, and aliased, but perfectly legible because DirectWrite understands how to hint these shitty old fonts!",
  body, 520, 160, 1, false,
);

// pass `params` to the renderer so it's used when drawing!!
const ctx = canvas.getContext("2d");
using renderer = new BasicTextRenderer(factory, canvas, ctx, { renderingParams: params });
layout.draw(renderer, 10, 10);
```

## Codegen
Most wrappers are generated from dwrite_*.h in the Windows SDK, these generated wrappers are committed here so this project can be built on Mac and Linux without messing with the SDK/MinGW/whatever, they shouldn't be modified manually.