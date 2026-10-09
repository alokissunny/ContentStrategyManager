"""Render carousel slide HTML files to PNG images with headless Chromium.

Primary renderer for the `carousel` skill. Each `slide-*.html` file in the
input directory is loaded at the target platform's pixel dimensions and
screenshotted to a numbered PNG. Rendering is deterministic - the same HTML/CSS
always produces identical pixels, with no cloud service or account required.

Every render is validated: each slide is audited for clipped text, text running
off the slide, overlapping text, and low-contrast text. `render()` returns a
`RenderResult` carrying both the PNG paths and any `SlideIssue`s found; the CLI
exits non-zero when a blocking issue is present. Pass `validate=False` /
`--skip-validation` to skip the audit.

Usage:
    python render_carousel.py --slides ./slides --out ./out --platform linkedin
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path

from platforms import PLATFORMS, get_platform
from validate_carousel import (
    SlideIssue,
    audit_slide,
    blocking_issues,
    format_report,
)

DEFAULT_SCALE = 2


@dataclass(frozen=True)
class RenderResult:
    """The outcome of a render: the PNGs written and any audit issues."""

    slides: list[Path] = field(default_factory=list)
    issues: list[SlideIssue] = field(default_factory=list)


def discover_slides(slides_dir: Path | str) -> list[Path]:
    """Return sorted slide-*.html files; raise if the directory has none."""
    slides = sorted(Path(slides_dir).glob("slide-*.html"))
    if not slides:
        raise FileNotFoundError(
            f"No slide-*.html files found in {slides_dir}"
        )
    return slides


def render(
    slides_dir: Path | str,
    out_dir: Path | str,
    platform: str,
    aspect: str | None = None,
    scale: int = DEFAULT_SCALE,
    validate: bool = True,
) -> RenderResult:
    """Render every slide HTML file to a numbered PNG.

    Args:
        slides_dir: Directory holding slide-*.html files.
        out_dir: Directory to write slide-NN.png files into (created if absent).
        platform: Target platform name (linkedin, instagram, x, facebook).
        aspect: Optional aspect-ratio override, e.g. "1:1", "4:5", "16:9".
        scale: Pixel-density multiplier; 2 yields crisp, retina-quality output.
        validate: When True, audit every slide for clipped / off-slide /
            overlapping / low-contrast text. The PNGs are written regardless;
            issues are reported on the result for the caller to act on.

    Returns:
        A RenderResult with the written PNG paths and any SlideIssues found.
    """
    spec = get_platform(platform)
    width, height = spec.dimensions(aspect)
    slides = discover_slides(slides_dir)
    if len(slides) > spec.max_slides:
        raise ValueError(
            f"{len(slides)} slides exceeds the max of {spec.max_slides} "
            f"for {spec.name}"
        )

    out_path = Path(out_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Imported lazily so platform/slide validation errors surface without
    # paying the cost of starting Playwright.
    from playwright.sync_api import sync_playwright

    written: list[Path] = []
    issues: list[SlideIssue] = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(
            viewport={"width": width, "height": height},
            device_scale_factor=scale,
        )
        try:
            for index, slide in enumerate(slides, start=1):
                page.goto(slide.resolve().as_uri(), wait_until="networkidle")
                page.evaluate("document.fonts.ready")  # wait for web fonts
                if validate:
                    issues.extend(audit_slide(page, slide.name))
                target = out_path / f"slide-{index:02d}.png"
                page.screenshot(path=str(target))
                written.append(target)
        finally:
            browser.close()

    return RenderResult(slides=written, issues=issues)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render carousel slide HTML files to numbered PNGs."
    )
    parser.add_argument(
        "--slides", required=True, type=Path,
        help="Directory containing slide-*.html files",
    )
    parser.add_argument(
        "--out", required=True, type=Path,
        help="Output directory for slide-NN.png files",
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
        "--scale", type=int, default=DEFAULT_SCALE,
        help=f"Pixel-density multiplier (default {DEFAULT_SCALE})",
    )
    parser.add_argument(
        "--skip-validation", action="store_true",
        help="Render without auditing slides for clipped / off-slide / "
             "overlapping / low-contrast text",
    )
    parser.add_argument(
        "--strict", action="store_true",
        help="Treat low-contrast warnings as blocking errors",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    result = render(
        args.slides, args.out, args.platform, args.aspect, args.scale,
        validate=not args.skip_validation,
    )
    for path in result.slides:
        print(f"  rendered {path}")
    print(f"{len(result.slides)} slide(s) -> {args.out}")

    if not args.skip_validation:
        print()
        print(format_report(result.issues, strict=args.strict))
        if blocking_issues(result.issues, strict=args.strict):
            print()
            print(
                "Carousel NOT finalised - fix the blocking issues above and "
                "re-render. (--skip-validation bypasses these checks.)"
            )
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
