"""Pydantic response models shared by the query layer, the simulator and the API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class EventDetail(BaseModel):
    """Everything known about one event (``GET /api/events/{rid}``)."""

    rid: int
    event_id: str
    time: int = Field(description="Epoch milliseconds (UTC); may be negative / BCE.")
    time_label: str
    year: int = Field(description="Astronomical year (1 BCE = 0).")
    latitude: float
    longitude: float
    depth_km: float | None
    magnitude: float
    mag_type: str | None
    place: str | None
    source: str
    url: str | None
    deaths: int | None = Field(description="Recorded deaths (NOAA), if an exact count exists.")
    deaths_order: int | None = Field(
        description="NOAA death scale: 0 none, 1 = 1-50, 2 = 51-100, 3 = 101-1000, 4 = >1000."
    )
    deaths_label: str = Field(description="Human-readable death toll.")


class StrongestEvent(BaseModel):
    rid: int
    event_id: str
    time: int
    latitude: float
    longitude: float
    depth_km: float | None
    magnitude: float
    place: str | None
    source: str
    deaths: int | None = None
    deaths_order: int | None = None


class YearCount(BaseModel):
    year: int
    count: int
    deaths: int = Field(0, description="Sum of exact recorded deaths that year.")


class Summary(BaseModel):
    """Aggregates over every event matching the filters (not just the capped subset)."""

    total: int
    strongest: StrongestEvent | None
    per_year: list[YearCount]
    total_deaths: int = Field(0, description="Sum of exact recorded death counts.")
    deadly_events: int = Field(0, description="Events with at least one recorded death.")
    approx_deadly_events: int = Field(
        0, description="Deadly events known only by NOAA's order of magnitude (not in the sum)."
    )
    deadliest: StrongestEvent | None = None


class Range(BaseModel):
    min: float
    max: float


class SourceInfo(BaseModel):
    id: str
    code: int = Field(description="uint8 code used in the binary events payload.")
    label: str
    count: int


class Meta(BaseModel):
    min_time: int
    max_time: int
    min_year: int
    max_year: int
    magnitude: Range
    depth: Range
    sources: list[SourceInfo]
    total: int
    max_points: int
    deadly_events: int = 0
    simulator_ready: bool = False


# --------------------------------------------------------------------------- simulator


class Analog(BaseModel):
    """A past earthquake similar to the simulated one (nearby, similar magnitude)."""

    rid: int
    event_id: str
    time: int
    year: int
    latitude: float
    longitude: float
    depth_km: float | None
    magnitude: float
    place: str | None
    source: str
    deaths: int | None
    deaths_order: int | None
    deaths_label: str
    distance_km: float


class AnalogSummary(BaseModel):
    radius_km: float
    magnitude_window: float
    count: int
    deadly: int
    max_deaths: int | None
    events: list[Analog]


class Recurrence(BaseModel):
    """How often an earthquake at least this large has occurred nearby, from the catalog."""

    radius_km: float
    magnitude: float
    start_year: int
    end_year: int
    reference_magnitude: float
    reference_count: int = Field(description="Events >= reference magnitude in the circle.")
    count_at_or_above: int = Field(description="Events >= the scenario magnitude in the circle.")
    rate_per_year: float | None
    return_period_years: float | None
    probability_50yr: float | None
    method: str = Field(description="'empirical', 'gutenberg-richter' or 'insufficient-data'.")


class ShakingRing(BaseModel):
    mmi: int
    radius_km: float


class ExposureLevel(BaseModel):
    mmi: int
    population: int = Field(
        description="Population in listed cities whose shaking rounds to this level."
    )


class CityImpact(BaseModel):
    name: str
    country: str | None
    population: int
    distance_km: float
    mmi: float


class FatalityBin(BaseModel):
    key: str
    label: str
    probability: float


class FatalityEstimate(BaseModel):
    bins: list[FatalityBin]
    exceedance: dict[str, float] = Field(description="P(deaths >= threshold) keyed by threshold.")
    median_bin: str
    median_label: str
    alert: str = Field(description="Experimental status; not an operational PAGER alert.")


class ModelCard(BaseModel):
    trained_at: str
    n_train: int
    n_deadly: int
    years: tuple[int, int]
    min_magnitude: float
    features: list[str]
    metrics: dict[str, float | int | None]
    baseline: dict[str, float | None]
    notes: list[str]


class SimulationInput(BaseModel):
    latitude: float = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: float = Field(ge=-180, le=180, allow_inf_nan=False)
    magnitude: float = Field(ge=5, le=7.9, allow_inf_nan=False)
    depth_km: float = Field(ge=1, le=70, allow_inf_nan=False)


class Simulation(BaseModel):
    input: SimulationInput
    epicentral_mmi: float
    rings: list[ShakingRing]
    exposure: list[ExposureLevel]
    cities: list[CityImpact]
    fatalities: FatalityEstimate
    analogs: AnalogSummary
    recurrence: Recurrence
    model: ModelCard
