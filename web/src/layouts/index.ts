// Layout registry. Open/Closed: add a new layout file and register here.
//
// !!! DRIFT WARNING !!!
//
// These layouts are a TypeScript port of label.py. The Python module
// is the SSOT today (CLI tooling + tests live there). The intended
// long-term solution per ADR-013 is to load label.py via Pyodide so
// FE and CI run literally the same code. Until that lands, drift
// between this file and label.py is a real risk; the test_labels.py
// roundtrip is the canonical correctness gate, and any rule change
// here must be mirrored to label.py + retested.

import type { Layout } from "../core/types";
import { vertLayout } from "./vert";
import { horzLayout } from "./horz";
import { flagLayout } from "./flag";

const LAYOUTS: Record<string, Layout> = {};

export function registerLayout(layout: Layout): void {
  LAYOUTS[layout.id] = layout;
}

export function getLayout(id: string): Layout | undefined {
  return LAYOUTS[id];
}

export function allLayouts(): Layout[] {
  return Object.values(LAYOUTS);
}

// Bootstrap: register the built-in layouts.
registerLayout(vertLayout);
registerLayout(horzLayout);
registerLayout(flagLayout);
