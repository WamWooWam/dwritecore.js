// Higher-level helpers and JS-implementable interface bases (./util).
export { TextCanvas, type DrawTextOptions, type DrawOutlineOptions, type RGBA, type Context2DPathLike } from "./canvas.js";
export { TextRenderer, TextRendererBase, OutlineTextRenderer, GlyphRun, type RenderTarget, type OutlineSink } from "./text-renderer.js";
export { GeometrySink, GeometrySinkBase, type OutlineFigure, type CanvasPathLike, type Point, type Bezier } from "./geometry-sink.js";
export { FontFileLoaderBase } from "./font-file-loader.js";
export { FontDownloadListenerBase } from "./font-download-listener.js";
export { TextAnalysisSinkBase, type LineBreakpoint } from "./text-analysis-sink.js";
export { TextAnalysisSourceBase, type LocaleRun, type NumberSubstitutionRun } from "./text-analysis-source.js";

export { decodeShapingGlyphProperties, decodeShapingTextProperties } from "../interfaces/IDWriteTextAnalyzer.js";
