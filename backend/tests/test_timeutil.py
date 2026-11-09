import numpy as np
import pytest

from quakes import timeutil


def _np_days(y: int, m: int, d: int) -> int:
    """Reference implementation: numpy datetime64 uses astronomical years too."""
    sign = "-" if y < 0 else ""
    return int(np.datetime64(f"{sign}{abs(y):04d}-{m:02d}-{d:02d}", "D").astype(np.int64))


def test_epoch_origin() -> None:
    assert int(timeutil.epoch_ms(1970, 1, 1)) == 0
    assert int(timeutil.epoch_ms(1970, 1, 1, 0, 0, 1.5)) == 1500


@pytest.mark.parametrize(
    ("y", "m", "d"),
    [
        (-2149, 1, 1),
        (-463, 7, 4),
        (0, 2, 29),
        (0, 3, 1),
        (1, 1, 1),
        (1600, 2, 29),
        (1900, 1, 1),
        (2000, 2, 29),
        (2011, 3, 11),
        (2100, 12, 31),
    ],
)
def test_days_from_civil_matches_numpy(y: int, m: int, d: int) -> None:
    assert int(timeutil.days_from_civil(y, m, d)) == _np_days(y, m, d)


def test_civil_roundtrip_vectorized() -> None:
    days = np.arange(-1_500_000, 200_000, 997, dtype=np.int64)
    y, m, d = timeutil.civil_from_days(days)
    assert np.array_equal(timeutil.days_from_civil(y, m, d), days)
    assert ((m >= 1) & (m <= 12)).all()
    assert ((d >= 1) & (d <= 31)).all()


def test_year_of_handles_bce_and_end_of_year() -> None:
    stamps = timeutil.epoch_ms(
        np.array([-463, 0, 1999]), np.array([1, 6, 12]), np.array([1, 1, 31]), 23, 59, 59
    )
    assert timeutil.year_of(stamps).tolist() == [-463, 0, 1999]


def test_cutoff_constant_is_1900() -> None:
    from quakes.config import SOURCE_CUTOFF_MS

    assert int(timeutil.epoch_ms(1900, 1, 1)) == SOURCE_CUTOFF_MS


def test_formatting() -> None:
    assert timeutil.format_year(2011) == "2011"
    assert timeutil.format_year(0) == "1 BCE"
    assert timeutil.format_year(-463) == "464 BCE"
    assert timeutil.format_time(0) == "1 Jan 1970, 00:00:00 UTC"
    t = int(timeutil.epoch_ms(2011, 3, 11, 5, 46, 24))
    assert timeutil.format_time(t) == "11 Mar 2011, 05:46:24 UTC"
    assert (
        timeutil.format_time(int(timeutil.epoch_ms(-463, 7, 4)), with_time=False) == "4 Jul 464 BCE"
    )
