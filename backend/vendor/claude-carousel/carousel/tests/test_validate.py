"""Tests for the carousel layout/contrast validator (real headless Chromium).

Each fixture slide reproduces one real defect class seen in shipped carousels,
so the audit is exercised the way it runs in production.
"""
from pathlib import Path

import pytest

from validate_carousel import (
    SlideIssue,
    audit_slides,
    blocking_issues,
    format_report,
)

# A slide with no defects: readable white text, comfortably inside its box.
_CLEAN = """<!doctype html><html><head><style>
html,body{margin:0;padding:0}
.slide{box-sizing:border-box;width:100vw;height:100vh;background:#0b1020;
 display:flex;align-items:center;justify-content:center;
 color:#ffffff;font-family:system-ui;font-size:46px;padding:80px}
</style></head><body><div class="slide">Clean readable slide</div></body></html>"""

# Giant number in a fixed-width clipping box - the "1 : 196,375" bug.
_CLIPPED = """<!doctype html><html><head><style>
html,body{margin:0;padding:0}
.slide{width:100vw;height:100vh;background:#ffffff;
 display:flex;align-items:center;padding:0 60px;box-sizing:border-box}
.num{width:360px;overflow:hidden;white-space:nowrap;
 font-size:150px;font-weight:900;color:#111111;font-family:system-ui}
</style></head><body><div class="slide"><div class="num">1 : 196,375</div>
</div></body></html>"""

# Wide non-wrapping headline positioned so it runs off the right edge.
_OFF_SLIDE = """<!doctype html><html><head><style>
html,body{margin:0;padding:0}
.slide{position:relative;width:100vw;height:100vh;background:#ffffff}
.label{position:absolute;left:780px;top:200px;white-space:nowrap;
 font-size:64px;font-weight:800;color:#111111;font-family:system-ui}
</style></head><body><div class="slide">
<div class="label">331 dermatologists for everyone</div></div></body></html>"""

# Swipe cue drawn on top of the page indicator - the "SWIPE / 1/6" bug.
_OVERLAP = """<!doctype html><html><head><style>
html,body{margin:0;padding:0}
.slide{position:relative;width:100vw;height:100vh;background:#ffffff;
 font-family:system-ui}
.swipe{position:absolute;left:120px;top:160px;font-size:44px;
 font-weight:800;color:#111111}
.page{position:absolute;left:140px;top:172px;font-size:44px;
 font-weight:800;color:#111111}
</style></head><body><div class="slide">
<div class="swipe">SWIPE</div><div class="page">1 / 6</div></div></body></html>"""

# Grey text over a near-identical grey background - the "HPCSA REGISTER" bug.
# The background sits on the parent, the text on a leaf child, as in real
# carousels where text floats over a photo or coloured panel.
_LOW_CONTRAST = """<!doctype html><html><head><style>
html,body{margin:0;padding:0}
.slide{width:100vw;height:100vh;background:#9a9a9a;
 display:flex;align-items:center;justify-content:center}
.text{color:#8d8d8d;font-family:system-ui;font-size:30px}
</style></head><body><div class="slide">
<div class="text">HPCSA REGISTER 2026</div></div></body></html>"""


def _slide(directory: Path, html: str, index: int = 1) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"slide-{index:02d}.html").write_text(html, encoding="utf-8")


def test_clean_slide_has_no_issues(tmp_path):
    _slide(tmp_path, _CLEAN)
    assert audit_slides(tmp_path, "linkedin") == []


def test_detects_clipped_text(tmp_path):
    _slide(tmp_path, _CLIPPED)
    issues = audit_slides(tmp_path, "linkedin")
    assert any(i.kind == "clipped" and i.severity == "error" for i in issues)


def test_detects_text_running_off_the_slide(tmp_path):
    _slide(tmp_path, _OFF_SLIDE)
    issues = audit_slides(tmp_path, "linkedin")
    assert any(
        i.kind == "out-of-bounds" and i.severity == "error" for i in issues
    )


def test_detects_overlapping_text(tmp_path):
    _slide(tmp_path, _OVERLAP)
    issues = audit_slides(tmp_path, "linkedin")
    assert any(i.kind == "overlap" and i.severity == "error" for i in issues)


def test_detects_low_contrast_text(tmp_path):
    _slide(tmp_path, _LOW_CONTRAST)
    issues = audit_slides(tmp_path, "linkedin")
    assert any(i.kind == "low-contrast" for i in issues)


def test_unreadable_text_is_a_blocking_error(tmp_path):
    # Text the same colour as its background must block, not just warn.
    _slide(tmp_path, _LOW_CONTRAST)
    issues = audit_slides(tmp_path, "linkedin")
    assert blocking_issues(issues)


def test_issue_carries_slide_name(tmp_path):
    _slide(tmp_path, _OVERLAP, index=4)
    issues = audit_slides(tmp_path, "linkedin")
    assert issues
    assert all(i.slide == "slide-04.html" for i in issues)


def test_slide_issue_is_immutable():
    issue = SlideIssue(
        slide="slide-01.html", kind="clipped", selector=".num", detail="x"
    )
    with pytest.raises(Exception):  # frozen dataclass
        issue.kind = "overlap"


def test_blocking_issues_filters_by_severity():
    err = SlideIssue("s1", "overlap", ".a", "d", severity="error")
    warn = SlideIssue("s1", "low-contrast", ".b", "d", severity="warning")
    assert blocking_issues([err, warn]) == [err]
    assert blocking_issues([err, warn], strict=True) == [err, warn]


def test_format_report_passes_when_empty():
    assert "passed" in format_report([]).lower()


def test_format_report_lists_issues():
    issues = [
        SlideIssue("slide-02.html", "overlap", ".swipe", "70% covered"),
    ]
    report = format_report(issues)
    assert "slide-02.html" in report
    assert "70% covered" in report
