"""Audit rendered carousel slides for layout, overlap and contrast defects.

A companion to ``render_carousel.py``. Each slide is loaded in headless
Chromium at the target platform's pixel dimensions and checked for four
defect classes that make a carousel unusable.

Issues carry a severity:

* ``error``   - an objective defect that blocks finalising the carousel:
  - ``clipped``       text is cut off by an ``overflow:hidden`` box
  - ``out-of-bounds`` a text element runs off the edge of the slide
  - ``overlap``       two text elements are drawn on top of each other
  - ``low-contrast``  (severe) text vanishes into its background - it drops
    below a legibility floor over a large part of its area
* ``warning`` - text that is below the WCAG AA contrast target but still
  legible (e.g. a brand accent colour). Reported, but does not block unless
  ``--strict`` is used.

Geometric checks are deterministic DOM measurements. The contrast check
samples the real rendered pixels behind each text element from a text-hidden
"background plate" screenshot, so it works over photos and gradients - with
no cloud service and no dependency beyond Playwright (the plate is downscaled
in-browser onto a small canvas; a ``data:`` URL does not taint the canvas).

Usage:
    python validate_carousel.py --slides ./slides --platform linkedin
"""
from __future__ import annotations

import argparse
import base64
import sys
from dataclasses import dataclass
from pathlib import Path

from platforms import PLATFORMS, get_platform

# Audit tunables - the single source of truth, passed into the in-page JS.
_OVERFLOW_TOLERANCE_PX = 1.5      # sub-pixel rounding slack
_OVERLAP_AREA_FRACTION = 0.25     # flag when >25% of the smaller text box is hit
_CONTRAST_GRID = 8                # background sampled on an 8x8 = 64-cell grid
_CONTRAST_SAMPLE_INSET = 0.15     # sample the inner 70% of each text box
_NORMAL_CONTRAST_RATIO = 4.5      # WCAG AA, normal text
_LARGE_CONTRAST_RATIO = 3.0       # WCAG AA, large text (>=24px, or >=18.66px bold)
_MIN_CONTRAST_FRACTION = 0.75     # >=75% must meet AA, else a warning
_VANISHING_CONTRAST_RATIO = 2.0   # text is effectively unreadable below this
_VANISHING_FRACTION = 0.25        # >25% vanishing -> a blocking error
_REDACTION_MAX_RATIO = 1.3        # text on a near-identical own bg = intentional

# Injected before the background-plate screenshot: hides every glyph while
# leaving layout, backgrounds, borders and images untouched.
_HIDE_TEXT_CSS = (
    "*, *::before, *::after {"
    " color: transparent !important;"
    " text-shadow: none !important;"
    " -webkit-text-fill-color: transparent !important;"
    " caret-color: transparent !important; }"
)

_KIND_LABELS = {
    "clipped": "Clipped text",
    "out-of-bounds": "Text off-slide",
    "overlap": "Overlapping text",
    "low-contrast": "Low contrast",
}


@dataclass(frozen=True)
class SlideIssue:
    """A single defect found on one slide."""

    slide: str                 # slide file name, e.g. "slide-03.html"
    kind: str                  # clipped | out-of-bounds | overlap | low-contrast
    selector: str              # CSS-ish path to the offending element
    detail: str                # human-readable description
    severity: str = "error"    # error (blocks) | warning (advisory)


def blocking_issues(
    issues: list[SlideIssue],
    strict: bool = False,
) -> list[SlideIssue]:
    """Return the issues that should stop a carousel being finalised.

    Errors always block. Warnings block only under ``strict``.
    """
    return [
        issue
        for issue in issues
        if issue.severity == "error" or (strict and issue.severity == "warning")
    ]


# --- in-page audit scripts -------------------------------------------------
#
# Shared JS helpers, declared inside each audit function so the whole script
# stays a single arrow-function expression that page.evaluate() accepts.

_JS_HELPERS = r"""
  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(part + '#' + node.id); break; }
      if (typeof node.className === 'string' && node.className.trim()) {
        part += '.' + node.className.trim().split(/\s+/).slice(0, 2).join('.');
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }
  function hasOwnText(el) {
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim()) return true;
    }
    return false;
  }
  function textElements() {
    return Array.from(document.body.querySelectorAll('*')).filter(function (el) {
      if (!hasOwnText(el)) return false;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      if (parseFloat(cs.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
  }
  function relLuminance(r, g, b) {
    const lin = function (c) {
      c /= 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }
  function contrastRatio(a, b) {
    const la = relLuminance(a[0], a[1], a[2]);
    const lb = relLuminance(b[0], b[1], b[2]);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }
  function parseRgb(text) {
    const m = text.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const n = m[1].split(',').map(function (x) { return parseFloat(x.trim()); });
    return { rgb: [n[0], n[1], n[2]], alpha: n.length > 3 ? n[3] : 1 };
  }
  function blend(fg, bg, a) {
    return [
      fg[0] * a + bg[0] * (1 - a),
      fg[1] * a + bg[1] * (1 - a),
      fg[2] * a + bg[2] * (1 - a),
    ];
  }
  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      const im = new Image();
      im.onload = function () { resolve(im); };
      im.onerror = function () {
        reject(new Error('background plate failed to load'));
      };
      im.src = src;
    });
  }
"""

# Measures clipping, out-of-bounds and text-on-text overlap from the DOM.
# Clipping fires only when the element itself clips (overflow hidden/clip);
# overflow:visible content spills but is not cut off, and running off the
# slide edge is caught separately by the out-of-bounds check.
_LAYOUT_AUDIT_JS = "(opts) => {" + _JS_HELPERS + r"""
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const tol = opts.tol;
  const issues = [];
  const els = textElements();

  for (const el of els) {
    const cs = getComputedStyle(el);
    if (cs.display !== 'inline') {
      const clipsX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
      const clipsY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
      if (clipsX && el.scrollWidth - el.clientWidth > tol) {
        issues.push({ kind: 'clipped', selector: cssPath(el),
          detail: 'text is ' + Math.round(el.scrollWidth - el.clientWidth)
            + 'px wider than its box and is being cut off' });
      }
      if (clipsY && el.scrollHeight - el.clientHeight > tol) {
        issues.push({ kind: 'clipped', selector: cssPath(el),
          detail: 'text is ' + Math.round(el.scrollHeight - el.clientHeight)
            + 'px taller than its box and is being cut off' });
      }
    }
    const r = el.getBoundingClientRect();
    const off = [];
    if (r.left < -tol) off.push(Math.round(-r.left) + 'px past the left edge');
    if (r.top < -tol) off.push(Math.round(-r.top) + 'px past the top edge');
    if (r.right > vw + tol)
      off.push(Math.round(r.right - vw) + 'px past the right edge');
    if (r.bottom > vh + tol)
      off.push(Math.round(r.bottom - vh) + 'px past the bottom edge');
    if (off.length) {
      issues.push({ kind: 'out-of-bounds', selector: cssPath(el),
        detail: 'text runs off the slide: ' + off.join(', ') });
    }
  }

  const boxes = els.map(function (el) {
    return { el: el, r: el.getBoundingClientRect() };
  });
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (ox <= 0 || oy <= 0) continue;
      const overlap = ox * oy;
      const smaller = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (smaller > 0 && overlap / smaller > opts.overlapFraction) {
        issues.push({ kind: 'overlap', selector: cssPath(a.el),
          detail: 'text box overlaps "' + cssPath(b.el) + '" - '
            + Math.round(100 * overlap / smaller)
            + '% of the smaller text box is covered' });
      }
    }
  }
  return issues;
}"""

# Samples the real rendered background behind each leaf text element (from the
# text-hidden plate) and checks WCAG contrast. Only leaf elements are sampled
# so a parent's box is never contaminated by a child with its own background.
_CONTRAST_AUDIT_JS = "async (opts) => {" + _JS_HELPERS + r"""
  const img = await loadImage(opts.dataUrl);
  const scale = img.width / window.innerWidth;
  const grid = opts.grid;
  const inset = opts.inset;
  const canvas = document.createElement('canvas');
  canvas.width = grid;
  canvas.height = grid;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const issues = [];

  const leaves = textElements().filter(function (el) {
    return el.children.length === 0;
  });

  for (const el of leaves) {
    const cs = getComputedStyle(el);
    const fg = parseRgb(cs.color);
    if (!fg || fg.alpha < 0.05) continue;

    // Skip deliberate concealment: text on a near-identical opaque own
    // background (e.g. a redaction bar).
    const ownBg = parseRgb(cs.backgroundColor);
    if (ownBg && ownBg.alpha > 0.95
        && contrastRatio(fg.rgb, ownBg.rgb) < opts.redactionMaxRatio) continue;

    const r = el.getBoundingClientRect();
    const sx = Math.max(0, (r.left + r.width * inset) * scale);
    const sy = Math.max(0, (r.top + r.height * inset) * scale);
    const sw = Math.min(img.width - sx, r.width * (1 - 2 * inset) * scale);
    const sh = Math.min(img.height - sy, r.height * (1 - 2 * inset) * scale);
    if (sw < 1 || sh < 1) continue;

    ctx.clearRect(0, 0, grid, grid);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, grid, grid);
    const data = ctx.getImageData(0, 0, grid, grid).data;

    const fontSize = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && weight >= 700);
    const needed = isLarge ? opts.largeRatio : opts.normalRatio;

    const n = grid * grid;
    let adequate = 0;
    let vanishing = 0;
    for (let i = 0; i < n; i++) {
      const bg = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
      const ratio = contrastRatio(blend(fg.rgb, bg, fg.alpha), bg);
      if (ratio >= needed) adequate++;
      if (ratio < opts.vanishingRatio) vanishing++;
    }
    if (vanishing / n > opts.vanishingFraction) {
      issues.push({ kind: 'low-contrast', severe: true, selector: cssPath(el),
        detail: 'text disappears into the background over '
          + Math.round(100 * vanishing / n)
          + '% of its area - it is too close in colour to read' });
    } else if (adequate / n < opts.minFraction) {
      issues.push({ kind: 'low-contrast', severe: false, selector: cssPath(el),
        detail: 'only ' + Math.round(100 * adequate / n)
          + '% of the text meets the ' + needed
          + ':1 WCAG AA contrast target' });
    }
  }
  return issues;
}"""


# --- audit API -------------------------------------------------------------


def audit_slide(page, slide_name: str = "") -> list[SlideIssue]:
    """Audit one already-loaded Playwright page; return any defects found.

    The page must already be navigated to the slide with its fonts ready. A
    text-hidden screenshot is taken to sample real background pixels for the
    contrast check; the page DOM is restored before this function returns, so
    the caller can safely screenshot the slide afterwards.
    """
    issues: list[SlideIssue] = []
    for item in page.evaluate(
        _LAYOUT_AUDIT_JS,
        {"tol": _OVERFLOW_TOLERANCE_PX, "overlapFraction": _OVERLAP_AREA_FRACTION},
    ):
        issues.append(
            SlideIssue(
                slide=slide_name,
                kind=item["kind"],
                selector=item["selector"],
                detail=item["detail"],
                severity="error",
            )
        )
    for item in _audit_contrast(page):
        issues.append(
            SlideIssue(
                slide=slide_name,
                kind=item["kind"],
                selector=item["selector"],
                detail=item["detail"],
                severity="error" if item.get("severe") else "warning",
            )
        )
    return issues


def _audit_contrast(page) -> list[dict]:
    """Screenshot the slide with text hidden, then sample its real background."""
    style = page.add_style_tag(content=_HIDE_TEXT_CSS)
    try:
        plate = page.screenshot()
    finally:
        style.evaluate("node => node.remove()")
    data_url = "data:image/png;base64," + base64.b64encode(plate).decode("ascii")
    return list(
        page.evaluate(
            _CONTRAST_AUDIT_JS,
            {
                "dataUrl": data_url,
                "grid": _CONTRAST_GRID,
                "inset": _CONTRAST_SAMPLE_INSET,
                "normalRatio": _NORMAL_CONTRAST_RATIO,
                "largeRatio": _LARGE_CONTRAST_RATIO,
                "minFraction": _MIN_CONTRAST_FRACTION,
                "vanishingRatio": _VANISHING_CONTRAST_RATIO,
                "vanishingFraction": _VANISHING_FRACTION,
                "redactionMaxRatio": _REDACTION_MAX_RATIO,
            },
        )
    )


def audit_slides(
    slides_dir: Path | str,
    platform: str,
    aspect: str | None = None,
) -> list[SlideIssue]:
    """Audit every slide-*.html file in a directory; return all defects found.

    Args:
        slides_dir: Directory holding slide-*.html files.
        platform: Target platform name (linkedin, instagram, x, facebook).
        aspect: Optional aspect-ratio override, e.g. "1:1", "4:5", "16:9".

    Returns:
        Every SlideIssue found, in slide then check order. Empty == clean.
    """
    spec = get_platform(platform)
    width, height = spec.dimensions(aspect)

    # Imported here, not at module scope, to avoid a render <-> validate cycle.
    from render_carousel import discover_slides

    slides = discover_slides(slides_dir)

    from playwright.sync_api import sync_playwright

    issues: list[SlideIssue] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": height})
        try:
            for slide in slides:
                page.goto(slide.resolve().as_uri(), wait_until="networkidle")
                page.evaluate("document.fonts.ready")
                issues.extend(audit_slide(page, slide.name))
        finally:
            browser.close()
    return issues


def format_report(issues: list[SlideIssue], strict: bool = False) -> str:
    """Render a human-readable audit report, errors first then warnings."""
    if not issues:
        return (
            "Carousel validation passed - no clipped, off-slide, "
            "overlapping, or unreadable text."
        )

    errors = [i for i in issues if i.severity == "error"]
    warnings = [i for i in issues if i.severity == "warning"]
    blocking = blocking_issues(issues, strict)

    headline = (
        f"Carousel validation FAILED - {len(blocking)} blocking issue(s)"
        if blocking
        else "Carousel validation passed with warnings"
    )
    lines = [headline, ""]

    def _section(title: str, group: list[SlideIssue]) -> None:
        if not group:
            return
        lines.append(f"{title} ({len(group)}):")
        by_slide: dict[str, list[SlideIssue]] = {}
        for issue in group:
            by_slide.setdefault(issue.slide, []).append(issue)
        for slide in sorted(by_slide):
            lines.append(f"  {slide or '(slide)'}")
            for issue in by_slide[slide]:
                label = _KIND_LABELS.get(issue.kind, issue.kind)
                lines.append(f"    [{label}]  {issue.selector}")
                lines.append(f"      {issue.detail}")
        lines.append("")

    _section("ERRORS - must fix before finalising", errors)
    warn_title = (
        "WARNINGS - blocking (--strict)" if strict
        else "WARNINGS - review, fix genuine readability problems"
    )
    _section(warn_title, warnings)
    return "\n".join(lines).rstrip()


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit carousel slides for clipped, off-slide, "
        "overlapping and low-contrast text."
    )
    parser.add_argument(
        "--slides", required=True, type=Path,
        help="Directory containing slide-*.html files",
    )
    parser.add_argument(
        "--platform", required=True, choices=sorted(PLATFORMS),
        help="Target social platform",
    )
    parser.add_argument(
        "--aspect", default=None,
        help="Aspect-ratio override, e.g. 1:1, 4:5, 16:9",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="Treat low-contrast warnings as blocking errors",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    issues = audit_slides(args.slides, args.platform, args.aspect)
    print(format_report(issues, strict=args.strict))
    return 1 if blocking_issues(issues, strict=args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
