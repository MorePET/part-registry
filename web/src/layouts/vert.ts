// Vertical layout: QR on top, 4/4 below. size × 2*size.

import type { Layout, LayoutDimensions, LayoutOptions } from "../core/types";
import { qrBlock, svgWrap, textBlock } from "./svg";

export const vertLayout: Layout = {
  id: "vert",
  label: "Vertical",
  description: "QR on top of 4/4 text. Aspect 1:2.",
  measure(opts: LayoutOptions): LayoutDimensions {
    return { widthMm: opts.size, heightMm: 2 * opts.size };
  },
  renderSvg(canonical: string, opts: LayoutOptions): string {
    const s = opts.size;
    const body =
      qrBlock(canonical, 0, 0, s) + "\n" + textBlock(canonical, 0, s, s);
    return svgWrap(s, 2 * s, body);
  },
};
