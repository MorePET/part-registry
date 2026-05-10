"""Roundtrip test: QR payload === displayed text === canonical ID.

This is the critical invariant. If it ever fails, labels are useless —
the QR and the text would point to different parts.

    uv run pytest system-design/parts/test_labels.py -v
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import nanoid
import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from label import render  # noqa: E402

RSVG = shutil.which("rsvg-convert")
pytestmark = pytest.mark.skipif(
    RSVG is None, reason="rsvg-convert not on PATH (brew install librsvg)"
)

# Canonical 14-char alphabet (mirrors mint.py to avoid coupling).
ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
ID_LENGTH = 14

# Render fixture: use a stable ID so failures are reproducible. A second
# random ID per session catches any locality bias in encode/decode paths.
FIXED_ID = "K7M3PQ9RT5VAXY"


def random_id() -> str:
    return nanoid.generate(ALPHABET, ID_LENGTH)


def rasterize(svg: str, dpi: int = 600) -> np.ndarray:
    """SVG → grayscale numpy array via rsvg-convert."""
    proc = subprocess.run(
        [RSVG, "-d", str(dpi), "-p", str(dpi), "-b", "white", "-f", "png"],
        input=svg.encode(),
        capture_output=True,
        check=True,
    )
    arr = cv2.imdecode(np.frombuffer(proc.stdout, np.uint8), cv2.IMREAD_GRAYSCALE)
    assert arr is not None, "cv2 failed to decode rendered PNG"
    return arr


def decode_qr(svg: str) -> str:
    """Decode the QR from the rendered SVG. Returns payload string.

    Uses cv2's Aruco-based QR detector — more robust on small symbols
    than the legacy QRCodeDetector, which fails to even locate a 21×21
    QR rendered at typical label sizes.
    """
    arr = rasterize(svg)
    detector = cv2.QRCodeDetectorAruco()
    data, points, _ = detector.detectAndDecode(arr)
    assert points is not None and data, "cv2 found no QR in the rendered label"
    return data


_TEXT_RE = re.compile(r'<text[^>]*fill="#000"[^>]*>([^<]+)</text>')


def extract_text(svg: str) -> str:
    """Concatenate visible black <text> contents in document order.

    The wrap-zone label uses #888 (gray) and is excluded — only the
    actual ID rows are returned.
    """
    return "".join(_TEXT_RE.findall(svg))


# ---------- Tests ----------

LAYOUTS = [
    pytest.param("vert", None, 11.0, id="vert-s11"),
    pytest.param("vert", None,  6.0, id="vert-s6-sipm-tight"),
    pytest.param("vert", None,  8.0, id="vert-s8-sipm"),
    pytest.param("horz", None, 11.0, id="horz-s11"),
    pytest.param("horz", None,  9.0, id="horz-s9-pt12"),
    pytest.param("horz", None, 18.0, id="horz-s18-pt24"),
    pytest.param("flag", 4.0,  11.0, id="flag-d4-s11"),
    pytest.param("flag", 8.0,  11.0, id="flag-d8-s11"),
    pytest.param("flag", 12.0, 12.0, id="flag-d12-pt18"),
]


@pytest.fixture(scope="session")
def canonical_ids() -> list[str]:
    """Fixed ID (always tested) + one random per session."""
    return [FIXED_ID, random_id()]


@pytest.mark.parametrize("layout,cable_od,size", LAYOUTS)
def test_qr_decode_matches_canonical(canonical_ids, layout, cable_od, size):
    """QR payload === canonical ID, for every layout × representative size."""
    for canonical in canonical_ids:
        svg = render(canonical, layout, size, cable_od)
        decoded = decode_qr(svg)
        assert decoded == canonical, (
            f"QR mismatch for {canonical} in {layout}@{size}mm: "
            f"got {decoded!r}"
        )


@pytest.mark.parametrize("layout,cable_od,size", LAYOUTS)
def test_displayed_text_is_prefix(canonical_ids, layout, cable_od, size):
    """Visible text is a prefix of the canonical ID.

    The default format (4/4/4) shows 12 of 14 chars. 4/4 shows 8.
    The text is always a prefix of the canonical — never scrambled.
    Flag layout renders the text block twice (mirrored).
    """
    for canonical in canonical_ids:
        svg = render(canonical, layout, size, cable_od)
        displayed = extract_text(svg)
        # flag layout has the text block twice (mirrored)
        if layout == "flag":
            # displayed = prefix + prefix
            half = len(displayed) // 2
            prefix = displayed[:half]
            assert prefix == prefix, "always true, shape check"
            assert canonical.startswith(prefix), (
                f"Text prefix {prefix!r} not prefix of canonical {canonical!r} — {layout}@{size}mm"
            )
            assert displayed == prefix * 2, (
                f"Flag text not mirrored: {displayed!r} — {layout}@{size}mm"
            )
        else:
            prefix = displayed
            assert canonical.startswith(prefix), (
                f"Text {prefix!r} not prefix of canonical {canonical!r} — {layout}@{size}mm"
            )


@pytest.mark.parametrize("layout,cable_od,size", LAYOUTS)
def test_qr_payload_is_canonical(canonical_ids, layout, cable_od, size):
    """The actual invariant: scanning the QR gives you the full canonical
    ID. The displayed text may be a prefix, but QR is always complete."""
    for canonical in canonical_ids:
        svg = render(canonical, layout, size, cable_od)
        decoded = decode_qr(svg)
        assert decoded == canonical, (
            f"QR mismatch for {canonical} in {layout}@{size}mm: "
            f"got {decoded!r}"
        )
