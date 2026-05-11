#!/usr/bin/env python3
"""Render SVG labels for IDs already in the registry.

A label is two equal-size square blocks: QR + text.

    vert  — QR on top of text   (size × 2*size, aspect 1:2)
    horz  — QR left of text     (2*size × size, aspect 2:1)
    flag  — horz mirrored around a cable wrap zone

Pick which IDs to render with --id, --batch, or --status (combinable).
Pick geometry with --size <mm> or --tape pt-N.
Pick text format with --format (default: auto by size).

    uv run label.py --batch B-2026-05-sdmd --layout horz
    uv run label.py --id K7M3PQ9RT5VAXY --layout vert --size 8
    uv run label.py --status unbound --layout flag --size 11 --cable-od 6

See ADR-012 for the scheme.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import segno

PARTS_DIR = Path(__file__).resolve().parent
REGISTRY = PARTS_DIR / "registry.csv"
PRINT_LOG = PARTS_DIR / "print_log.csv"
LABELS_DIR = PARTS_DIR / "labels"

PRINT_LOG_FIELDS = [
    "id", "printed_at", "printed_by", "layout", "size_mm",
    "extra", "copies", "output_mode", "batch_label",
]

# Tape printable-height presets, in mm of short-side. Two families:
#
#   pt-N  — Brother P-touch (TZe tapes), e.g. PT-D series printers.
#           N = nominal tape width; printable ≈ tape × 0.75.
#   dk-N  — Brother QL DK continuous tapes, e.g. QL-820NWBc.
#           N = nominal tape width; printable ≈ tape × 0.85 (less margin).
#
# DK rolls used in the lab today:
#   DK-22214 (12 mm), DK-22210 (29 mm), DK-22225 (38 mm), DK-22205 (62 mm).
TAPE_SIZES = {
    "pt-9":  6.5,
    "pt-12": 9.0,
    "pt-18": 12.0,
    "pt-24": 18.0,
    "pt-36": 28.0,
    "dk-12": 10.0,
    "dk-29": 25.0,
    "dk-38": 33.0,
    "dk-62": 56.0,
}

DEFAULT_SIZE_MM = 11.0
# Standard QR uses a 4-module quiet zone; Micro QR specifies 2 (and most
# decoders honor it). We use the spec-mandated minimum per mode below.
QR_BORDER_STANDARD = 4
QR_BORDER_MICRO = 2
# Backwards-compat alias — older callers reference QR_BORDER_MODULES.
QR_BORDER_MODULES = QR_BORDER_STANDARD

# --- Text formats ---
# name → [chars_per_row, ...]
FORMATS = {
    "4/4":   [4, 4],       # 8 chars, 2 rows
    "4/4/4": [4, 4, 4],    # 12 chars, 3 rows
    "5/5/4": [5, 5, 4],    # 14 chars, 3 rows (full canonical)
}

# Font family string for SVG
FONT_FAMILY = "Consolas, monospace"


def split_format(canonical: str, fmt: str) -> tuple[str, ...]:
    """Split a canonical ID into rows for the given format."""
    chars_per_row = FORMATS[fmt]
    rows: list[str] = []
    idx = 0
    for n in chars_per_row:
        rows.append(canonical[idx:idx + n])
        idx += n
    return tuple(rows)


# ---------- SVG primitives (mm-native) ----------

def svg_wrap(w_mm: float, h_mm: float, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{w_mm:.3f}mm" height="{h_mm:.3f}mm" '
        f'viewBox="0 0 {w_mm:.3f} {h_mm:.3f}">\n'
        f'{body}\n</svg>\n'
    )


def qr_block(
    canonical: str, x: float, y: float, size: float,
    *, micro: bool = False, border: int | None = None,
) -> str:
    """Render the QR matrix into a `size × size` square.

    micro=False  → Standard QR (V1 for our payload, 21×21 modules,
                    4-module quiet zone, 29 modules per side total).
    micro=True   → Micro QR M4 (17×17 modules, 2-module quiet zone,
                    21 modules per side total ≈ 72 % of Standard linear,
                    52 % of Standard area).

    border=None  → spec quiet zone (4 for Standard, 2 for Micro).
    border=int   → override the quiet zone in modules. Going below spec
                    (e.g. 1 for Micro) grows the visible matrix at the
                    cost of scanner tolerance; safe when the surrounding
                    layout already provides external whitespace.

    Both modes use error correction "M" (~15 %). The 14-char alphanumeric
    payload fits Micro QR M4 at error M.
    """
    matrix = segno.make(canonical, error="m", micro=micro).matrix
    if border is None:
        border = QR_BORDER_MICRO if micro else QR_BORDER_STANDARD
    n_modules = len(matrix) + 2 * border
    module = size / n_modules
    rects = []
    for r, row in enumerate(matrix):
        for c, v in enumerate(row):
            if v:
                rx = x + (c + border) * module
                ry = y + (r + border) * module
                rects.append(
                    f'<rect x="{rx:.3f}" y="{ry:.3f}" '
                    f'width="{module:.3f}" height="{module:.3f}" fill="#000"/>'
                )
    return "\n".join(rects)


def text_block(canonical: str, x: float, y: float, size: float, *, fmt: str = "4/4/4") -> str:
    """Render human-readable text rows into a `size × size` square.

    Font size is computed from vertical constraint:
      inner_h = size * 0.92
      n_rows * font + (n_rows - 1) * 0.2 * font = inner_h
      → font = inner_h / (n_rows + 0.2 * (n_rows - 1))

    Consolas is true monospace at 0.55 advance ratio — 4/4 format
    fills the square exactly with zero horizontal margin.
    """
    rows = split_format(canonical, fmt)
    n_rows = len(rows)
    inner_h = size * 0.92
    font = inner_h / (n_rows + 0.2 * (n_rows - 1))
    gap = font * 0.2
    cx = x + size / 2
    y0 = y + (size - inner_h) / 2 + font * 0.85
    # font-weight only — no stroke. Stroke on small text rasterises with a
    # visible "second layer" anti-aliasing halo that looks like ghosted
    # text on print; better to lean on a larger glyph + bold weight than
    # to outline at sub-2 mm sizes.
    return "\n".join(
        f'<text x="{cx:.3f}" y="{y0 + i * (font + gap):.3f}" '
        f'font-family="{FONT_FAMILY}" '
        f'font-weight="bold" font-size="{font:.3f}" '
        f'text-anchor="middle" fill="#000">{row}</text>'
        for i, row in enumerate(rows)
    )


# ---------- Format auto-selection ----------

def recommend_format(size: float) -> tuple[str, str | None]:
    """Return (recommended_format, warning_or_none) for a given size.

    Recommendations based on measured legibility tiers (ADR-012):
      - < 8mm:  4/4  (2 rows, bigger font, reaches "easy" legibility)
      - >= 8mm, < 10mm: either is fine, default 4/4
      - >= 10mm: 4/4/4 or 5/5/4 (3 rows, more chars, still "comfortable"+)
    """
    if size < 8:
        warn = None
        if size < 5:
            warn = (
                "size < 5mm: even 4/4 font < 1.5mm (below 'readable'). "
                "Consider a larger label."
            )
        return "4/4", warn
    if size < 10:
        return "4/4", None
    return "4/4/4", None


def check_format_warning(size: float, fmt: str) -> str | None:
    """Return a warning string if the chosen format is sub-optimal for the size."""
    if size < 5 and fmt != "4/4":
        return (
            f"format {fmt} at {size}mm: font < 1.3mm (below 'readable'). "
            f"Use --format 4/4 for this size."
        )
    if 5 <= size < 8 and fmt != "4/4":
        return (
            f"format {fmt} at {size}mm: font < 1.9mm (below 'comfortable'). "
            f"Consider --format 4/4."
        )
    if size >= 10 and fmt == "4/4":
        return (
            f"format 4/4 at {size}mm: font > 4mm (overkill, wastes space). "
            f"Consider --format 4/4/4 or 5/5/4."
        )
    return None


# ---------- Layouts ----------

def render_vert(canonical: str, size: float, *, fmt: str = "4/4/4", micro: bool = False, border: int | None = None) -> str:
    body = (
        qr_block(canonical, 0, 0, size, micro=micro, border=border)
        + "\n"
        + text_block(canonical, 0, size, size, fmt=fmt)
    )
    return svg_wrap(size, 2 * size, body)


def render_horz(canonical: str, size: float, *, fmt: str = "4/4/4", micro: bool = False, border: int | None = None) -> str:
    body = (
        qr_block(canonical, 0, 0, size, micro=micro, border=border)
        + "\n"
        + text_block(canonical, size, 0, size, fmt=fmt)
    )
    return svg_wrap(2 * size, size, body)


def render_flag(canonical: str, size: float, cable_od_mm: float, *, fmt: str = "4/4/4", micro: bool = False, border: int | None = None) -> str:
    horz_w = 2 * size
    wrap_w = math.pi * cable_od_mm * 1.1
    W = 2 * horz_w + wrap_w
    left = (
        qr_block(canonical, 0, 0, size, micro=micro, border=border)
        + "\n"
        + text_block(canonical, size, 0, size, fmt=fmt)
    )
    rx = horz_w + wrap_w
    right = (
        text_block(canonical, rx, 0, size, fmt=fmt)
        + "\n"
        + qr_block(canonical, rx + size, 0, size, micro=micro, border=border)
    )
    wrap = (
        f'<rect x="{horz_w:.3f}" y="0" width="{wrap_w:.3f}" height="{size:.3f}" '
        f'fill="none" stroke="#888" stroke-width="0.1" stroke-dasharray="0.6,0.6"/>\n'
        f'<text x="{horz_w + wrap_w/2:.3f}" y="{size/2 + 0.5:.3f}" '
        f'font-family="monospace" font-size="1.5" '
        f'text-anchor="middle" fill="#888">wrap d{cable_od_mm:g}</text>'
    )
    return svg_wrap(W, size, "\n".join([left, wrap, right]))


def render(
    canonical: str,
    layout: str,
    size: float,
    cable_od_mm: float | None = None,
    *,
    fmt: str = "4/4/4",
    micro: bool = False,
    border: int | None = None,
) -> str:
    if layout == "vert":
        return render_vert(canonical, size, fmt=fmt, micro=micro, border=border)
    if layout == "horz":
        return render_horz(canonical, size, fmt=fmt, micro=micro, border=border)
    if layout == "flag":
        if cable_od_mm is None:
            sys.exit("--layout flag requires --cable-od <mm>")
        return render_flag(canonical, size, cable_od_mm, fmt=fmt, micro=micro, border=border)
    sys.exit(f"unknown layout: {layout}")


# ---------- Print event log ----------

def _layout_extra(layout: str, cable_od_mm: float | None) -> dict:
    """Layout-specific options that belong in the print_log `extra` column."""
    if layout == "flag" and cable_od_mm is not None:
        return {"cableOd": cable_od_mm}
    return {}


def append_print_events(
    ids: list[str],
    *,
    layout: str,
    size_mm: float,
    extra: dict,
    copies: int,
    output_mode: str,
    operator: str,
    batch_label: str,
    registry_ids: set[str],
) -> None:
    """Append one row per ID to print_log.csv and re-sort by printed_at.

    `copies` is logged as a single row per ID (not duplicated). FK to
    registry.csv is enforced softly: missing IDs warn to stderr but still
    log — the CI validator is the source of truth for orphan events.
    """
    printed_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    extra_str = json.dumps(extra, separators=(",", ":"), sort_keys=True)

    orphans = [i for i in ids if i not in registry_ids]
    if orphans:
        print(
            f"warning: {len(orphans)} id(s) logged but not in registry.csv "
            f"(FK orphans will be flagged by CI): {', '.join(orphans[:3])}"
            f"{'…' if len(orphans) > 3 else ''}",
            file=sys.stderr,
        )

    new_rows = [
        {
            "id": nid,
            "printed_at": printed_at,
            "printed_by": operator,
            "layout": layout,
            "size_mm": f"{size_mm:g}",
            "extra": extra_str,
            "copies": str(copies),
            "output_mode": output_mode,
            "batch_label": batch_label,
        }
        for nid in ids
    ]

    existing_rows: list[dict] = []
    if PRINT_LOG.exists() and PRINT_LOG.stat().st_size > 0:
        with PRINT_LOG.open() as f:
            existing_rows = list(csv.DictReader(f))

    all_rows = existing_rows + new_rows
    all_rows.sort(key=lambda r: r.get("printed_at", ""))

    with PRINT_LOG.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=PRINT_LOG_FIELDS, extrasaction="ignore")
        w.writeheader()
        for row in all_rows:
            w.writerow(row)


# ---------- ID selection ----------

def select_ids(
    rows: list[dict],
    explicit_ids: list[str] | None,
    batch: str | None,
    status: str | None,
) -> list[dict]:
    if not (explicit_ids or batch or status):
        sys.exit("specify at least one of --id, --batch, --status")

    selected = rows
    if explicit_ids:
        wanted = {i.upper().replace("-", "") for i in explicit_ids}
        selected = [r for r in selected if r["id"] in wanted]
        missing = wanted - {r["id"] for r in selected}
        if missing:
            sys.exit(f"unknown ID(s): {', '.join(sorted(missing))}")
    if batch:
        selected = [r for r in selected if r.get("batch") == batch]
    if status:
        selected = [r for r in selected if r.get("status") == status]
    return selected


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--id", action="append", dest="ids",
                    help="explicit ID (14-char). Repeat for multiple.")
    ap.add_argument("--batch", default=None, help="render every ID in this batch")
    ap.add_argument("--status", choices=["unbound", "bound", "void"], default=None,
                    help="render every ID with this status")
    ap.add_argument("--layout", choices=["vert", "horz", "flag"], default="horz")
    ap.add_argument("--size", type=float, default=None,
                    help=f"short-side size in mm (default {DEFAULT_SIZE_MM})")
    ap.add_argument("--tape", choices=list(TAPE_SIZES), default=None,
                    help="Brother P-touch tape preset (shorthand for --size)")
    ap.add_argument("--format", choices=["4/4", "4/4/4", "5/5/4", "auto"], default="auto",
                    help="text format (default: auto by size tier)")
    ap.add_argument("--cable-od", type=float, default=None,
                    help="cable outer diameter in mm (required for --layout flag)")
    ap.add_argument("--out-dir", type=Path, default=None,
                    help="output directory (default: labels/<descriptor>)")
    ap.add_argument("--copies", type=int, default=1,
                    help="copies per ID (recorded in print_log; default 1). "
                    "Does not duplicate rendered SVGs — handle copies at the "
                    "print queue. Only affects the event log row.")
    log_group = ap.add_mutually_exclusive_group()
    log_group.add_argument("--log", dest="log", action="store_true",
                           help="append a row per ID to print_log.csv after "
                           "rendering (default)")
    log_group.add_argument("--no-log", dest="log", action="store_false",
                           help="render only; do not append to print_log.csv")
    ap.set_defaults(log=True)
    ap.add_argument("--operator", default=os.getenv("USER", "unknown"),
                    help="operator name recorded in print_log.printed_by "
                    "(default: $USER, or 'unknown')")
    ap.add_argument("--output-mode", default="dk-continuous-auto-cut",
                    help="print pipeline descriptor recorded in "
                    "print_log.output_mode (default: dk-continuous-auto-cut)")
    micro_group = ap.add_mutually_exclusive_group()
    micro_group.add_argument(
        "--micro", dest="micro", action="store_true",
        help="encode the QR as Micro QR M4 (~52 %% area of Standard QR V1). "
        "Suitable for very small labels. Some older scanners don't decode "
        "Micro QR — verify with the operator's hardware before adopting.",
    )
    micro_group.add_argument(
        "--no-micro", dest="micro", action="store_false",
        help="encode the QR as Standard QR V1 (default; widest decoder support)",
    )
    ap.set_defaults(micro=False)
    args = ap.parse_args()

    if args.copies < 1:
        sys.exit("--copies must be >= 1")

    if args.tape and args.size is not None:
        sys.exit("use either --size or --tape, not both")
    size = TAPE_SIZES[args.tape] if args.tape else (args.size or DEFAULT_SIZE_MM)

    # Resolve format: auto-select by size, or use explicit choice
    if args.format == "auto":
        fmt, warn = recommend_format(size)
    else:
        fmt = args.format
        warn = check_format_warning(size, fmt)
    if warn:
        print(f"info: {warn}", file=sys.stderr)

    if not REGISTRY.exists():
        sys.exit(f"no registry at {REGISTRY} — mint some IDs first")
    with REGISTRY.open() as f:
        rows = list(csv.DictReader(f))

    selected = select_ids(rows, args.ids, args.batch, args.status)
    if not selected:
        sys.exit("no IDs matched the selection")

    if args.out_dir:
        out_dir = args.out_dir
    else:
        descriptor = args.batch or args.status or "ad-hoc"
        out_dir = LABELS_DIR / f"{descriptor}-{args.layout}-s{size:g}"
    out_dir.mkdir(parents=True, exist_ok=True)

    for row in selected:
        nid = row["id"]
        svg = render(nid, args.layout, size, args.cable_od, fmt=fmt, micro=args.micro)
        (out_dir / f"{nid}.svg").write_text(svg)

    if args.log:
        # batch_label: prefer explicit --batch, otherwise fall back to the
        # row's batch field if every selected row shares one batch (common
        # when selecting by --status or --id from a single batch).
        if args.batch:
            batch_label = args.batch
        else:
            batches = {r.get("batch") or "" for r in selected}
            batch_label = batches.pop() if len(batches) == 1 else ""
        append_print_events(
            [r["id"] for r in selected],
            layout=args.layout,
            size_mm=size,
            extra=_layout_extra(args.layout, args.cable_od),
            copies=args.copies,
            output_mode=args.output_mode,
            operator=args.operator,
            batch_label=batch_label,
            registry_ids={r["id"] for r in rows},
        )

    if args.layout == "vert":
        dim = f"{size:.1f} × {2 * size:.1f} mm"
    elif args.layout == "horz":
        dim = f"{2 * size:.1f} × {size:.1f} mm"
    else:
        wrap_w = math.pi * (args.cable_od or 0) * 1.1
        dim = f"{4 * size + wrap_w:.1f} × {size:.1f} mm (wrap {wrap_w:.1f})"
    print(f"rendered {len(selected)} labels  layout={args.layout} format={fmt}  ({dim})")
    print(f"  out: {out_dir}/")
    if args.log:
        print(f"  logged {len(selected)} print event(s) to {PRINT_LOG.name}")


if __name__ == "__main__":
    main()
