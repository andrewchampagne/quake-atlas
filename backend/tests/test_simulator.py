"""Simulator domain, exposure, training-label and probability regressions."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sklearn.ensemble import RandomForestRegressor

from quakes import shaking, simulator, timeutil
from quakes.clean import finalize, to_arrow, write_parquet
from quakes.config import Settings
from quakes.exposure import EARTH_RADIUS_KM, Places
from quakes.models import ModelCard, Simulation, SimulationInput
from quakes.query import QuakeStore

SCENARIO = {"latitude": 0.0, "longitude": 0.0, "magnitude": 7.0, "depth_km": 10.0}


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("latitude", -90.01),
        ("latitude", 90.01),
        ("longitude", -180.01),
        ("longitude", 180.01),
        ("magnitude", 4.99),
        ("magnitude", 7.91),
        ("depth_km", 0.99),
        ("depth_km", 70.01),
        *[
            (field, invalid)
            for field in SCENARIO
            for invalid in (float("nan"), float("inf"), -float("inf"))
        ],
    ],
)
def test_scenario_rejects_outside_domain_and_nonfinite_values(field: str, value: float) -> None:
    with pytest.raises(ValidationError):
        SimulationInput(**{**SCENARIO, field: value})


@pytest.mark.parametrize(
    ("latitude", "longitude", "magnitude", "depth_km"),
    [(-90.0, -180.0, 5.0, 1.0), (90.0, 180.0, 7.9, 70.0)],
)
def test_scenario_domain_boundaries_are_inclusive(
    latitude: float, longitude: float, magnitude: float, depth_km: float
) -> None:
    scenario = SimulationInput(
        latitude=latitude, longitude=longitude, magnitude=magnitude, depth_km=depth_km
    )
    assert scenario.magnitude == magnitude
    assert scenario.depth_km == depth_km


@pytest.fixture
def places_path(tmp_path: Path) -> Path:
    """Known distances distinguish epicentral and hypocentral 300-km limits."""
    frame = pd.DataFrame(
        {
            "name": ["Epicentre", "Near", "Edge", "Beyond", "Dateline"],
            "country": ["Test"] * 5,
            "latitude": [0.0] * 5,
            "longitude": np.degrees(np.array([0.0, 100.0, 299.95, 300.1, 0.0]) / EARTH_RADIUS_KM),
            "population": [1000, 2000, 4000, 8000, 16000],
            "income_group": [3.0] * 5,
            "gdp_per_capita": [10000.0] * 5,
        }
    )
    frame.loc[4, "longitude"] = -179.9
    path = tmp_path / "places.parquet"
    frame.to_parquet(path, index=False)
    return path


def test_places_distance_query_excludes_beyond_radius(places_path: Path) -> None:
    places = Places.load(places_path)
    indices, distances = places.nearby(0.0, 0.0, 300.0)
    by_name = dict(zip(places.names[indices[0]], distances[0], strict=True))
    assert set(by_name) == {"Epicentre", "Near", "Edge"}
    assert by_name["Epicentre"] == pytest.approx(0.0)
    assert by_name["Near"] == pytest.approx(100.0)
    assert by_name["Edge"] == pytest.approx(299.95)


def test_places_distance_query_wraps_the_dateline(places_path: Path) -> None:
    places = Places.load(places_path)
    indices, distances = places.nearby(0.0, 179.9, 30.0)
    assert places.names[indices[0]].tolist() == ["Dateline"]
    assert distances[0][0] == pytest.approx(EARTH_RADIUS_KM * math.radians(0.2))


def test_attenuation_uses_hypocentral_distance() -> None:
    epicentral = np.array([0.0, 10.0, 100.0, 290.0])
    distance = shaking.hypocentral_km(epicentral, 70.0)
    assert distance == pytest.approx(np.hypot(epicentral, 70.0))
    intensity = shaking.mmi(7.0, distance)
    assert np.all(np.diff(intensity) < 0)
    assert np.all((intensity >= 1) & (intensity <= 12))


class FixedPrediction:
    def __init__(self, value: float) -> None:
        self.value = value
        self.calls = 0

    def predict(self, values: np.ndarray) -> np.ndarray:
        self.calls += 1
        assert values.shape == (1, len(simulator.FEATURES))
        assert np.isfinite(values).all()
        return np.full(len(values), self.value)


@pytest.fixture
def simulation_engine(places_path: Path) -> simulator.Simulator:
    model = FixedPrediction(float(np.log1p(100)))
    residuals = np.log1p([0, 2, 20, 200, 2000, 20000]) - model.value
    card = ModelCard(
        trained_at="2026-11-09T00:00:00+00:00",
        n_train=60,
        n_deadly=55,
        years=(2000, 2019),
        min_magnitude=5,
        features=simulator.FEATURES,
        metrics={"holdout_events": 12},
        baseline={},
        notes=["Synthetic test model; conditional severity only."],
    )
    return simulator.Simulator(Places.load(places_path), model, residuals, card)


def test_simulate_probability_bins_and_exceedance_are_consistent(
    simulation_engine: simulator.Simulator, store: QuakeStore
) -> None:
    result = simulation_engine.simulate(SimulationInput(**SCENARIO), store)
    estimate = result.fatalities
    probabilities = [bin_.probability for bin_ in estimate.bins]
    assert sum(probabilities) == pytest.approx(1)
    assert probabilities == pytest.approx([1 / 6] * 6)
    assert all(math.isfinite(p) and 0 <= p <= 1 for p in probabilities)
    for threshold, first_bin in (("1", 1), ("10", 2), ("100", 3), ("1000", 4)):
        assert estimate.exceedance[threshold] == pytest.approx(sum(probabilities[first_bin:]))
    assert estimate.median_bin in {bin_.key for bin_ in estimate.bins}
    assert estimate.median_label == next(
        bin_.label for bin_ in estimate.bins if bin_.key == estimate.median_bin
    )
    assert Simulation.model_validate_json(result.model_dump_json()) == result
    assert result == simulation_engine.simulate(SimulationInput(**SCENARIO), store)


def test_simulate_api_serializes_the_response_contract(
    client: TestClient, simulation_engine: simulator.Simulator
) -> None:
    client.app.state.quakes.simulator = simulation_engine  # type: ignore[attr-defined]
    response = client.post("/api/simulate", json=SCENARIO)
    assert response.status_code == 200
    result = Simulation.model_validate(response.json())
    assert result.input == SimulationInput(**SCENARIO)
    assert result.model == simulation_engine.card
    assert sum(bin_.probability for bin_ in result.fatalities.bins) == pytest.approx(1)
    assert {city.name for city in result.cities} == {"Epicentre", "Near"}
    assert response.json()["recurrence"]["method"] == "gutenberg-richter"


def test_simulate_no_city_coverage_is_unavailable_and_does_not_predict(
    simulation_engine: simulator.Simulator, store: QuakeStore
) -> None:
    result = simulation_engine.simulate(
        SimulationInput(**{**SCENARIO, "latitude": 60.0, "longitude": 60.0}), store
    )
    assert result.cities == []
    assert result.exposure == []
    assert result.fatalities.bins == []
    assert result.fatalities.exceedance == {}
    assert result.fatalities.median_bin == "unavailable"
    assert "coverage" in result.fatalities.median_label.lower()
    assert result.fatalities.alert == "unavailable"
    assert simulation_engine.model.calls == 0
    assert result.analogs.count == 0
    assert result.recurrence.method == "insufficient-data"


def test_simulate_cities_and_features_exclude_hypocentral_distances_above_300km(
    simulation_engine: simulator.Simulator, store: QuakeStore
) -> None:
    scenario = SimulationInput(**{**SCENARIO, "magnitude": 7.9, "depth_km": 70.0})
    ids, distances, intensity = simulator.exposure(simulation_engine.places, scenario)
    assert set(simulation_engine.places.names[ids]) == {"Epicentre", "Near"}
    assert np.all(np.hypot(distances, scenario.depth_km) <= 300)
    assert np.all(intensity >= 4)
    result = simulation_engine.simulate(scenario, store)
    assert {city.name for city in result.cities} == {"Epicentre", "Near"}
    assert sum(level.population for level in result.exposure) == 3000
    assert [city.mmi for city in result.cities] == sorted(
        [city.mmi for city in result.cities], reverse=True
    )
    values = simulator.features(simulation_engine.places, scenario)
    assert values.shape == (len(simulator.FEATURES),)
    assert values[3] == pytest.approx(np.log1p(3000))


@pytest.mark.parametrize(("magnitude", "depth_km"), [(5.0, 1.0), (7.0, 10.0), (7.9, 70.0)])
def test_simulate_rings_are_true_contours_inside_the_hypocentral_domain(
    simulation_engine: simulator.Simulator, store: QuakeStore, magnitude: float, depth_km: float
) -> None:
    scenario = SimulationInput(**{**SCENARIO, "magnitude": magnitude, "depth_km": depth_km})
    result = simulation_engine.simulate(scenario, store)
    max_epicentral = math.sqrt(300**2 - depth_km**2)
    expected = [
        (level, radius)
        for level, radius in shaking.rings(magnitude, depth_km)
        if radius <= max_epicentral
    ]
    assert [(ring.mmi, ring.radius_km) for ring in result.rings] == expected
    for ring in result.rings:
        distance = math.hypot(ring.radius_km, depth_km)
        assert distance <= 300
        assert float(shaking.mmi(magnitude, distance)) == pytest.approx(ring.mmi, abs=0.03)


@pytest.fixture
def training_settings(tmp_path: Path, places_path: Path) -> Settings:
    settings = Settings(data_dir=tmp_path, max_points=1000, frontend_dist=tmp_path / "no-dist")
    settings.processed_dir.mkdir(parents=True, exist_ok=True)
    settings.places_path.write_bytes(places_path.read_bytes())
    records = []
    for index in range(180):
        known = index < 60
        year = 2000 + index % 60 // 3
        records.append(
            {
                "event_id": f"training-{index}",
                "time_ms": int(timeutil.epoch_ms(year, 1, index % 3 + 1, index // 60)),
                "latitude": 0.0,
                "longitude": 0.0,
                "depth_km": float(year - 1999),
                "magnitude": 6.0,
                "mag_type": "Mw",
                "place": "Test",
                "source": "usgs",
                "deaths": index % 12 if known else None,
                # Explicit order zero is still an unknown exact count.
                "deaths_order": None if known else (0 if index % 2 else 4),
            }
        )
    frame = pd.DataFrame(records)
    frame["deaths"] = frame["deaths"].astype("Int64")
    frame["deaths_order"] = frame["deaths_order"].astype("Int64")
    write_parquet(to_arrow(finalize(frame)), settings.parquet_path)
    return settings


def test_train_excludes_unknown_counts_keeps_explicit_zero_and_holds_out_whole_years(
    training_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    fitted: list[tuple[np.ndarray, np.ndarray]] = []
    predictions: list[np.ndarray] = []

    original_fit = RandomForestRegressor.fit
    original_predict = RandomForestRegressor.predict

    def record_fit(self, x, y, *args, **kwargs):  # type: ignore[no-untyped-def]
        fitted.append((np.array(x, copy=True), np.array(y, copy=True)))
        return original_fit(self, x, y, *args, **kwargs)

    def record_predict(self, x):  # type: ignore[no-untyped-def]
        predictions.append(np.array(x, copy=True))
        return original_predict(self, x)

    monkeypatch.setattr(RandomForestRegressor, "fit", record_fit)
    monkeypatch.setattr(RandomForestRegressor, "predict", record_predict)
    card = simulator.train(training_settings)
    assert card.n_train == 60
    assert card.n_deadly == 55
    assert card.metrics["holdout_events"] == 12
    assert card.metrics["holdout_start_year"] == 2016
    assert len(fitted) == 2  # Assessment fit, followed by the documented full-data refit.
    assert len(fitted[0][1]) == 48
    assert len(fitted[1][1]) == 60
    assert np.count_nonzero(fitted[0][1] == 0) == 4
    assert np.count_nonzero(fitted[1][1] == 0) == 5
    assert fitted[1][1] == pytest.approx(np.log1p(np.arange(60) % 12))
    # Depth encodes the event year in this fixture, exposing the actual fit/predict partition.
    fitted_years = set(fitted[0][0][:, 1] + 1999)
    held_out_years = set(predictions[0][:, 1] + 1999)
    assert fitted_years.isdisjoint(held_out_years)
    assert max(fitted_years) < min(held_out_years)
    assert card.metrics["log1p_mae"] is not None
    notes = " ".join(card.notes).lower()
    assert "conditional" in notes and "unknown" in notes
    assert "not calibrated" in notes
    loaded = simulator.Simulator.load(training_settings)
    assert loaded.card == card
    assert loaded.residuals.shape == (12,)
    assert np.isfinite(loaded.residuals).all()
