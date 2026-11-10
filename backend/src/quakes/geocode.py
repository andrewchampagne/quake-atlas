"""Place search for the simulator's location bar.

Type-ahead results come from Photon (https://photon.komoot.io), a free
OpenStreetMap geocoder built for search-as-you-type. Results are cached. If
Photon is unreachable, or returns nothing, the bundled Natural Earth city
table (``places.parquet``) is searched instead, so search still works offline.
"""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import pandas as pd
from pydantic import BaseModel

from quakes.cache import LRUCache
from quakes.config import USER_AGENT

log = logging.getLogger(__name__)

PHOTON_URL = "https://photon.komoot.io/api/"


class PlaceResult(BaseModel):
    name: str
    label: str
    latitude: float
    longitude: float
    kind: str | None = None
    source: str


def _photon_label(props: dict[str, object]) -> str:
    parts = [props.get(k) for k in ("name", "city", "state", "country")]
    seen: list[str] = []
    for part in parts:
        if isinstance(part, str) and part and part not in seen:
            seen.append(part)
    return ", ".join(seen)


def parse_photon(payload: dict[str, object]) -> list[PlaceResult]:
    """Convert a Photon GeoJSON response into results, dropping duplicates."""
    out: list[PlaceResult] = []
    labels: set[str] = set()
    for feature in payload.get("features", []) or []:  # type: ignore[union-attr]
        props = feature.get("properties", {}) or {}
        coords = (feature.get("geometry") or {}).get("coordinates") or []
        name = props.get("name")
        if not isinstance(name, str) or len(coords) != 2:
            continue
        label = _photon_label(props)
        if label in labels:
            continue
        labels.add(label)
        out.append(
            PlaceResult(
                name=name,
                label=label,
                longitude=float(coords[0]),
                latitude=float(coords[1]),
                kind=props.get("type") if isinstance(props.get("type"), str) else None,
                source="photon",
            )
        )
    return out


class Geocoder:
    """Photon search with a local fallback and an LRU cache."""

    def __init__(
        self,
        places_path: Path | None = None,
        *,
        client: httpx.Client | None = None,
        timeout: float = 4.0,
    ) -> None:
        self._client = client or httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT})
        self._cache: LRUCache[tuple[str, int], list[PlaceResult]] = LRUCache(512)
        self._places: pd.DataFrame | None = None
        if places_path is not None and places_path.exists():
            df = pd.read_parquet(
                places_path, columns=["name", "country", "latitude", "longitude", "population"]
            )
            df["key"] = df["name"].str.casefold()
            self._places = df.sort_values("population", ascending=False).reset_index(drop=True)

    def local(self, query: str, limit: int) -> list[PlaceResult]:
        """Cities whose name starts with (then contains) the query, most populous first."""
        if self._places is None:
            return []
        q = query.casefold().strip()
        keys = self._places["key"]
        starts = self._places[keys.str.startswith(q)]
        contains = self._places[keys.str.contains(q, regex=False) & ~keys.str.startswith(q)]
        hits = pd.concat([starts, contains]).head(limit)
        return [
            PlaceResult(
                name=row.name,
                label=f"{row.name}, {row.country}",
                latitude=float(row.latitude),
                longitude=float(row.longitude),
                kind="city",
                source="local",
            )
            for row in hits.itertuples(index=False)
        ]

    def search(self, query: str, limit: int = 6) -> list[PlaceResult]:
        key = (query.casefold().strip(), limit)
        cached = self._cache.get(key)
        if cached is not None:
            return cached
        results: list[PlaceResult] = []
        try:
            resp = self._client.get(PHOTON_URL, params={"q": query, "limit": limit, "lang": "en"})
            resp.raise_for_status()
            results = parse_photon(resp.json())[:limit]
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Photon search failed (%s); using local city list", exc)
        if not results:
            results = self.local(query, limit)
        else:
            self._cache.put(key, results)  # only cache online answers; retry Photon later
        return results

    def close(self) -> None:
        self._client.close()
