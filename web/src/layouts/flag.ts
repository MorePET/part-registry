// Flag layout: horz mirrored across a cable wrap zone. Folded around
// a cable to make a double-sided readable flag.

import type {
  Layout,
  LayoutDimensions,
  LayoutOptions,
  LayoutOptionField,
} from "../core/types";
import { qrBlock, svgWrap, textBlock } from "./svg";

const DEFAULT_CABLE_OD_MM = 6;

function cableOd(opts: LayoutOptions): number {
  const v = opts.extra?.cableOd;
  if (typeof v === "number" && v > 0) return v;
  return DEFAULT_CABLE_OD_MM;
}

export const flagLayout: Layout = {
  id: "flag",
  label: "Flag (cable wrap)",
  description:
    "Two horz halves mirrored across a wrap zone. Wraps around a cable so the flag is readable from both sides.",
  measure(opts: LayoutOptions): LayoutDimensions {
    const s = opts.size;
    const wrap = Math.PI * cableOd(opts) * 1.1;
    return { widthMm: 4 * s + wrap, heightMm: s };
  },
  renderSvg(canonical: string, opts: LayoutOptions): string {
    const s = opts.size;
    const od = cableOd(opts);
    const wrap = Math.PI * od * 1.1;
    const horzW = 2 * s;
    const W = 2 * horzW + wrap;
    const left =
      qrBlock(canonical, 0, 0, s) + "\n" + textBlock(canonical, s, 0, s);
    const rx = horzW + wrap;
    const right =
      textBlock(canonical, rx, 0, s) +
      "\n" +
      qrBlock(canonical, rx + s, 0, s);
    const wrapZone =
      `<rect x="${horzW.toFixed(3)}" y="0" width="${wrap.toFixed(3)}" height="${s.toFixed(3)}" ` +
      `fill="none" stroke="#888" stroke-width="0.1" stroke-dasharray="0.6,0.6"/>\n` +
      `<text x="${(horzW + wrap / 2).toFixed(3)}" y="${(s / 2 + 0.5).toFixed(3)}" ` +
      `font-family="Courier, monospace" font-size="1.5" text-anchor="middle" fill="#888">wrap d${od}</text>`;
    return svgWrap(W, s, [left, wrapZone, right].join("\n"));
  },
  optionFields(): LayoutOptionField[] {
    return [
      {
        key: "cableOd",
        label: "Cable OD (mm)",
        type: "number",
        default: DEFAULT_CABLE_OD_MM,
        min: 1,
        max: 50,
        step: 0.5,
      },
    ];
  },
};
