"""Omori-Utsu aftershock decay: fit the first days of a sequence, forecast the rest.

The aftershock rate ``t`` days after a mainshock is modelled as::

    lambda(t) = K / (t + c)**p

(Utsu 1961; maximum-likelihood fitting after Ogata 1983). For fixed ``c`` and
``p`` the likelihood is maximised by ``K = n / integral(lambda / K)``, so the
fit searches ``(c, p)`` on a grid with ``K`` profiled out. With fewer than
:data:`MIN_FREE_FIT` aftershocks the decay shape cannot be pinned down, so
``p`` and ``c`` are fixed to the generic values of Reasenberg & Jones (1989)
and only the productivity ``K`` is fitted.

The forecast is retrospective: the fit only sees aftershocks up to the end of
the fitting window and is then compared with what the catalog recorded. Its
interval covers Poisson randomness only. Parameter uncertainty and secondary
bursts (which ETAS models describe) make real sequences more variable.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np
import numpy.typing as npt

from quakes.models import (
    AftershockForecast,
    CountPoint,
    FamilyEvent,
    ForecastPoint,
    OmoriParameters,
)

#: Below this many aftershocks in the fitting window, p and c are fixed.
MIN_FREE_FIT = 20
#: Fewest aftershocks the fit accepts at all.
MIN_FIT = 3
#: Reasenberg & Jones (1989) generic California values (c in days).
GENERIC_P = 1.08
GENERIC_C_DAYS = 0.05

_P_GRID = np.round(np.arange(0.5, 2.0001, 0.02), 4)
_LOG_C_GRID = np.round(np.arange(-3.0, 0.5001, 0.05), 4)

FloatArray = npt.NDArray[np.float64]


@dataclass(frozen=True)
class OmoriFit:
    k: float
    c: float
    p: float
    n: int
    t_end: float
    method: str
    log_likelihood: float

    def expected(self, a: npt.ArrayLike, b: npt.ArrayLike) -> FloatArray:
        """Expected number of aftershocks between ``a`` and ``b`` days."""
        return self.k * omori_integral(a, b, self.c, self.p)


def omori_integral(
    a: npt.ArrayLike, b: npt.ArrayLike, c: npt.ArrayLike, p: npt.ArrayLike
) -> FloatArray:
    """``integral_a^b (t + c)**-p dt`` (broadcasts over all arguments)."""
    a, b, c, p = (np.asarray(v, dtype=float) for v in (a, b, c, p))
    near_one = np.abs(p - 1.0) < 1e-9
    q = np.where(near_one, 2.0, 1.0 - p)  # placeholder exponent where p == 1
    power = ((b + c) ** q - (a + c) ** q) / q
    return np.where(near_one, np.log((b + c) / (a + c)), power)


def _profile(times: FloatArray, t_end: float, c: FloatArray, p: FloatArray) -> FloatArray:
    """Log-likelihood with K at its optimum, shape ``(len(p), len(c))``."""
    n = len(times)
    sum_log = np.log(times[:, None] + c[None, :]).sum(axis=0)  # depends on c only
    integral = omori_integral(0.0, t_end, c[None, :], p[:, None])
    return n * np.log(n / integral) - p[:, None] * sum_log[None, :] - n


def fit_omori(times_days: npt.ArrayLike, t_end: float) -> OmoriFit:
    """Maximum-likelihood Omori-Utsu fit to aftershock times in ``(0, t_end]`` days."""
    times = np.sort(np.asarray(times_days, dtype=float))
    times = times[(times > 0) & (times <= t_end)]
    n = len(times)
    if n < MIN_FIT:
        raise ValueError(f"need at least {MIN_FIT} aftershocks to fit, got {n}")
    if n < MIN_FREE_FIT:
        c, p = GENERIC_C_DAYS, GENERIC_P
        k = n / float(omori_integral(0.0, t_end, c, p))
        ll = float(_profile(times, t_end, np.array([c]), np.array([p]))[0, 0])
        return OmoriFit(k, c, p, n, t_end, "generic-shape", ll)

    ll = _profile(times, t_end, 10.0**_LOG_C_GRID, _P_GRID)
    ip, ic = np.unravel_index(int(np.nanargmax(ll)), ll.shape)
    # Refine around the coarse optimum.
    fine_log_c = np.linspace(_LOG_C_GRID[ic] - 0.05, _LOG_C_GRID[ic] + 0.05, 21)
    fine_p = np.linspace(_P_GRID[ip] - 0.02, _P_GRID[ip] + 0.02, 21)
    ll_fine = _profile(times, t_end, 10.0**fine_log_c, fine_p)
    jp, jc = np.unravel_index(int(np.nanargmax(ll_fine)), ll_fine.shape)
    c, p = float(10.0 ** fine_log_c[jc]), float(fine_p[jp])
    k = n / float(omori_integral(0.0, t_end, c, p))
    return OmoriFit(k, c, p, n, t_end, "maximum-likelihood", float(ll_fine[jp, jc]))


def _observed_curve(days: FloatArray, horizon: float, max_points: int = 400) -> list[CountPoint]:
    """Cumulative observed count at each aftershock (thinned to ``max_points``)."""
    inside = days[(days > 0) & (days <= horizon)]
    if len(inside) == 0:
        return []
    idx = np.unique(
        np.linspace(0, len(inside) - 1, min(len(inside), max_points)).round().astype(int)
    )
    return [CountPoint(days=round(float(inside[i]), 5), count=int(i + 1)) for i in idx]


def not_eligible(
    mainshock: FamilyEvent, fit_days: float, horizon_days: float, min_magnitude: float, reason: str
) -> AftershockForecast:
    return AftershockForecast(
        status="not-eligible",
        message=reason,
        mainshock=mainshock,
        fit_days=fit_days,
        horizon_days=horizon_days,
        min_magnitude=min_magnitude,
        params=None,
        n_fit=0,
        observed_after_fit=0,
        expected_after_fit=None,
        interval_after_fit=None,
        observed=[],
        model=[],
        notes=[],
    )


def forecast(
    mainshock: FamilyEvent,
    days: npt.ArrayLike,
    *,
    fit_days: float,
    horizon_days: float,
    available_days: float,
    min_magnitude: float,
) -> AftershockForecast:
    """Fit aftershock times (days after the mainshock) up to ``fit_days``, then forecast."""
    days = np.sort(np.asarray(days, dtype=float))
    horizon = min(horizon_days, available_days)
    notes = [
        f"Retrospective test: the model only sees aftershocks from the first {_days(fit_days)}.",
        f"Counts cover aftershocks of M {min_magnitude:.1f} and up, the catalog's floor. "
        "Catalogs miss many early aftershocks right after a large mainshock.",
    ]
    if horizon < horizon_days:
        notes.append(f"The catalog ends {_days(max(horizon, 0))} after this mainshock.")
    base = {
        "mainshock": mainshock,
        "fit_days": fit_days,
        "horizon_days": round(horizon, 4),
        "min_magnitude": min_magnitude,
        "observed": _observed_curve(days, max(horizon, fit_days)),
    }
    n_fit = int(((days > 0) & (days <= fit_days)).sum())
    if horizon <= fit_days:
        return AftershockForecast(
            status="too-recent",
            message="The catalog ends before the fitting window does; try a shorter window.",
            params=None,
            n_fit=n_fit,
            observed_after_fit=0,
            expected_after_fit=None,
            interval_after_fit=None,
            model=[],
            notes=notes,
            **base,
        )
    observed_after = int(((days > fit_days) & (days <= horizon)).sum())
    if n_fit < MIN_FIT:
        return AftershockForecast(
            status="too-few",
            message=(
                f"Only {n_fit} aftershock{'s' if n_fit != 1 else ''} of M {min_magnitude:.1f}+ "
                f"in the first {_days(fit_days)}, too few to fit. Try a longer window."
            ),
            params=None,
            n_fit=n_fit,
            observed_after_fit=observed_after,
            expected_after_fit=None,
            interval_after_fit=None,
            model=[],
            notes=notes,
            **base,
        )

    fit = fit_omori(days, fit_days)
    if fit.method == "generic-shape":
        notes.append(
            f"With fewer than {MIN_FREE_FIT} aftershocks to fit, the decay shape is fixed at "
            f"generic values (p = {GENERIC_P}, c = {GENERIC_C_DAYS} days; Reasenberg & Jones 1989) "
            "and only the productivity is fitted."
        )
    notes.append(
        "The 95% band covers Poisson randomness only, not parameter uncertainty or secondary "
        "sequences, so real outcomes vary more."
    )
    expected_after = float(fit.expected(fit_days, horizon))
    start = max(1e-3, min(0.01, float(days[days > 0][0]) if (days > 0).any() else 0.01))
    grid = np.unique(np.concatenate([np.geomspace(start, horizon, 140), [fit_days, horizon]]))
    model = []
    for tau in grid:
        if tau <= fit_days:
            model.append(
                ForecastPoint(days=round(float(tau), 5), expected=float(fit.expected(0, tau)))
            )
        else:
            increment = float(fit.expected(fit_days, tau))
            lo, hi = poisson_interval(increment)
            model.append(
                ForecastPoint(
                    days=round(float(tau), 5),
                    expected=n_fit + increment,
                    lower=float(n_fit + lo),
                    upper=float(n_fit + hi),
                )
            )
    return AftershockForecast(
        status="ok",
        message=None,
        params=OmoriParameters(k=fit.k, c_days=fit.c, p=fit.p, method=fit.method),
        n_fit=n_fit,
        observed_after_fit=observed_after,
        expected_after_fit=round(expected_after, 2),
        interval_after_fit=poisson_interval(expected_after),
        model=model,
        notes=notes,
        **base,
    )


def _days(value: float) -> str:
    if value < 1:
        hours = value * 24
        return f"{hours:.0f} hour{'s' if round(hours) != 1 else ''}"
    return f"{value:g} day{'s' if value != 1 else ''}"


def poisson_interval(mean: float, level: float = 0.95) -> tuple[int, int]:
    """Central ``level`` interval of a Poisson count with the given mean."""
    if mean <= 0:
        return 0, 0
    lo_q, hi_q = (1 - level) / 2, 1 - (1 - level) / 2
    if mean > 1000:  # normal approximation
        z = NormalDist().inv_cdf(hi_q)
        sd = math.sqrt(mean)
        return max(0, math.floor(mean - z * sd)), math.ceil(mean + z * sd)
    lo: int | None = None
    cdf, k, log_mean = 0.0, 0, math.log(mean)
    while True:
        cdf += math.exp(k * log_mean - mean - math.lgamma(k + 1))
        if lo is None and cdf >= lo_q:
            lo = k
        if cdf >= hi_q:
            return lo if lo is not None else 0, k
        k += 1
