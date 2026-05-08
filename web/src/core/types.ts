// Core extension interfaces.
//
// SOLID — Open/Closed: new tabs, layouts, and plugins are added by
// implementing these interfaces and registering. The core never needs
// to know about them.
//
// SOLID — Interface Segregation: each interface is the smallest set of
// methods needed for that role. A Plugin doesn't know about layouts; a
// Layout doesn't know about tabs.

import type { Registry } from "../registry/registry";

export interface AppContext {
  registry: Registry;
  // Future: auth provider, settings store, plugin host, etc.
}

// ---------- Tab ----------
//
// A tab is a top-level navigation target. Implementations are
// registered in src/tabs/index.ts.

export interface Tab {
  readonly id: string;
  readonly label: string;
  /** Render into the given container. Called once when the tab is shown. */
  mount(container: HTMLElement, ctx: AppContext): void | Promise<void>;
  /** Optional cleanup — called when the tab is hidden. */
  unmount?(): void;
}

// ---------- Layout ----------
//
// A label layout is a recipe for arranging the QR + 4/4/4 text blocks
// at a given size. Implementations registered in src/layouts/index.ts.
//
// Adding a new layout (e.g. a circular tag) = new file, register, done.

export interface LayoutOptions {
  size: number; // mm of short side
  // Layout-specific options live in the variant tagged by `layout`
  // (e.g. cableOd for flag). Kept open via `extra` to avoid a closed
  // discriminated union the core has to know about.
  extra?: Record<string, unknown>;
}

export interface LayoutDimensions {
  widthMm: number;
  heightMm: number;
}

export interface Layout {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  /** Compute the (w, h) without rendering, for print page sizing. */
  measure(opts: LayoutOptions): LayoutDimensions;
  /** Render an SVG string for the given canonical ID. mm-native. */
  renderSvg(canonical: string, opts: LayoutOptions): string;
  /** Optional: extra form fields the Print tab should expose for this layout. */
  optionFields?(): LayoutOptionField[];
}

export interface LayoutOptionField {
  key: string;
  label: string;
  type: "number";
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

// ---------- Plugin ----------
//
// A plugin attaches to the running app — toolbar buttons, observers,
// modal launchers, etc. — without being a tab. Error reporting,
// keyboard shortcut registries, future telemetry hooks all fit here.

export interface Plugin {
  readonly id: string;
  install(host: PluginHost, ctx: AppContext): void;
  uninstall?(): void;
}

export interface PluginHost {
  /** Add a button to the global toolbar (top-right). */
  addToolbarButton(spec: ToolbarButtonSpec): () => void;
  /** Display a transient toast message (info / error). */
  toast(message: string, kind?: "info" | "error"): void;
}

export interface ToolbarButtonSpec {
  id: string;
  label: string;
  title?: string;
  onClick: () => void | Promise<void>;
}
