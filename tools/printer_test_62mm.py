#!/usr/bin/env python3
"""Generate 62 mm continuous-tape test sheets for Brother QL raster/cut testing.

Brother QL DK-22205 (62 mm continuous tape). Each sheet packs labels
edge-to-edge across the full 62 mm tape width to test whether the
printer's raster actually reaches the physical edge, and to give a
clean grid for sanity-checking the cutter.

Three sheets, all at label size 7.75 mm short-side, format 4/4,
Micro QR M4 with a 1-module quiet zone (one below spec — the spec is
2 modules — but it grows the visible matrix ~10 % to 6.93 mm of the
7.75 mm cell, and adjacent labels in the packed grid still see a
2-module gap between matrices because both contribute their 1 module):

    test_4x1_horz   62 × 7.75 mm   4 horz labels (15.5 × 7.75) across × 1 row
    test_8x1_vert   62 × 15.5 mm   8 vert labels (7.75 × 15.5) across × 1 row
    test_8x2_vert   62 × 31.0 mm   8 vert × 2 rows (longer feed)

Sheet WIDTH = tape width (62 mm, cross-feed). Sheet HEIGHT = feed length.

IDs are deterministic-random — these are throwaway calibration prints,
not registry entries. Nothing is logged. Re-running with the same seed
produces byte-identical sheets.

    uv run tools/printer_test_62mm.py
    uv run tools/printer_test_62mm.py --out-dir /tmp/printer-test
"""
from __future__ import annotations

import argparse
import random
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from label import render  # noqa: E402

ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
ID_LENGTH = 14
TAPE_WIDTH_MM = 62.0
LABEL_SIZE_MM = 7.75      # short-side: vert → 7.75 × 15.5, horz → 15.5 × 7.75
FMT = "4/4"
QR_BORDER = 1             # Micro QR M4: spec is 2, we shave to 1 (see header)

_INNER_SVG_RE = re.compile(r"<svg[^>]*>(.*)</svg>", re.DOTALL)
RSVG = shutil.which("rsvg-convert")


def gen_ids(n: int, *, seed: int) -> list[str]:
    rng = random.Random(seed)
    return ["".join(rng.choices(ALPHABET, k=ID_LENGTH)) for _ in range(n)]


def strip_svg_wrapper(svg: str) -> str:
    m = _INNER_SVG_RE.search(svg)
    if not m:
        raise ValueError("expected <svg>…</svg> from label.render")
    return m.group(1).strip()


def compose_sheet(
    *,
    canvas_w: float,
    canvas_h: float,
    cols: int,
    rows: int,
    layout: str,
    size: float,
    ids: list[str],
    show_cell_lines: bool,
    micro: bool,
    border: int,
) -> str:
    if layout == "horz":
        label_w, label_h = 2 * size, size
    elif layout == "vert":
        label_w, label_h = size, 2 * size
    else:
        raise ValueError(f"unknown layout {layout}")

    cell_w = canvas_w / cols
    cell_h = canvas_h / rows

    parts: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{canvas_w}mm" height="{canvas_h}mm" '
        f'viewBox="0 0 {canvas_w} {canvas_h}">'
    ]

    # Faint outer border — useful to see whether the raster reaches the
    # physical edge of the tape on the printed output.
    parts.append(
        f'<rect x="0.05" y="0.05" '
        f'width="{canvas_w - 0.1}" height="{canvas_h - 0.1}" '
        f'fill="none" stroke="#bbb" stroke-width="0.1" stroke-dasharray="0.5,0.5"/>'
    )

    # Optional inter-cell guide lines (manual-cut references).
    if show_cell_lines:
        for c in range(1, cols):
            x = c * cell_w
            parts.append(
                f'<line x1="{x:.3f}" y1="0" x2="{x:.3f}" y2="{canvas_h}" '
                f'stroke="#ddd" stroke-width="0.05" stroke-dasharray="0.4,0.4"/>'
            )
        for r in range(1, rows):
            y = r * cell_h
            parts.append(
                f'<line x1="0" y1="{y:.3f}" x2="{canvas_w}" y2="{y:.3f}" '
                f'stroke="#ddd" stroke-width="0.05" stroke-dasharray="0.4,0.4"/>'
            )

    for i, canonical in enumerate(ids[:cols * rows]):
        col = i % cols
        row = i // cols
        cell_x = col * cell_w
        cell_y = row * cell_h
        ox = cell_x + (cell_w - label_w) / 2
        oy = cell_y + (cell_h - label_h) / 2
        inner = strip_svg_wrapper(
            render(canonical, layout, size, fmt=FMT, micro=micro, border=border)
        )
        parts.append(
            f'<g transform="translate({ox:.3f},{oy:.3f})">{inner}</g>'
        )

    parts.append("</svg>\n")
    return "\n".join(parts)


def convert(svg: Path, out: Path, *, fmt: str) -> None:
    if RSVG is None:
        sys.stderr.write(
            f"warning: rsvg-convert not on PATH; skipping {out.name} "
            "(brew install librsvg)\n"
        )
        return
    flags = ["-d", "300", "-p", "300", "-b", "white"] if fmt == "png" else ["-f", "pdf"]
    subprocess.run([RSVG, *flags, str(svg), "-o", str(out)], check=True)


CASES = [
    # name, cols, rows, layout, canvas_w, canvas_h
    ("test_4x1_horz", 4, 1, "horz", TAPE_WIDTH_MM, LABEL_SIZE_MM),
    ("test_8x1_vert", 8, 1, "vert", TAPE_WIDTH_MM, 2 * LABEL_SIZE_MM),
    ("test_8x2_vert", 8, 2, "vert", TAPE_WIDTH_MM, 2 * 2 * LABEL_SIZE_MM),
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--out-dir", type=Path,
        default=REPO_ROOT / "sheets" / "printer_test_62mm",
        help="output directory (default: sheets/printer_test_62mm/)",
    )
    ap.add_argument("--seed", type=int, default=20260511,
                    help="RNG seed for the test IDs (default 20260511)")
    ap.add_argument("--no-cell-lines", dest="cell_lines", action="store_false",
                    help="omit the inter-cell dashed guide lines")
    ap.add_argument("--no-micro", dest="micro", action="store_false",
                    help="use Standard QR V1 instead of Micro QR M4 "
                    "(default: Micro — bigger modules + less padding at this size)")
    ap.add_argument("--qr-border", type=int, default=QR_BORDER,
                    help=f"QR quiet-zone in modules (default {QR_BORDER}; "
                    "spec is 2 for Micro / 4 for Standard, lower = bigger "
                    "visible matrix at the cost of scanner tolerance)")
    ap.add_argument("--no-png", dest="png", action="store_false")
    ap.add_argument("--no-pdf", dest="pdf", action="store_false")
    ap.set_defaults(cell_lines=True, micro=True, png=True, pdf=True)
    args = ap.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)

    total = sum(cols * rows for _, cols, rows, *_ in CASES)
    ids_pool = gen_ids(total, seed=args.seed)

    qr_kind = "Micro QR M4" if args.micro else "Standard QR V1"
    print(f"composing {len(CASES)} test sheets "
          f"({total} unique IDs, seed={args.seed}, {qr_kind}, border={args.qr_border})")
    idx = 0
    for name, cols, rows, layout, w, h in CASES:
        n = cols * rows
        ids = ids_pool[idx:idx + n]
        idx += n
        svg = compose_sheet(
            canvas_w=w, canvas_h=h,
            cols=cols, rows=rows,
            layout=layout, size=LABEL_SIZE_MM,
            ids=ids,
            show_cell_lines=args.cell_lines,
            micro=args.micro,
            border=args.qr_border,
        )
        svg_path = args.out_dir / f"{name}.svg"
        svg_path.write_text(svg)
        if args.png:
            convert(svg_path, svg_path.with_suffix(".png"), fmt="png")
        if args.pdf:
            convert(svg_path, svg_path.with_suffix(".pdf"), fmt="pdf")
        print(f"  {name}  {cols}×{rows} {layout:4s}  {w:g}×{h:g} mm  ({n} labels)")

    print(f"out: {args.out_dir}/")


if __name__ == "__main__":
    main()
