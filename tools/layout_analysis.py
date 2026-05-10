#!/usr/bin/env python3
"""Analyse text-block layouts for QR label legibility.

Compute font size, character width, area utilization, and legibility
for every (format, font, size) combination.

Formats tested:
  2/2   — 2 rows, 2 chars each  (4 chars total)
  3/3   — 2 rows, 3 chars each  (6 chars total)
  4/4   — 2 rows, 4 chars each  (8 chars total)
  3/3/3 — 3 rows, 3 chars each  (9 chars total)
  4/4/4 — 3 rows, 4 chars each  (12 chars total)
  5/5/4 — 3 rows, 5+5+4 chars  (14 chars total)

Fonts compared (monospace, ranked by x-height/cap-height ratio):
  Courier New — baseline, widely available
  Consolas    — higher x-height, heavier strokes
  SF Mono     — macOS native, good small-size legibility
  IBM Plex Mono — designed for small print legibility
  Roboto Mono — Android/Linux native, uniform weight

Size tiers: 4, 5, 6, 7, 8, 10, 12, 15 mm (short side of text square)
"""
from __future__ import annotations
import math
from pathlib import Path

# --- Font metrics (approximate, from actual font file measurements) ---
# xh_cap: x-height / cap-height ratio (higher = more legible at small sizes)
# char_w_ratio: average character width / font size (lower = more chars fit)
# These are measured from the actual TTF/OTF glyph bounding boxes.
FONTS = {
    "Courier New":  {"xh_cap": 0.52, "char_w_ratio": 0.62, "family": "Courier New, Courier, monospace"},
    "Consolas":     {"xh_cap": 0.56, "char_w_ratio": 0.55, "family": "Consolas, monospace"},
    "SF Mono":      {"xh_cap": 0.55, "char_w_ratio": 0.53, "family": "SF Mono, Menlo, monospace"},
    "IBM Plex Mono":{"xh_cap": 0.54, "char_w_ratio": 0.54, "family": "IBM Plex Mono, monospace"},
    "Roboto Mono":  {"xh_cap": 0.55, "char_w_ratio": 0.52, "family": "Roboto Mono, monospace"},
}

# --- Formats: name → [chars_per_row, ...] ---
FORMATS = {
    "2/2":   [2, 2],
    "3/3":   [3, 3],
    "4/4":   [4, 4],
    "3/3/3": [3, 3, 3],
    "4/4/4": [4, 4, 4],
    "5/5/4": [5, 5, 4],
}

# --- Size tiers (mm) — short side of the text square ---
SIZE_TIERS = [4, 5, 6, 7, 8, 10, 12, 15]

# --- Legibility thresholds (mm font size) ---
# Based on Brother thermal printer specs + human visual acuity at arm's length
LEGIBILITY_TIERS = {
    "print-floor": 1.0,   # absolute minimum for thermal print
    "readable":    1.3,   # can be read without magnification
    "comfortable": 1.8,   # comfortable at arm's length
    "easy":        2.5,   # no effort needed
}


def compute_metrics(size_mm: float, chars_per_row: list[int], font_name: str) -> dict:
    """Compute layout metrics for one (size, format, font) combo.

    Vertical fit:
      inner_h = size * 0.92  (from label.py, 4% margin)
      n_rows * font + (n_rows - 1) * gap = inner_h
      gap = 0.2 * font
      → font = inner_h / (n_rows + 0.2 * (n_rows - 1))

    Horizontal fit:
      char_w ≈ font * char_w_ratio  (monospace average)
      max_chars_per_row = inner_w / char_w

    Utilization:
      glyph_area = total_chars * font * char_w
      square_area = size * size
      utilization = glyph_area / square_area
    """
    n_rows = len(chars_per_row)
    max_chars = max(chars_per_row)
    total_chars = sum(chars_per_row)
    fi = FONTS[font_name]

    inner_h = size_mm * 0.92
    inner_w = size_mm * 0.92

    # Font size from vertical constraint
    denom = n_rows + 0.2 * (n_rows - 1)
    font_mm = inner_h / denom

    # Char width from font + font-specific ratio
    char_w = font_mm * fi["char_w_ratio"]

    # How many chars fit horizontally
    chars_fit_w = inner_w / char_w if char_w > 0 else float("inf")
    fits_horizontally = chars_fit_w >= max_chars

    # Area utilization
    glyph_area = total_chars * font_mm * char_w
    square_area = size_mm * size_mm
    utilization = glyph_area / square_area if square_area > 0 else 0

    # Legibility
    legible = {
        tier: font_mm >= thresh
        for tier, thresh in LEGIBILITY_TIERS.items()
    }

    return {
        "size": size_mm,
        "n_rows": n_rows,
        "total_chars": total_chars,
        "font_mm": round(font_mm, 2),
        "char_w": round(char_w, 3),
        "chars_fit_w": round(chars_fit_w, 1),
        "fits": fits_horizontally,
        "util": round(utilization, 3),
        "legible": legible,
    }


def format_legible(legible: dict) -> str:
    """Format legibility tiers as a compact string."""
    parts = []
    for tier in LEGIBILITY_TIERS:
        symbol = "✓" if legible[tier] else "✗"
        parts.append(f"{symbol}{tier[0]}")
    return " ".join(parts)


def print_tables():
    """Print markdown tables grouped by format."""
    print("# Label Text Layout Analysis\n")
    print("## Legend")
    print("Legibility: ✓F=print-floor(≥1.0mm) ✓R=readable(≥1.3mm) ✓C=comfortable(≥1.8mm) ✓E=easy(≥2.5mm)\n")

    for fmt_name, chars_per_row in FORMATS.items():
        total = sum(chars_per_row)
        print(f"## Format `{fmt_name}` — {len(chars_per_row)} rows, {total} chars total\n")

        # Header
        header = (
            f"| Size | Font | font_mm | char_w | max_fit | Fits | Util | "
            f"F R C E |"
        )
        sep = f"|------|------|--------:|-------:|-------:|:----:|-----:|:-----|"
        print(header)
        print(sep)

        for size in SIZE_TIERS:
            for font_name in FONTS:
                m = compute_metrics(size, chars_per_row, font_name)
                fits_mark = "✓" if m["fits"] else "✗"
                leg = format_legible(m["legible"])
                print(
                    f"| {m['size']:>2} | {font_name:<11} | {m['font_mm']:>5.2f} | "
                    f"{m['char_w']:>5.3f} | {m['chars_fit_w']:>5.1f} | {fits_mark} | "
                    f"{m['util']:>4.3f} | {leg} |"
                )
        print()


def suggest_layout(size_mm: float, canonical_len: int = 14):
    """Suggest the best layout for a given size and canonical length."""
    print(f"\n## Suggested layouts for size={size_mm}mm, canonical={canonical_len} chars\n")

    candidates = []
    for fmt_name, chars_per_row in FORMATS.items():
        total = sum(chars_per_row)
        if total > canonical_len:
            continue  # too many chars for this canonical length

        best_font = None
        best_score = -999
        for font_name in FONTS:
            m = compute_metrics(size_mm, chars_per_row, font_name)
            if not m["fits"]:
                continue
            # Score: prefer bigger font (legibility) then higher xh_cap ratio
            score = m["font_mm"] * FONTS[font_name]["xh_cap"]
            if score > best_score:
                best_score = score
                best_font = font_name

        if best_font:
            m = compute_metrics(size_mm, chars_per_row, best_font)
            candidates.append((fmt_name, best_font, m, best_score))

    if not candidates:
        print("  No fitting layout found.")
        return

    # Sort by score descending
    candidates.sort(key=lambda x: x[3], reverse=True)
    print(f"  {'Rank':<5} {'Format':<8} {'Font':<12} {'font_mm':>7} {'Util':>6} {'F R C E':>8}")
    print(f"  {'-'*5} {'-'*8} {'-'*12} {'-'*7} {'-'*6} {'-'*8}")
    for i, (fmt, font, m, score) in enumerate(candidates, 1):
        leg = format_legible(m["legible"])
        print(
            f"  {i:<5} {fmt:<8} {font:<12} {m['font_mm']:>7.2f} "
            f"{m['util']:>6.3f} {leg:>8}"
        )


def render_comparison_svg():
    """Render a visual comparison: each format at size=8mm with best font."""
    size = 8.0
    sample_id = "K7M3PQ9RT5VAXY"  # 14 chars

    panel_w = 40
    panel_h = 42
    gap = 5
    n = len(FORMATS)

    svg_w = n * (panel_w + gap) + gap
    svg_h = panel_h + 10

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg"',
        f'  width="{svg_w}mm" height="{svg_h}mm"',
        f'  viewBox="0 0 {svg_w} {svg_h}">',
        '<style>',
        '  .title { font: 700 2.5mm sans-serif; fill: #222; }',
        '  .label { font: 600 1.8mm sans-serif; fill: #666; }',
        '  .meta  { font: 500 1.3mm sans-serif; fill: #999; }',
        '  .panel { fill: #fafafa; stroke: #ddd; stroke-width: 0.2; }',
        '</style>',
    ]

    # Title
    lines.append(
        f'<text x="{svg_w/2}" y="4" class="title" text-anchor="middle">'
        f'size=8mm format comparison</text>'
    )

    for i, (fmt_name, chars_per_row) in enumerate(FORMATS.items()):
        x = gap + i * (panel_w + gap)
        y = 7

        # Panel
        lines.append(
            f'<rect x="{x}" y="{y}" width="{panel_w}" height="{panel_h}" class="panel"/>'
        )

        # Format label
        lines.append(
            f'<text x="{x + panel_w/2}" y="{y + 3}" class="label" text-anchor="middle">'
            f'{fmt_name}</text>'
        )

        # Compute with Consolas (best overall)
        m = compute_metrics(size, chars_per_row, "Consolas")
        inner_h = size * 0.92
        n_rows = len(chars_per_row)
        denom = n_rows + 0.2 * (n_rows - 1)
        font_mm = inner_h / denom
        gap_mm = font_mm * 0.2

        cx = x + panel_w / 2
        y0 = y + (size - inner_h) / 2 + font_mm * 0.85

        # Text rows
        idx = 0
        for j, chars_in_row in enumerate(chars_per_row):
            row_text = sample_id[idx:idx + chars_in_row]
            ty = y0 + j * (font_mm + gap_mm)
            lines.append(
                f'<text x="{cx}" y="{ty}"'
                f' font-family="Consolas, monospace"'
                f' font-weight="bold" font-size="{font_mm:.3f}"'
                f' text-anchor="middle" fill="#000">{row_text}</text>'
            )
            idx += chars_in_row

        # Meta
        lines.append(
            f'<text x="{cx}" y="{y + panel_h - 1.5}" class="meta" text-anchor="middle">'
            f'font={m["font_mm"]}mm util={m["util"]}</text>'
        )

    lines.append('</svg>')
    return "\n".join(lines)


def render_font_comparison_svg():
    """Render a visual comparison: each font at size=6mm with 4/4 format."""
    size = 6.0
    sample_id = "K7M3PQ9RT5VA"  # 12 chars
    chars_per_row = [4, 4]  # 4/4

    panel_w = 35
    panel_h = 38
    gap = 5
    n = len(FONTS)

    svg_w = n * (panel_w + gap) + gap
    svg_h = panel_h + 10

    lines = [
        f'<svg xmlns="http://www.w3.org/2000/svg"',
        f'  width="{svg_w}mm" height="{svg_h}mm"',
        f'  viewBox="0 0 {svg_w} {svg_h}">',
        '<style>',
        '  .title { font: 700 2.5mm sans-serif; fill: #222; }',
        '  .label { font: 600 1.8mm sans-serif; fill: #666; }',
        '  .meta  { font: 500 1.3mm sans-serif; fill: #999; }',
        '  .panel { fill: #fafafa; stroke: #ddd; stroke-width: 0.2; }',
        '</style>',
    ]

    lines.append(
        f'<text x="{svg_w/2}" y="4" class="title" text-anchor="middle">'
        f'size=6mm 4/4 font comparison</text>'
    )

    for i, (font_name, fi) in enumerate(FONTS.items()):
        x = gap + i * (panel_w + gap)
        y = 7

        lines.append(
            f'<rect x="{x}" y="{y}" width="{panel_w}" height="{panel_h}" class="panel"/>'
        )

        lines.append(
            f'<text x="{x + panel_w/2}" y="{y + 3}" class="label" text-anchor="middle">'
            f'{font_name}</text>'
        )

        m = compute_metrics(size, chars_per_row, font_name)
        inner_h = size * 0.92
        n_rows = len(chars_per_row)
        denom = n_rows + 0.2 * (n_rows - 1)
        font_mm = inner_h / denom
        gap_mm = font_mm * 0.2

        cx = x + panel_w / 2
        y0 = y + (size - inner_h) / 2 + font_mm * 0.85

        rows = [sample_id[0:4], sample_id[4:8]]
        for j, row in enumerate(rows):
            ty = y0 + j * (font_mm + gap_mm)
            lines.append(
                f'<text x="{cx}" y="{ty}"'
                f' font-family="{fi["family"]}"'
                f' font-weight="bold" font-size="{font_mm:.3f}"'
                f' text-anchor="middle" fill="#000">{row}</text>'
            )

        lines.append(
            f'<text x="{cx}" y="{y + panel_h - 1.5}" class="meta" text-anchor="middle">'
            f'font={m["font_mm"]}mm util={m["util"]}</text>'
        )

    lines.append('</svg>')
    return "\n".join(lines)


if __name__ == "__main__":
    out_dir = Path(__file__).parent

    # Print tables to stdout
    print_tables()

    # Suggest best layouts for common sizes
    for size in [4, 5, 6, 7, 8, 10, 12]:
        suggest_layout(size, canonical_len=14)

    # Render visual comparisons
    svg1 = render_comparison_svg()
    (out_dir / "layout_format_compare_8mm.svg").write_text(svg1)
    print(f"\n📐 Format comparison → {out_dir / 'layout_format_compare_8mm.svg'}")

    svg2 = render_font_comparison_svg()
    (out_dir / "layout_font_compare_6mm.svg").write_text(svg2)
    print(f"📐 Font comparison  → {out_dir / 'layout_font_compare_6mm.svg'}")
