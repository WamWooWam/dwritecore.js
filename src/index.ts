import type { Abi } from "./core/abi.js";
import { checkHr } from "./core/com.js";
import type { Guid } from "./core/guid.js";
import { IID_IDWriteFactory } from "./core/iids.js";
import { DWRITE_FACTORY_TYPE } from "./core/types.js";
import { IDWriteFactory } from "./interfaces/IDWriteFactory.js";

// com helpers
export type { Abi } from "./core/abi.js";
export { IUnknown, SUCCEEDED, FAILED, checkHr as check_hresult } from "./core/com.js";
export { Guid } from "./core/guid.js";
export * from "./core/types.js";
export * from "./core/iids.js";
export { ComObject, type ComInterfaceDescriptor } from "./core/com-object.js";
export type {
  DWRITE_COLOR_F, DWRITE_COLOR_GLYPH_RUN, DWRITE_COLOR_GLYPH_RUN1, DWRITE_GLYPH_IMAGE_DATA, Point2L,
} from "./core/structs.js";

// interfaces with additional helpers
export { IDWriteFactory } from "./interfaces/IDWriteFactory.js";
export { IDWriteBitmapRenderTarget } from "./interfaces/IDWriteBitmapRenderTarget.js";
export { IDWriteFontFallbackBuilder } from "./interfaces/IDWriteFontFallbackBuilder.js";
export { IDWriteGlyphRunAnalysis } from "./interfaces/IDWriteGlyphRunAnalysis.js";
export { IDWriteTextLayout } from "./interfaces/IDWriteTextLayout.js";
export { IDWriteFontCollection } from "./interfaces/IDWriteFontCollection.js";
export { IDWriteFontFile } from "./interfaces/IDWriteFontFile.js";
export { IDWriteFontFace } from "./interfaces/IDWriteFontFace.js";
export { IDWriteTextAnalyzer } from "./interfaces/IDWriteTextAnalyzer.js";
export { IDWriteColorGlyphRunEnumerator } from "./interfaces/IDWriteColorGlyphRunEnumerator.js";

// purely generated
export { IDWriteTextFormat } from "./interfaces/IDWriteTextFormat.g.js";
export { IDWriteFontFamily } from "./interfaces/IDWriteFontFamily.g.js";
export { IDWriteFont } from "./interfaces/IDWriteFont.g.js";
export { IDWriteFontList } from "./interfaces/IDWriteFontList.g.js";
export { IDWriteFontFaceReference } from "./interfaces/IDWriteFontFaceReference.g.js";
export { IDWriteTypography } from "./interfaces/IDWriteTypography.g.js";
export { IDWriteStringList } from "./interfaces/IDWriteStringList.g.js";
export { IDWriteFontDownloadQueue } from "./interfaces/IDWriteFontDownloadQueue.g.js";
export { IDWriteAsyncResult } from "./interfaces/IDWriteAsyncResult.g.js";
export { IDWriteLocalizedStrings } from "./interfaces/IDWriteLocalizedStrings.g.js";
export { IDWriteFontSetBuilder } from "./interfaces/IDWriteFontSetBuilder.g.js";
export { IDWriteFontFallback } from "./interfaces/IDWriteFontFallback.g.js";
export { IDWriteFontSet } from "./interfaces/IDWriteFontSet.g.js";
export { IDWriteFontResource } from "./interfaces/IDWriteFontResource.g.js";
export { IDWriteGdiInterop } from "./interfaces/IDWriteGdiInterop.g.js";
export { IDWriteRenderingParams } from "./interfaces/IDWriteRenderingParams.g.js";
export { IDWriteNumberSubstitution } from "./interfaces/IDWriteNumberSubstitution.g.js";
export { IDWriteInlineObject } from "./interfaces/IDWriteInlineObject.g.js";
export { IDWritePaintReader } from "./interfaces/IDWritePaintReader.g.js";
export { IDWriteFontFileLoader } from "./interfaces/IDWriteFontFileLoader.g.js";
export { IDWriteLocalFontFileLoader } from "./interfaces/IDWriteLocalFontFileLoader.g.js";
export { IDWriteInMemoryFontFileLoader } from "./interfaces/IDWriteInMemoryFontFileLoader.g.js";
export { IDWriteRemoteFontFileLoader } from "./interfaces/IDWriteRemoteFontFileLoader.g.js";
export { IDWriteFontFileStream } from "./interfaces/IDWriteFontFileStream.g.js";
export { IDWriteRemoteFontFileStream } from "./interfaces/IDWriteRemoteFontFileStream.g.js";
export { IDWriteFontFileEnumerator } from "./interfaces/IDWriteFontFileEnumerator.g.js";
export { IDWriteFontCollectionLoader } from "./interfaces/IDWriteFontCollectionLoader.g.js";
export { IDWriteFontDownloadListener } from "./interfaces/IDWriteFontDownloadListener.g.js";
export { IDWriteTextRenderer } from "./interfaces/IDWriteTextRenderer.g.js";
export { IDWritePixelSnapping } from "./interfaces/IDWritePixelSnapping.g.js";
export { IDWriteTextAnalysisSource } from "./interfaces/IDWriteTextAnalysisSource.g.js";
export { IDWriteTextAnalysisSink } from "./interfaces/IDWriteTextAnalysisSink.g.js";

// extra types
export type { CreateTextFormatOptions, CustomRenderingParamsOptions } from "./interfaces/IDWriteFactory.js";
export type { DrawGlyphRunOptions } from "./interfaces/IDWriteBitmapRenderTarget.js";
export type { FontFileAnalysis } from "./interfaces/IDWriteFontFile.js";
export type { AlphaTexture } from "./interfaces/IDWriteGlyphRunAnalysis.js";
export type { AddMappingOptions } from "./interfaces/IDWriteFontFallbackBuilder.js";
export type {
  ShapedGlyphs, GetGlyphsOptions, GlyphPlacements, GetGlyphPlacementsArgs,
  GetGdiCompatibleGlyphPlacementsArgs, ShapingGlyphProperties, ShapingTextProperties,
} from "./interfaces/IDWriteTextAnalyzer.js";
export type { GlyphImageData } from "./interfaces/IDWriteFontFace.js";


function DWriteCoreCreateFactory(abi: Abi, iid: Guid = IID_IDWriteFactory, factoryType: DWRITE_FACTORY_TYPE = DWRITE_FACTORY_TYPE.SHARED): IDWriteFactory {
  using s = abi.scope();
  const out = s.out();
  checkHr(abi.exports.DWriteCreateFactory(factoryType, iid.pin(abi), out), "DWriteCreateFactory");
  return IDWriteFactory.from(abi, abi.readPtr(out));
}

// :3
export { DWriteCoreCreateFactory };
export default DWriteCoreCreateFactory;