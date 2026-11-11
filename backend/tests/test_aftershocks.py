"""Omori-Utsu fitting, Poisson intervals and the retrospective forecast."""

from __future__ import annotations

import numpy as np
import pytest

from quakes.aftershocks import (
    GENERIC_C_DAYS,
    GENERIC_P,
    fit_omori,
    forecast,
    omori_integral,
    poisson_interval,
)
from quakes.models import FamilyEvent

MAINSHOCK = FamilyEvent(
    rid=1,
    event_id="x",
    time=0,
    latitude=0.0,
    longitude=0.0,
    depth_km=10.0,
    magnitude=7.5,
    place=None,
)


def omori_sample(n: int, p: float, c: float, t_end: float, seed: int = 0) -> np.ndarray:
    """Draw aftershock times on (0, t_end] from the Omori-Utsu density (inverse CDF)."""
    u = np.random.default_rng(seed).random(n)
    q = 1 - p
    lo, hi = c**q, (t_end + c) ** q
    return (lo + u * (hi - lo)) ** (1 / q) - c


@pytest.mark.parametrize("p", [0.8, 1.0, 1.3])
def test_integral_matches_numerical_quadrature(p: float) -> None:
    t = np.linspace(0.5, 40, 200_001)
    numeric = np.trapezoid((t + 0.1) ** -p, t)
    assert omori_integral(0.5, 40, 0.1, p) == pytest.approx(numeric, rel=1e-6)


def test_fit_recovers_parameters() -> None:
    times = omori_sample(4000, p=1.15, c=0.03, t_end=60)
    fit = fit_omori(times, 60)
    assert fit.method == "maximum-likelihood"
    assert fit.p == pytest.approx(1.15, abs=0.05)
    assert fit.c == pytest.approx(0.03, rel=0.35)
    # K is profiled out, so the fitted rate integrates back to the number of events.
    assert float(fit.expected(0, 60)) == pytest.approx(len(times))


def test_small_samples_fix_the_shape() -> None:
    fit = fit_omori([0.1, 0.5, 2.0, 4.0], 5)
    assert fit.method == "generic-shape"
    assert (fit.p, fit.c) == (GENERIC_P, GENERIC_C_DAYS)
    assert float(fit.expected(0, 5)) == pytest.approx(4)
    with pytest.raises(ValueError):
        fit_omori([0.1, 0.2], 5)


def test_poisson_interval() -> None:
    assert poisson_interval(0) == (0, 0)
    assert poisson_interval(10) == (4, 17)
    lo, hi = poisson_interval(10_000)
    assert lo == pytest.approx(10_000 - 196, abs=2) and hi == pytest.approx(10_000 + 196, abs=2)


def test_forecast_ok_is_continuous_at_the_fit_window() -> None:
    days = omori_sample(300, p=1.1, c=0.05, t_end=365, seed=3)
    result = forecast(
        MAINSHOCK, days, fit_days=7, horizon_days=365, available_days=1000, min_magnitude=4.5
    )
    assert result.status == "ok"
    n_fit = int((days <= 7).sum())
    assert result.n_fit == n_fit
    assert result.observed_after_fit == len(days) - n_fit
    at_fit = next(p for p in result.model if p.days == 7)
    assert at_fit.expected == pytest.approx(n_fit)
    after = [p for p in result.model if p.days > 7]
    assert all(p.lower <= p.expected <= p.upper for p in after)  # type: ignore[operator]
    assert after[-1].days == 365
    assert result.observed[-1].count == len(days)
    # The truth was drawn from the model family, so it should land inside the band.
    lo, hi = result.interval_after_fit  # type: ignore[misc]
    assert lo - 25 <= result.observed_after_fit <= hi + 25


def test_forecast_statuses() -> None:
    few = forecast(
        MAINSHOCK, [0.5, 10, 20], fit_days=3, horizon_days=30, available_days=100, min_magnitude=5
    )
    assert few.status == "too-few" and few.params is None
    assert "Only 1 aftershock " in (few.message or "")
    assert few.observed_after_fit == 2
    recent = forecast(
        MAINSHOCK, [0.1, 0.2, 0.3], fit_days=3, horizon_days=30, available_days=2, min_magnitude=5
    )
    assert recent.status == "too-recent"


def test_forecast_horizon_is_cut_at_the_catalog_end() -> None:
    days = omori_sample(200, p=1.1, c=0.05, t_end=50, seed=4)
    result = forecast(
        MAINSHOCK, days, fit_days=3, horizon_days=365, available_days=50, min_magnitude=5
    )
    assert result.horizon_days == 50
    assert any("catalog ends" in note for note in result.notes)
