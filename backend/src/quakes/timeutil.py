"""Calendar arithmetic on epoch milliseconds that works for BCE dates.

Python's :class:`datetime.datetime` only covers years 1-9999 and pandas' default
nanosecond timestamps only cover 1677-2262, but the NOAA catalog reaches back to
2150 BCE. Everything here works on plain integers using the proleptic Gregorian
calendar with *astronomical* year numbering (1 BCE = year 0, 2 BCE = year -1).

Algorithms follow Howard Hinnant's ``days_from_civil`` / ``civil_from_days``.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

MS_PER_DAY = 86_400_000
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

IntArray = npt.NDArray[np.int64]


def days_from_civil(year: npt.ArrayLike, month: npt.ArrayLike, day: npt.ArrayLike) -> IntArray:
    """Days since 1970-01-01 for (astronomical) year, month (1-12), day (1-31)."""
    y = np.asarray(year, dtype=np.int64)
    m = np.asarray(month, dtype=np.int64)
    d = np.asarray(day, dtype=np.int64)
    y = y - (m <= 2)
    era = np.floor_divide(y, 400)
    yoe = y - era * 400
    mp = (m + 9) % 12
    doy = (153 * mp + 2) // 5 + d - 1
    doe = yoe * 365 + yoe // 4 - yoe // 100 + doy
    return era * 146_097 + doe - 719_468


def civil_from_days(days: npt.ArrayLike) -> tuple[IntArray, IntArray, IntArray]:
    """Inverse of :func:`days_from_civil`; returns (year, month, day) arrays."""
    z = np.asarray(days, dtype=np.int64) + 719_468
    era = np.floor_divide(z, 146_097)
    doe = z - era * 146_097
    yoe = (doe - doe // 1460 + doe // 36_524 - doe // 146_096) // 365
    y = yoe + era * 400
    doy = doe - (365 * yoe + yoe // 4 - yoe // 100)
    mp = (5 * doy + 2) // 153
    d = doy - (153 * mp + 2) // 5 + 1
    m = np.where(mp < 10, mp + 3, mp - 9)
    y = y + (m <= 2)
    return y, m, d


def epoch_ms(
    year: npt.ArrayLike,
    month: npt.ArrayLike | int = 1,
    day: npt.ArrayLike | int = 1,
    hour: npt.ArrayLike | int = 0,
    minute: npt.ArrayLike | int = 0,
    second: npt.ArrayLike | float = 0,
) -> IntArray:
    """Epoch milliseconds (UTC) from calendar parts. Seconds may be fractional."""
    days = days_from_civil(year, month, day)
    secs = np.asarray(second, dtype=np.float64)
    ms_of_day = (
        np.asarray(hour, dtype=np.int64) * 3_600_000
        + np.asarray(minute, dtype=np.int64) * 60_000
        + np.round(secs * 1000).astype(np.int64)
    )
    return days * MS_PER_DAY + ms_of_day


def year_of(ms: npt.ArrayLike) -> IntArray:
    """Astronomical calendar year of each epoch-ms timestamp."""
    days = np.floor_divide(np.asarray(ms, dtype=np.int64), MS_PER_DAY)
    return civil_from_days(days)[0]


def format_year(year: int) -> str:
    """Human-readable year: ``2011``, ``1 BCE`` (year 0), ``464 BCE`` (year -463)."""
    return f"{1 - year} BCE" if year <= 0 else str(year)


def format_time(ms: int, *, with_time: bool = True) -> str:
    """Format one epoch-ms timestamp, e.g. ``11 Mar 2011, 05:46:24 UTC`` or ``1 Jan 464 BCE``."""
    days, ms_of_day = divmod(int(ms), MS_PER_DAY)
    y, m, d = (int(v) for v in civil_from_days(days))
    date = f"{d} {_MONTHS[m - 1]} {format_year(y)}"
    if not with_time:
        return date
    hh, rem = divmod(ms_of_day // 1000, 3600)
    mm, ss = divmod(rem, 60)
    return f"{date}, {hh:02d}:{mm:02d}:{ss:02d} UTC"
