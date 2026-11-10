"""Exploratory scenario severity model, conditional on reported historical impacts.

Missing death labels are excluded. This model cannot estimate the unconditional
probability of deaths: the reporting process strongly selects fatal events.
Joblib artifacts are local build products; never load artifacts from third parties.
"""

from __future__ import annotations

from datetime import UTC, datetime

import joblib
import numpy as np
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error

from quakes import shaking
from quakes.config import Settings
from quakes.exposure import Places, build_places
from quakes.ingest import ingest_places
from quakes.models import (
    CityImpact,
    ExposureLevel,
    FatalityBin,
    FatalityEstimate,
    ModelCard,
    ShakingRing,
    Simulation,
    SimulationInput,
)
from quakes.query import QuakeStore

FEATURES = ["magnitude", "depth_km", "epicentral_mmi"] + [
    f"log_city_population_mmi_{level}_plus" for level in range(4, 10)
]
EDGES = np.array([0, 1, 10, 100, 1000, 10000, np.inf])
LABELS = ["0", "1-9", "10-99", "100-999", "1,000-9,999", "10,000+"]

#: Magnitudes the intensity equation was fitted to (Allen, Wald & Worden 2012).
SUPPORTED_MAGNITUDE = (5.0, 7.9)
#: Hypocentral distance the equation was fitted to; widened for great earthquakes.
BASE_DOMAIN_KM = 300.0
MAX_DOMAIN_KM = 1000.0
MAX_MAGNITUDE = 9.5


def domain_km(magnitude: float, depth_km: float) -> float:
    """Hypocentral radius used for exposure and shaking rings.

    300 km (the equation's fitted range) up to M7.9. Great earthquakes are felt
    much further away, so above M7.9 the radius grows linearly to 1,000 km at
    M9.5, but never past where mean shaking falls to MMI IV. Growing smoothly
    avoids a jump in exposure between M7.9 and M8.0. Values there are
    extrapolations.
    """
    high = SUPPORTED_MAGNITUDE[1]
    if magnitude <= high:
        return BASE_DOMAIN_KM
    share = min(1.0, (magnitude - high) / (MAX_MAGNITUDE - high))
    ramp = BASE_DOMAIN_KM + share * (MAX_DOMAIN_KM - BASE_DOMAIN_KM)
    felt = shaking.ring_radius_km(magnitude, depth_km, 4, max_km=MAX_DOMAIN_KM) or 0.0
    return float(max(BASE_DOMAIN_KM, min(ramp, np.hypot(felt, depth_km))))


def domain_warnings(scenario: SimulationInput) -> list[str]:
    """Plain-language notes when a scenario is outside what the models were built on."""
    low, high = SUPPORTED_MAGNITUDE
    m = scenario.magnitude
    if m < low:
        return [
            f"M{m:.1f} is below the M{low:.1f}-{high:.1f} range of the shaking equation and "
            "below the M5+ training data, so shaking and fatality estimates are extrapolated."
        ]
    if m > high:
        reach = domain_km(m, scenario.depth_km)
        return [
            f"M{m:.1f} is above the M{low:.1f}-{high:.1f} range of the shaking equation, so "
            "shaking is extrapolated. Earthquakes this large rupture hundreds of kilometres "
            "of fault; a circular footprint centred on one point understates shaking along "
            "the rupture.",
            f"The exposure area was widened to {reach:,.0f} km to cover the larger felt area.",
        ]
    return []


def exposure(places: Places, scenario: SimulationInput):  # type: ignore[no-untyped-def]
    """City centroids within the scenario's distance domain (see :func:`domain_km`)."""
    reach = domain_km(scenario.magnitude, scenario.depth_km)
    indices, distances = places.nearby(scenario.latitude, scenario.longitude, reach)
    ids, dist = indices[0], distances[0]
    hypo = shaking.hypocentral_km(dist, scenario.depth_km)
    intensity = shaking.mmi(scenario.magnitude, hypo)
    keep = (hypo <= reach) & (intensity >= 4)
    return ids[keep], dist[keep], intensity[keep]


def features(places: Places, scenario: SimulationInput) -> np.ndarray:
    ids, _, intensity = exposure(places, scenario)
    return np.array(
        [
            scenario.magnitude,
            scenario.depth_km,
            float(shaking.mmi(scenario.magnitude, scenario.depth_km)),
            *[np.log1p(places.population[ids][intensity >= level].sum()) for level in range(4, 10)],
        ],
        dtype=float,
    )


def train(settings: Settings) -> ModelCard:
    """Fit severity to labeled modern events; assess against a later time holdout."""
    places = Places.load(settings.places_path)
    store = QuakeStore(settings.parquet_path)
    try:
        df = store.training_frame(min_magnitude=5, start_year=2000).to_pandas()
    finally:
        store.close()
    df = df[
        df.deaths.notna() & (df.deaths >= 0) & (df.magnitude >= 5) & df.depth_km.between(1, 70)
    ].sort_values(["year", "rid"])
    if len(df) < 30:
        raise ValueError("Need at least 30 labeled modern events; ingest NOAA and clean first.")
    x = np.vstack(
        [
            features(
                places,
                SimulationInput(
                    latitude=r.latitude,
                    longitude=r.longitude,
                    magnitude=float(r.magnitude),
                    depth_km=r.depth_km,
                ),
            )
            for r in df.itertuples()
        ]
    )
    y = np.log1p(df.deaths.to_numpy(float))
    # Whole years stay together so no same-year events leak across the holdout boundary.
    split_year = int(df.year.iloc[int(len(df) * 0.8)])
    holdout = df.year.to_numpy() >= split_year
    if holdout.sum() < 5 or (~holdout).sum() < 15:
        raise ValueError("Not enough distinct years for chronological evaluation.")
    model = RandomForestRegressor(
        n_estimators=180,
        min_samples_leaf=6,
        max_features=0.8,
        random_state=42,
        n_jobs=1,
    )
    model.fit(x[~holdout], y[~holdout])
    prediction = model.predict(x[holdout])
    residuals = y[holdout] - prediction
    baseline = np.full(holdout.sum(), np.median(y[~holdout]))
    card = ModelCard(
        trained_at=datetime.now(UTC).isoformat(timespec="seconds"),
        n_train=len(df),
        n_deadly=int((df.deaths > 0).sum()),
        years=(int(df.year.min()), int(df.year.max())),
        min_magnitude=5,
        features=FEATURES,
        metrics={
            "holdout_events": int(holdout.sum()),
            "holdout_start_year": split_year,
            "log1p_mae": float(mean_absolute_error(y[holdout], prediction)),
        },
        baseline={"log1p_mae": float(mean_absolute_error(y[holdout], baseline))},
        notes=[
            "Conditional severity among reported events only; unknown death labels are excluded.",
            "Selected fatal events only; probabilities are not calibrated population risk.",
            "Held-out residual ranges are exploratory, without coverage guarantees.",
            "The final model is refitted on all labeled events after chronological evaluation.",
            "City-centroid populations omit rural areas, may overlap, and are modern estimates.",
            "Labels include tsunami deaths; no separate tsunami or building-collapse model.",
            "Circular shaking omits soil and fault geometry. The intensity equation is fitted to "
            "M5-7.9 within 300 km; other magnitudes and the widened M8+ area are extrapolated.",
        ],
    )
    model.fit(x, y)
    settings.model_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = settings.model_path.with_suffix(".tmp")
    joblib.dump({"version": 1, "model": model, "residuals": residuals, "card": card}, temporary)
    temporary.replace(settings.model_path)
    print(card.model_dump_json(indent=2))
    return card


def prepare(settings: Settings) -> ModelCard:
    ingest_places(settings.raw_dir)
    build_places(settings.raw_dir / "places", settings.places_path)
    return train(settings)


class Simulator:
    def __init__(self, places: Places, model, residuals: np.ndarray, card: ModelCard):  # type: ignore[no-untyped-def]
        self.places, self.model, self.residuals, self.card = places, model, residuals, card

    @classmethod
    def load(cls, settings: Settings) -> Simulator:
        places = Places.load(settings.places_path)
        artifact = joblib.load(settings.model_path)
        if artifact["version"] != 1:
            raise ValueError("Retrain simulator model: incompatible artifact version.")
        return cls(places, artifact["model"], artifact["residuals"], artifact["card"])

    def simulate(self, scenario: SimulationInput, store: QuakeStore) -> Simulation:
        ids, dist, intensity = exposure(self.places, scenario)
        population = self.places.population[ids]
        levels = np.clip(np.floor(intensity + 0.5), 4, 12).astype(int)
        cities = [
            CityImpact(
                name=str(self.places.names[ids[i]]),
                country=str(self.places.countries[ids[i]]),
                population=int(population[i]),
                distance_km=round(float(dist[i]), 1),
                mmi=round(float(intensity[i]), 1),
            )
            for i in np.argsort(-intensity)[:30]
        ]
        if len(ids):
            center = float(self.model.predict(features(self.places, scenario).reshape(1, -1))[0])
            draws = np.maximum(0, np.expm1(np.clip(center + self.residuals, 0, 25)))
            counts = np.histogram(np.floor(draws), EDGES)[0]
            probs = counts / counts.sum()
            median = int(np.searchsorted(np.cumsum(probs), 0.5))
            fatalities = FatalityEstimate(
                bins=[
                    FatalityBin(key=str(i), label=label, probability=float(probs[i]))
                    for i, label in enumerate(LABELS)
                ],
                exceedance={str(n): float(np.mean(draws >= n)) for n in (1, 10, 100, 1000)},
                median_bin=str(median),
                median_label=LABELS[median],
                alert="experimental",
            )
        else:
            fatalities = FatalityEstimate(
                bins=[],
                exceedance={},
                median_bin="unavailable",
                median_label="Insufficient city coverage",
                alert="unavailable",
            )
        reach = domain_km(scenario.magnitude, scenario.depth_km)
        maximum_radius = float(np.sqrt(reach**2 - scenario.depth_km**2))
        return Simulation(
            input=scenario,
            epicentral_mmi=round(float(shaking.mmi(scenario.magnitude, scenario.depth_km)), 2),
            rings=[
                ShakingRing(mmi=level, radius_km=radius)
                for level, radius in shaking.rings(scenario.magnitude, scenario.depth_km)
                if radius <= maximum_radius
            ],
            exposure=[
                ExposureLevel(mmi=int(level), population=int(population[levels == level].sum()))
                for level in sorted(set(levels))
            ],
            cities=cities,
            fatalities=fatalities,
            analogs=store.analogs(scenario.latitude, scenario.longitude, scenario.magnitude),
            recurrence=store.recurrence(scenario.latitude, scenario.longitude, scenario.magnitude),
            model=self.card,
            warnings=domain_warnings(scenario),
        )
