"""Population exposure: which cities feel how much shaking.

Built from Natural Earth (public domain) populated places (about 7,300 cities
with metro populations) joined to country income groups and GDP per capita.
This is a coarse proxy: rural populations are not counted and populations are
present-day, so absolute exposure is underestimated (and overestimated for
decades-old events). It is used for relative comparisons and model features.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pyarrow as pa
from sklearn.neighbors import BallTree

from quakes.clean import write_parquet
from quakes.config import COUNTRIES_FILE, PLACES_FILE

log = logging.getLogger(__name__)

EARTH_RADIUS_KM = 6371.0
#: Neutral values for countries missing from the 110m country table.
MEDIAN_INCOME_GROUP = 3.0

PointLike = float | np.ndarray


def _features(path: Path) -> list[dict[str, object]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    return [f.get("properties", {}) for f in data.get("features", [])]


def build_places(raw_places_dir: Path, out_path: Path) -> int:
    """Join Natural Earth cities to country attributes and write ``places.parquet``."""
    places = pd.DataFrame(_features(raw_places_dir / PLACES_FILE))
    countries = pd.DataFrame(_features(raw_places_dir / COUNTRIES_FILE))

    countries["income_group"] = pd.to_numeric(
        countries["INCOME_GRP"].astype(str).str[0], errors="coerce"
    )
    pop_est = pd.to_numeric(countries["POP_EST"], errors="coerce")
    gdp_md = pd.to_numeric(countries["GDP_MD"], errors="coerce")
    countries["gdp_per_capita"] = (gdp_md * 1e6 / pop_est).where(pop_est > 0)
    lookup = countries.set_index("ADM0_A3")[["income_group", "gdp_per_capita"]]
    lookup = lookup[~lookup.index.duplicated()]

    df = pd.DataFrame(
        {
            "name": places["name"].astype(str),
            "country": places["adm0name"].astype(str),
            "adm0_a3": places["adm0_a3"].astype(str),
            "latitude": pd.to_numeric(places["latitude"], errors="coerce"),
            "longitude": pd.to_numeric(places["longitude"], errors="coerce"),
            "population": pd.to_numeric(places["pop_max"], errors="coerce"),
        }
    )
    df = df.dropna(subset=["latitude", "longitude", "population"])
    df = df[df["population"] > 0]
    joined = df.join(lookup, on="adm0_a3")
    # Territories missing from the country table: fall back to their sovereign, then medians.
    if "sov_a3" in places:
        sov = places.loc[joined.index, "sov_a3"].astype(str)
        missing = joined["income_group"].isna()
        fill = lookup.reindex(sov[missing].to_numpy())
        joined.loc[missing, "income_group"] = fill["income_group"].to_numpy()
        joined.loc[missing, "gdp_per_capita"] = fill["gdp_per_capita"].to_numpy()
    joined["income_group"] = joined["income_group"].fillna(MEDIAN_INCOME_GROUP)
    joined["gdp_per_capita"] = joined["gdp_per_capita"].fillna(
        float(lookup["gdp_per_capita"].median())
    )
    joined = joined.reset_index(drop=True)

    write_parquet(pa.Table.from_pandas(joined, preserve_index=False), out_path)
    log.info(
        "Places: %d cities, %.2f billion people", len(joined), joined["population"].sum() / 1e9
    )
    return len(joined)


@dataclass
class Places:
    """City table plus a haversine BallTree for radius queries."""

    names: np.ndarray
    countries: np.ndarray
    latitude: np.ndarray
    longitude: np.ndarray
    population: np.ndarray
    income_group: np.ndarray
    gdp_per_capita: np.ndarray
    tree: BallTree

    @classmethod
    def load(cls, path: Path) -> Places:
        df = pd.read_parquet(path)
        coords = np.radians(df[["latitude", "longitude"]].to_numpy(float))
        return cls(
            names=df["name"].to_numpy(object),
            countries=df["country"].to_numpy(object),
            latitude=df["latitude"].to_numpy(float),
            longitude=df["longitude"].to_numpy(float),
            population=df["population"].to_numpy(float),
            income_group=df["income_group"].to_numpy(float),
            gdp_per_capita=df["gdp_per_capita"].to_numpy(float),
            tree=BallTree(coords, metric="haversine"),
        )

    def __len__(self) -> int:
        return len(self.names)

    def nearby(
        self, lat: PointLike, lon: PointLike, radius_km: float
    ) -> tuple[list[np.ndarray], list[np.ndarray]]:
        """Indices and epicentral distances (km) of cities within ``radius_km`` of each point."""
        pts = np.radians(np.column_stack([np.atleast_1d(lat), np.atleast_1d(lon)]).astype(float))
        ind, dist = self.tree.query_radius(pts, r=radius_km / EARTH_RADIUS_KM, return_distance=True)
        return list(ind), [d * EARTH_RADIUS_KM for d in dist]

    @property
    def median_gdp_per_capita(self) -> float:
        return float(np.median(self.gdp_per_capita))
