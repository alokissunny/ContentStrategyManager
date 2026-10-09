"""Unit tests for the carousel platform specification module."""
import pytest

from platforms import PLATFORMS, get_platform


def test_all_four_platforms_registered():
    assert set(PLATFORMS) == {"linkedin", "instagram", "x", "facebook"}


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("linkedin", (1080, 1350)),   # 4:5 default
        ("instagram", (1080, 1350)),  # 4:5 default
        ("x", (1080, 1080)),          # 1:1 default
        ("facebook", (1080, 1080)),   # 1:1 default
    ],
)
def test_default_dimensions(name, expected):
    assert get_platform(name).dimensions() == expected


def test_aspect_override():
    assert get_platform("linkedin").dimensions("1:1") == (1080, 1080)
    assert get_platform("instagram").dimensions("16:9") == (1080, 608)


def test_unknown_platform_raises():
    with pytest.raises(ValueError, match="Unknown platform"):
        get_platform("tiktok")


def test_unsupported_aspect_raises():
    with pytest.raises(ValueError, match="aspect"):
        get_platform("x").dimensions("4:5")


@pytest.mark.parametrize(
    ("name", "max_slides"),
    [("linkedin", 20), ("instagram", 20), ("x", 4), ("facebook", 10)],
)
def test_max_slides(name, max_slides):
    assert get_platform(name).max_slides == max_slides


def test_platform_name_case_insensitive():
    assert get_platform("LinkedIn").name == "linkedin"
