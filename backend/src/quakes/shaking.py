"""Ground-shaking intensity (Modified Mercalli Intensity, MMI) for a scenario earthquake.

Uses the hypocentral-distance intensity prediction equation of Allen, Wald &
Worden (2012), "Intensity attenuation for active crustal regions", J. Seismol.
16:409-433 (coefficients as implemented in OpenQuake's ``AllenEtAl2012Rhypo``)::

    MMI = c0 + c1*M + c2*ln(sqrt(R^2 + Rm^2)) [+ c4*ln(R/50) if R > 50 km]
    Rm  = m1 + m2*exp(M - 5)
    sigma(R) = s1 + s2 / (1 + (R/s3)^2)

R is hypocentral distance in km. The equation was fitted to M5.0-7.9 crustal
events within 300 km; beyond that range (great subduction quakes, very deep
events, far field) values are extrapolations and the footprint is idealised as
circular (no fault geometry, site amplification or directivity).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

C0, C1, C2, C4 = 2.085, 1.428, -1.402, 0.078
M1, M2 = -0.209, 2.042
S1, S2, S3 = 0.82, 0.37, 22.9

MMI_MIN, MMI_MAX = 1.0, 12.0
#: Levels drawn as footprint rings (IV light ... X+ extreme).
RING_LEVELS = (4, 5, 6, 7, 8, 9, 10)

FloatArray = npt.NDArray[np.float64]


def mmi(magnitude: npt.ArrayLike, rhypo_km: npt.ArrayLike) -> FloatArray:
    """Mean MMI at hypocentral distance ``rhypo_km`` (clipped to I-XII)."""
    m = np.asarray(magnitude, dtype=float)
    r = np.maximum(np.asarray(rhypo_km, dtype=float), 0.0)
    rm = M1 + M2 * np.exp(m - 5.0)
    f_r = C2 * np.log(np.sqrt(r**2 + rm**2))
    f_r = f_r + np.where(r > 50.0, C4 * np.log(np.maximum(r, 50.0) / 50.0), 0.0)
    return np.clip(C0 + C1 * m + f_r, MMI_MIN, MMI_MAX)


def sigma(rhypo_km: npt.ArrayLike) -> FloatArray:
    """Total standard deviation of MMI (larger close to the source)."""
    r = np.asarray(rhypo_km, dtype=float)
    return S1 + S2 / (1.0 + (r / S3) ** 2)


def hypocentral_km(epicentral_km: npt.ArrayLike, depth_km: float) -> FloatArray:
    return np.sqrt(np.asarray(epicentral_km, dtype=float) ** 2 + float(depth_km) ** 2)


def ring_radius_km(
    magnitude: float, depth_km: float, level: float, *, max_km: float = 3000.0
) -> float | None:
    """Epicentral distance at which mean MMI falls to ``level``.

    ``None`` if the level is not reached even directly above the hypocentre.
    MMI decreases monotonically with distance, so bisection is exact enough.
    """
    if float(mmi(magnitude, depth_km)) < level:
        return None
    if float(mmi(magnitude, hypocentral_km(max_km, depth_km))) >= level:
        return max_km
    lo, hi = 0.0, max_km
    for _ in range(60):
        mid = (lo + hi) / 2
        if float(mmi(magnitude, hypocentral_km(mid, depth_km))) >= level:
            lo = mid
        else:
            hi = mid
    return lo


def rings(magnitude: float, depth_km: float) -> list[tuple[int, float]]:
    """``(level, radius_km)`` for each ring level the scenario reaches, strongest last."""
    out = []
    for level in RING_LEVELS:
        radius = ring_radius_km(magnitude, depth_km, level)
        if radius is not None and radius > 0:
            out.append((level, round(radius, 1)))
    return out
