import { Guid } from "./guid.js";

// additional GUIDs required by but not defined in directwrite
export const IID_IUnknown = new Guid("00000000-0000-0000-c000-000000000046");
export const IID_ID2D1SimplifiedGeometrySink = new Guid("2cd9069e-12e2-11dc-9fed-001143a055f9");

export * from "./iids.g.js";
