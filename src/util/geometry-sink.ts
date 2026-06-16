import type { Abi } from "../core/abi.js";
import { S_OK } from "../core/com.js";
import { ComObject, type ComInterfaceDescriptor } from "../core/com-object.js";
import { IID_IUnknown, IID_ID2D1SimplifiedGeometrySink } from "../core/iids.js";
import { I32, type TrampolineSig } from "../core/trampoline.js";

// ID2D1SimplifiedGeometrySink
const METHODS: TrampolineSig[] = [
  { params: [I32, I32, I32], result: I32 },     // 0 QueryInterface
  { params: [I32], result: I32 },               // 1 AddRef
  { params: [I32], result: I32 },               // 2 Release
  { params: [I32, I32], result: null },         // 3 SetFillMode(D2D1_FILL_MODE)
  { params: [I32, I32], result: null },         // 4 SetSegmentFlags(D2D1_PATH_SEGMENT)
  { params: [I32, I32, I32], result: null },    // 5 BeginFigure(POINT_2F*, D2D1_FIGURE_BEGIN)
  { params: [I32, I32, I32], result: null },    // 6 AddLines(POINT_2F*, UINT32)
  { params: [I32, I32, I32], result: null },    // 7 AddBeziers(BEZIER_SEGMENT*, UINT32)
  { params: [I32, I32], result: null },         // 8 EndFigure(D2D1_FIGURE_END)
  { params: [I32], result: I32 },               // 9 Close
];

const DESCRIPTOR: ComInterfaceDescriptor = {
  sigs: METHODS,
  iids: [IID_IUnknown, IID_ID2D1SimplifiedGeometrySink],
};

export interface CanvasPathLike {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void;
  closePath(): void;
}

export type Point = [number, number];
export interface Bezier { c1: Point; c2: Point; to: Point }

export interface OutlineFigure {
  start: Point;
  segments: ({ kind: "line"; to: Point } | { kind: "bezier"; c1: Point; c2: Point; to: Point })[];
  closed: boolean;
}

const FIGURE_END_CLOSED = 1;
const D2D1_FILL_MODE_WINDING = 1;

export abstract class GeometrySinkBase extends ComObject {
  constructor(abi: Abi) { super(abi, DESCRIPTOR); }

  protected onSetFillMode(_fillMode: "nonzero" | "evenodd"): void {}
  protected onBeginFigure(_start: Point): void {}
  protected onAddLines(_points: Point[]): void {}
  protected onAddBeziers(_beziers: Bezier[]): void {}
  protected onEndFigure(_closed: boolean): void {}

  private pt(p: number): Point {
    return [this.abi.readF32(p + 0), this.abi.readF32(p + 4)];
  }

  protected handlers(): Function[] {
    return [
      (_t: number, fillMode: number) => { this.onSetFillMode(fillMode === D2D1_FILL_MODE_WINDING ? "nonzero" : "evenodd"); },
      () => { /* SetSegmentFlags, unused for glyph fills */ },
      (_t: number, pointPtr: number, _figureBegin: number) => { this.onBeginFigure(this.pt(pointPtr)); },
      (_t: number, pointsPtr: number, count: number) => {
        const pts: Point[] = [];
        for (let i = 0; i < count; i++) pts.push(this.pt(pointsPtr + i * 8));
        this.onAddLines(pts);
      },
      (_t: number, beziersPtr: number, count: number) => {                     // D2D1_BEZIER_SEGMENT = 3 x POINT_2F (24 bytes)
        const bz: Bezier[] = [];
        for (let i = 0; i < count; i++) {
          const b = beziersPtr + i * 24;
          bz.push({ c1: this.pt(b), c2: this.pt(b + 8), to: this.pt(b + 16) });
        }
        this.onAddBeziers(bz);
      },
      (_t: number, figureEnd: number) => { this.onEndFigure(figureEnd === FIGURE_END_CLOSED); },
      () => S_OK,                                                             // Close
    ];
  }
}

export class GeometrySink extends GeometrySinkBase {
  readonly figures: OutlineFigure[] = [];
  fillMode: "nonzero" | "evenodd" = "nonzero";

  private current: OutlineFigure | null = null;

  protected override onSetFillMode(fillMode: "nonzero" | "evenodd"): void { this.fillMode = fillMode; }
  protected override onBeginFigure(start: Point): void {
    this.current = { start, segments: [], closed: false };
    this.figures.push(this.current);
  }
  protected override onAddLines(points: Point[]): void {
    for (const to of points) this.current?.segments.push({ kind: "line", to });
  }
  protected override onAddBeziers(beziers: Bezier[]): void {
    for (const b of beziers) this.current?.segments.push({ kind: "bezier", c1: b.c1, c2: b.c2, to: b.to });
  }
  protected override onEndFigure(closed: boolean): void {
    if (this.current) this.current.closed = closed;
    this.current = null;
  }

  replay(path: CanvasPathLike, transform: (x: number, y: number) => Point): void {
    for (const fig of this.figures) {
      path.moveTo(...transform(...fig.start));
      for (const seg of fig.segments) {
        if (seg.kind === "line") path.lineTo(...transform(...seg.to));
        else path.bezierCurveTo(...transform(...seg.c1), ...transform(...seg.c2), ...transform(...seg.to));
      }
      if (fig.closed) path.closePath();
    }
  }

  bounds(): { minX: number; minY: number; maxX: number; maxY: number } | null {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const acc = ([x, y]: Point) => { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); };
    for (const fig of this.figures) {
      acc(fig.start);
      for (const seg of fig.segments) {
        if (seg.kind === "line") acc(seg.to);
        else { acc(seg.c1); acc(seg.c2); acc(seg.to); }
      }
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }
}
