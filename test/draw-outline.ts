// Glyph OUTLINES as vector paths. IDWriteFontFace::GetGlyphRunOutline streams the run's contours
// into a JS-implemented ID2D1SimplifiedGeometrySink (GeometrySink); we replay them onto a Canvas
// 2D path and fill + stroke. This exercises the COM-callback-into-JS path in the *outline*
// direction (vs DWriteTextRenderer's bitmap direction), and the by-pointer D2D1_POINT_2F ABI.
import { createCanvas } from "@napi-rs/canvas";
import { snapshot } from "./harness.js";
import { loadNode } from "../src/host/node.js";
import { DWriteCoreCreateFactory } from "../src/index.js";
import { GeometrySink } from "../src/util/geometry-sink.js";

const { abi } = await loadNode({ wasmPath: "./linelayout-core.patched.wasm" });
using factory = DWriteCoreCreateFactory(abi);
using face = factory.loadFontFace("/local/fonts/arial.ttf");

const text = "Outline";
const emSize = 220;
const fm = face.getMetrics();
const scale = emSize / fm.designUnitsPerEm;

const cps = [...text].map((c) => c.codePointAt(0)!);
const gids = face.getGlyphIndices(cps);
// Advances position successive glyphs along the baseline (design units -> DIPs).
const advances = face.getDesignGlyphMetrics(gids).map((g) => g.advanceWidth * scale);

using sink = new GeometrySink(abi);
face.getGlyphRunOutline(emSize, gids, sink, { glyphAdvances: advances });

const b = sink.bounds();
if (!b) throw new Error("no outline produced");
console.log(`figures=${sink.figures.length} fillMode=${sink.fillMode}`);
console.log(`bounds x[${b.minX.toFixed(1)}..${b.maxX.toFixed(1)}] y[${b.minY.toFixed(1)}..${b.maxY.toFixed(1)}]`);

// Sanity: the outline must live in a sane DIP range (roughly the em box), not garbage. A
// mis-read by-value POINT_2F (e.g. treating the enum arg as a coordinate) would blow these up.
// GetGlyphRunOutline emits in DIPs with the baseline at y=0 and Y pointing DOWN (same convention
// as the rest of DWrite), so above-baseline geometry has NEGATIVE y; -minY ~= cap/ascent height.
const cap = fm.capHeight * scale;
const aboveBaseline = -b.minY;
if (!(aboveBaseline > cap * 0.5 && aboveBaseline < emSize * 1.5 && b.maxX > emSize * 0.5))
  throw new Error(`outline bounds look wrong (maxX=${b.maxX}, aboveBaseline=${aboveBaseline}, cap=${cap})`);

const margin = 24;
const W = Math.ceil(b.maxX - Math.min(0, b.minX)) + margin * 2;
const H = Math.ceil(emSize) + margin * 2;
const baselineY = margin + fm.ascent * scale;
const originX = margin - Math.min(0, b.minX);

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#0e1116";
ctx.fillRect(0, 0, W, H);

// Build the path from the collected contours. Outline space is already Y-down with the baseline
// at 0, so we just translate by the baseline origin (no Y flip).
ctx.beginPath();
sink.replay(ctx, (x, y) => [originX + x, baselineY + y]);

const grad = ctx.createLinearGradient(0, margin, 0, margin + emSize);
grad.addColorStop(0, "#7ad1ff");
grad.addColorStop(1, "#a26bff");
ctx.fillStyle = grad;
(ctx as unknown as { fill(rule: string): void }).fill(sink.fillMode); // nonzero winding for glyphs
ctx.lineJoin = "round";
ctx.lineWidth = 2;
ctx.strokeStyle = "#ffffff";
ctx.stroke();

await snapshot("outline", canvas.toBuffer("image/png"));
