// Horizontal layout: QR left, 4/4 right. 2*size × size.

import type { Layout, LayoutDimensions, LayoutOptions } from "../core/types";
import { qrBlock, svgWrap, textBlock } from "./svg";

export const horzLayout: Layout = {
  id: "horz",
  label: "Horizontal",
  description: "QR left of 4/4 text. Aspect 2:1. Default.",
  measure(opts: LayoutOptions): LayoutDimensions {
    return { widthMm: 2 * opts.size, heightMm: opts.size };
  },
  renderSvg(canonical: string, opts: LayoutOptions): string {
    const s = opts.size;
    const body =
      qrBlock(canonical, 0, 0, s) + "\n" + textBlock(canonical, s, 0, s);
    return svgWrap(2 * s, s, body);
  },
};
