"""Tests for the carousel renderer (exercises real headless Chromium)."""
import struct
from pathlib import Path

import pytest

from render_carousel import discover_slides, render


def _png_dimensions(path: Path) -> tuple[int, int]:
    """Read width/height from a PNG file's IHDR chunk."""
    data = path.read_bytes()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG file"
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def _write_slide(directory: Path, index: int, color: str = "#1e1b4b") -> None:
    (directory / f"slide-{index:02d}.html").write_text(
        "<!doctype html><html><head><style>"
        "html,body{margin:0;padding:0}"
        f".slide{{width:100vw;height:100vh;background:{color};"
        "display:flex;align-items:center;justify-content:center;"
        "color:#fff;font-family:system-ui;font-size:64px}}"
        "</style></head><body>"
        f"<div class='slide'>Slide {index}</div></body></html>",
        encoding="utf-8",
    )


# A slide whose giant non-wrapping number runs off the right edge.
_BAD_SLIDE = (
    "<!doctype html><html><head><style>"
    "html,body{margin:0;padding:0}"
    ".slide{width:100vw;height:100vh;background:#fff;display:flex;"
    "align-items:center}"
    ".n{white-space:nowrap;font-size:220px;font-weight:900;color:#111;"
    "font-family:system-ui}"
    "</style></head><body><div class='slide'><div class='n'>1 : 196,375</div>"
    "</div></body></html>"
)


def test_discover_slides_sorted(tmp_path):
    for i in (3, 1, 2):
        _write_slide(tmp_path, i)
    found = discover_slides(tmp_path)
    assert [p.name for p in found] == [
        "slide-01.html",
        "slide-02.html",
        "slide-03.html",
    ]


def test_discover_slides_empty_raises(tmp_path):
    with pytest.raises(FileNotFoundError, match="slide-"):
        discover_slides(tmp_path)


def test_render_produces_png_at_platform_dimensions(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    _write_slide(slides_dir, 1)

    result = render(slides_dir, tmp_path / "out", platform="linkedin", scale=1)

    assert [p.name for p in result.slides] == ["slide-01.png"]
    assert _png_dimensions(result.slides[0]) == (1080, 1350)
    assert result.issues == []


def test_render_respects_scale(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    _write_slide(slides_dir, 1)

    result = render(slides_dir, tmp_path / "out", platform="x", scale=2)

    assert _png_dimensions(result.slides[0]) == (2160, 2160)


def test_render_numbers_multiple_slides(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    for i in (1, 2, 3):
        _write_slide(slides_dir, i)

    result = render(slides_dir, tmp_path / "out", platform="linkedin", scale=1)

    assert [p.name for p in result.slides] == [
        "slide-01.png",
        "slide-02.png",
        "slide-03.png",
    ]


def test_render_rejects_too_many_slides(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    for i in range(1, 6):  # 5 slides; X allows max 4
        _write_slide(slides_dir, i)
    with pytest.raises(ValueError, match="max"):
        render(slides_dir, tmp_path / "out", platform="x")


def test_render_reports_a_validation_error(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    (slides_dir / "slide-01.html").write_text(_BAD_SLIDE, encoding="utf-8")

    result = render(slides_dir, tmp_path / "out", platform="linkedin", scale=1)

    assert any(i.severity == "error" for i in result.issues)
    # The PNG is still written so the bad slide can be inspected.
    assert (tmp_path / "out" / "slide-01.png").exists()


def test_skip_validation_reports_no_issues(tmp_path):
    slides_dir = tmp_path / "slides"
    slides_dir.mkdir()
    (slides_dir / "slide-01.html").write_text(_BAD_SLIDE, encoding="utf-8")

    result = render(
        slides_dir, tmp_path / "out", platform="linkedin",
        scale=1, validate=False,
    )

    assert [p.name for p in result.slides] == ["slide-01.png"]
    assert result.issues == []
