"""Pydantic response models shared by the query layer and the API."""

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


class YearCount(BaseModel):
    year: int
    count: int


class Summary(BaseModel):
    """Aggregates over every event matching the filters (not just the capped subset)."""

    total: int
    strongest: StrongestEvent | None
    per_year: list[YearCount]


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
