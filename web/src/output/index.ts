// OutputMode registry. Open/Closed: drop a new mode file and register
// here.
//
// Mirrors src/layouts/index.ts. The Print tab iterates `allOutputModes()`
// to build its paper-format selector and looks up the active mode by id.

import type { OutputMode } from "../core/types";
import { dkContinuousMode } from "./dk-continuous";
import { dk1201DiecutMode } from "./dk-1201-diecut";

const MODES: Record<string, OutputMode> = {};

export function registerOutputMode(mode: OutputMode): void {
  MODES[mode.id] = mode;
}

export function getOutputMode(id: string): OutputMode | undefined {
  return MODES[id];
}

export function allOutputModes(): OutputMode[] {
  return Object.values(MODES);
}

// Bootstrap.
registerOutputMode(dkContinuousMode);
registerOutputMode(dk1201DiecutMode);
