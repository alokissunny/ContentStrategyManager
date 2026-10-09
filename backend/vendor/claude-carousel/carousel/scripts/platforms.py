"""Platform specifications for social-media carousel posts.

Dimensions, slide limits and aspect ratios per platform. All carousels are
authored at 1080px width; height varies by aspect ratio. 4:5 (1080x1350) is
preferred on LinkedIn and Instagram because it claims more feed real estate.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class AspectRatio:
    """A named aspect ratio and its pixel dimensions at 1080px width."""

    label: str
    width: int
    height: int


@dataclass(frozen=True)
class PlatformSpec:
    """Carousel constraints for a single social platform."""

    name: str
    max_slides: int
    aspects: tuple[AspectRatio, ...]
    default_aspect: str

    def dimensions(self, aspect: str | None = None) -> tuple[int, int]:
        """Return (width, height) for the given aspect, or the default."""
        wanted = aspect or self.default_aspect
        for ratio in self.aspects:
            if ratio.label == wanted:
                return ratio.width, ratio.height
        supported = ", ".join(r.label for r in self.aspects)
        raise ValueError(
            f"Unsupported aspect '{wanted}' for {self.name}; supported: {supported}"
        )


_SQUARE = AspectRatio("1:1", 1080, 1080)
_PORTRAIT = AspectRatio("4:5", 1080, 1350)
_LANDSCAPE = AspectRatio("16:9", 1080, 608)

PLATFORMS: dict[str, PlatformSpec] = {
    "linkedin": PlatformSpec(
        name="linkedin",
        max_slides=20,
        aspects=(_PORTRAIT, _SQUARE),
        default_aspect="4:5",
    ),
    "instagram": PlatformSpec(
        name="instagram",
        max_slides=20,
        aspects=(_PORTRAIT, _SQUARE, _LANDSCAPE),
        default_aspect="4:5",
    ),
    "x": PlatformSpec(
        name="x",
        max_slides=4,
        aspects=(_SQUARE, _LANDSCAPE),
        default_aspect="1:1",
    ),
    "facebook": PlatformSpec(
        name="facebook",
        max_slides=10,
        aspects=(_SQUARE, _PORTRAIT),
        default_aspect="1:1",
    ),
}


def get_platform(name: str) -> PlatformSpec:
    """Look up a platform spec by name, case-insensitively."""
    spec = PLATFORMS.get(name.strip().lower())
    if spec is None:
        known = ", ".join(sorted(PLATFORMS))
        raise ValueError(f"Unknown platform '{name}'; known: {known}")
    return spec
