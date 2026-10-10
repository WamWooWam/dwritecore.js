import type { CanvasPathLike } from "./geometry-sink.js";

export type RGBA = [r: number, g: number, b: number, a: number];

// minimal subset of CanvasRenderingContext2D
export interface ImageDataLike {
  readonly width: number;
  readonly height: number;
  data: { [i: number]: number; length: number, buffer: ArrayBufferLike }
}

export interface Context2DLike {
  createImageData(w: number, h: number): ImageDataLike;
  getImageData(x: number, y: number, w: number, h: number): ImageDataLike;
  putImageData(img: ImageDataLike, dx: number, dy: number): void;
  // Dirty-rectangle form: upload only [dirtyX,dirtyY,dirtyW,dirtyH] of `img`, letting a single large
  // reusable ImageData back many smaller tiles without re-uploading the whole buffer.
  putImageData(img: ImageDataLike, dx: number, dy: number, dirtyX: number, dirtyY: number, dirtyW: number, dirtyH: number): void;

  globalAlpha: number;
  globalCompositeOperation: string;

  fillStyle: string | unknown; // canvas gradient / pattern, or a CSS colour string
  fillRect(x: number, y: number, width: number, height: number): void;
  clearRect(x: number, y: number, width: number, height: number): void;

  drawImage(image: unknown, x: number, y: number): void;
  drawImage(image: unknown, x: number, y: number, w: number, h: number): void;
  drawImage(image: unknown, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;

  getTransform(): DOMMatrixLike;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  save(): void;
  restore(): void;
}

// Path/fill subset used by the outline renderers
export interface Context2DPathLike extends CanvasPathLike {
  beginPath(): void;
  fill(fillRule?: "nonzero" | "evenodd"): void;
  stroke(): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  fillStyle: string | unknown;
  strokeStyle: string | unknown;
  lineWidth: number;
}

export interface DrawableLike { width: number; height: number }

export interface OffscreenLike extends DrawableLike {
  getContext(type: "2d"): Context2DLike | null;
}
export type MakeOffscreen = (w: number, h: number) => OffscreenLike;

export interface DOMMatrixLike {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}
