"""Filesystem locations and tunables, overridable with environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

#: Repository root: backend/src/quakes/config.py -> parents[3].
PROJECT_ROOT = Path(__file__).resolve().parents[3]

#: Source identifiers and the uint8 codes used in the binary events payload.
SOURCES: dict[str, int] = {"usgs": 0, "noaa": 1}
SOURCE_LABELS: dict[str, str] = {
    "usgs": "USGS ComCat",
    "noaa": "NOAA NCEI Significant Earthquakes",
}

#: Events at or after this instant come from USGS; earlier ones from NOAA (epoch ms, 1900-01-01).
SOURCE_CUTOFF_MS = -2_208_988_800_000

USER_AGENT = "quakes-explorer/0.1"


@dataclass(frozen=True)
class Settings:
    """Resolved paths and limits."""

    data_dir: Path
    max_points: int
    frontend_dist: Path

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def parquet_path(self) -> Path:
        return self.processed_dir / "earthquakes.parquet"

    @classmethod
    def from_env(cls) -> Settings:
        return cls(
            data_dir=Path(os.environ.get("QUAKES_DATA_DIR", PROJECT_ROOT / "data")),
            max_points=int(os.environ.get("QUAKES_MAX_POINTS", "300000")),
            frontend_dist=Path(
                os.environ.get("QUAKES_FRONTEND_DIST", PROJECT_ROOT / "frontend" / "dist")
            ),
        )
