# Quake Atlas

An interactive dark-themed world map of earthquakes from 2150 BCE to today.

- **Backend:** Python downloads and cleans two catalogs, queries them with DuckDB and serves them through FastAPI.
- **Frontend:** React and deck.gl draw hundreds of thousands of points on the GPU and filter them there.

| Source | Coverage | Used for |
|---|---|---|
| [USGS ComCat](https://earthquake.usgs.gov/fdsnws/event/1/) (FDSN event service) | 1900 to present, instrumental | Events from 1900 onward |
| [NOAA NCEI Significant Earthquake Database](https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/search) | 2150 BCE to present, damaging events only | Events before 1900; modern impact reports enrich USGS |

```
USGS FDSN ─┐  ingest.py    data/raw/   clean.py    earthquakes.parquet   query.py   api.py
NOAA Hazel ┘  (paginated,  (CSV/JSON   (normalise,  (one schema, zstd)   (DuckDB,   (FastAPI, Arrow IPC,
               resumable)   chunks)     dedupe)                           in-memory)  gzip, LRU cache)
                                                                                         │
                     React + deck.gl ScatterplotLayer (binary attributes, DataFilterExtension) ◄┘
```

## Quick start

**Prerequisites**
- [uv](https://docs.astral.sh/uv/), which installs Python 3.12 for you.
- Node 20+ and npm.
- `make` (optional; every target has an `npm run` equivalent).

```bash
make setup     # or: npm run setup
```

```bash
make sample    # USGS M5+ 2000-2024 + NOAA events and impact reports (~45k map events, about a minute)
```

```bash
make dev       # API on :8000 and Vite on :5173, in one terminal
```

Open http://localhost:5173. Interactive API docs are at http://127.0.0.1:8000/docs.

> **uv not found?** If you installed uv with `pip install --user uv`, its folder may not be on your PATH. On Windows that folder is `%APPDATA%\Python\Python3xx\Scripts`. Add it to PATH, or install uv with the [official installer](https://docs.astral.sh/uv/getting-started/installation/).

### Full historical download

```bash
make ingest-full              # USGS 1900-present at M2.5+, plus NOAA, then clean
```

```bash
make ingest-full MIN_MAG=4.5  # smaller: about 312k USGS events
```

What to expect:
- **Size:** M2.5+ is roughly 1 million events and about 180 MB of raw CSV. The download takes a few hundred requests and roughly 15–30 minutes.
- **Interruptions:** the download is **resumable**. Press Ctrl-C at any point and re-run the same command; finished years are skipped without any network calls.
- **Updates:** re-running later refreshes only the last 30 days, because USGS keeps revising recent events.
- **Everything:** `MIN_MAG=0` downloads every event. That is several million events, and recent years each hold more than 100k.

Running `ingest-full` after `sample` reuses the NOAA pages. `clean` merges every chunk under `data/raw`, removing duplicates by event id.

### Production

```bash
make start     # builds frontend/dist, then FastAPI serves the app and the API on :8000
```

### Tests and lint

```bash
make test      # pytest (backend) + vitest (frontend)
```

```bash
make lint      # ruff check + ruff format --check + eslint
```

## Data completeness by era (read this before drawing conclusions)

**Sparse older data reflects how earthquakes were recorded, not how often they happened.** Global seismicity has been roughly constant over this time span. What changed is our ability to detect and record earthquakes.

| Era | Years | Roughly complete above | Notes |
|---|---|---|---|
| Historical | before 1900 | — (damaging events only) | NOAA lists events that caused damage or deaths and were written down. Coverage follows literate, populated regions (the Mediterranean, the Middle East, China, Japan). Magnitudes are estimated from damage reports. Dates often lack a month or day; missing parts default to 1 January. |
| Early instrumental | 1900–1963 | ~M 6.5–7 | Few seismographs; locations and magnitudes are uncertain. |
| WWSSN / ISC | 1964–1972 | ~M 5.5 | A standardized worldwide network came online. |
| Modern | 1973– | ~M 4.5–5 globally | Dense regional networks (for example in the US and Japan) record much smaller events, so those regions look busier than places with sparse coverage. |

The app keeps this visible in three ways:
- A completeness notice sits permanently in the time bar.
- The per-year chart shades these eras.
- Events with unknown depth (most NOAA records) are drawn in grey.

Magnitudes mix scales (Mw, Ms, mb, ML and others) as reported by each source. They are not converted to a common scale.

## Using the app

- **Map:** each event is one point.
  - **Size** grows exponentially with magnitude: each magnitude step multiplies the radius by 1.8.
  - **Colour** encodes depth, from bright yellow (shallow) through orange and magenta to blue-purple (deep), with grey for unknown depth.
  - **Hover** a point for date, magnitude, depth and place. **Click** it to pin it with full details and a link to the source agency.
- **Filters (left):**
  - **Date range:** presets, a slider that gives more room to recent years, and year inputs (type −464 for 464 BCE).
  - **Magnitude**, **depth** and **source**.
  - Changes apply on the GPU immediately. The data is refetched (debounced) only when the loaded points can't answer the new filters.
- **Time bar (bottom):**
  - **Play/pause**; the space bar toggles playback.
  - **Window:** a rolling or cumulative window of 1–500 years.
  - **Speed:** 0.25–250 years per second.
  - The current period is shown large, with the number of points currently on the map.
- **Summary (right):**
  - Total matching events.
  - The strongest event; click it to fly there.
  - Events per year, grouped into multi-year bars for long ranges. Click a bar to jump the time window to that period. A table view is available.
- **Downsampling:** if more than 300,000 events match, the server returns the 300,000 strongest. The summary panel says so and shows the magnitude cutoff that was applied.

## API

All endpoints are under `/api`. `/api/events` and `/api/summary` share these filter parameters, all optional:

| Parameter | Meaning |
|---|---|
| `start`, `end` | Epoch milliseconds (UTC). `end` is exclusive. BCE dates are negative numbers. |
| `min_mag`, `max_mag` | Inclusive magnitude bounds. |
| `min_depth`, `max_depth` | Inclusive, in km. Events with unknown depth are excluded whenever either bound is set. |
| `sources` | `usgs` and/or `noaa`. Repeatable (`sources=usgs&sources=noaa`) or comma-separated. |

### `GET /api/events`

Returns an **Apache Arrow IPC stream** (`application/vnd.apache.arrow.stream`), gzipped when the client accepts it.

Columns:

| Column | Type | Notes |
|---|---|---|
| `rid` | uint32 | Stable row id; use it with `/api/events/{rid}`. |
| `time` | float64 | Epoch ms. |
| `lon`, `lat` | float32 | |
| `depth_km` | float32 | NaN = unknown. |
| `magnitude` | float32 | |
| `source` | uint8 | 0 = usgs, 1 = noaa (see `/api/meta`). |

Response headers:
- `X-Total-Count`: events matched before the cap.
- `X-Returned-Count`: rows in this payload.
- `X-Downsampled`: `0` or `1`.
- `X-Min-Mag-Returned`: smallest magnitude included, when downsampled.

Rows are ordered by descending magnitude, so small events draw on top of large ones.

### Other endpoints

| Endpoint | Returns |
|---|---|
| `GET /api/events/{rid}` | JSON: `rid, event_id, time, time_label, year, latitude, longitude, depth_km, magnitude, mag_type, place, source, url`. |
| `GET /api/summary` | JSON: `total`, `strongest` (ties go to the instrumental, then the earlier event), and `per_year: [{year, count}]`. Counts cover every matching event, not just the capped set. |
| `GET /api/meta` | JSON: time, year, magnitude and depth bounds; `sources` with codes and counts; `total`; `max_points`. |

**Caching:** `/api/events` payloads (raw and gzipped bytes) and summaries are kept in LRU caches keyed by the normalized filters.

## Data schema: `data/processed/earthquakes.parquet`

| Column | Type | Notes |
|---|---|---|
| `rid` | uint32 | Assigned in time order. |
| `event_id` | string | USGS id, or `noaa-<id>`. |
| `time` | timestamp[ms, UTC] | Can be BCE. |
| `year` | int32 | Astronomical numbering: 1 BCE = 0, 464 BCE = −463. |
| `latitude`, `longitude` | float64 | Longitude wrapped to [−180, 180]. |
| `depth_km` | float32 | Nullable. |
| `magnitude` | float32 | |
| `mag_type` | string | Nullable. |
| `place` | string | Nullable. |
| `source` | string | `usgs` or `noaa`. |

**Cleaning steps:**
- Rows missing time, location or magnitude are dropped. This removes most NOAA records, which often report only intensity: 1,493 of the 2,603 pre-1900 records.
- Coordinates outside valid ranges are dropped.
- Duplicates are removed by `event_id` (keeping the newest download), then by identical time, location and magnitude.
- NOAA rows within 60 s and 100 km of a USGS event are dropped as duplicates.

Times are handled as integer epoch milliseconds throughout. Python's `datetime` and pandas' nanosecond timestamps cannot represent BCE dates, so calendar math uses Howard Hinnant's algorithms in numpy (backend) and plain TypeScript (frontend).

## Performance

- **Compact transfer:** points are sent as columnar binary (Arrow), about 29 bytes per event before gzip. The 45k-event sample is 0.7 MB on the wire.
- **One GPU upload per dataset:** the frontend builds deck.gl binary attributes (positions, radii, colours and 4-component filter values) once per dataset. Time, magnitude, depth and source filters, and every playback frame, only change `DataFilterExtension` uniforms. Nothing is refetched or re-uploaded, so playback stays smooth.
- **Point cap:** the server caps responses at `QUAKES_MAX_POINTS` (default 300,000) by keeping the strongest events.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `QUAKES_DATA_DIR` | `./data` | Where `raw/` and `processed/` live. |
| `QUAKES_MAX_POINTS` | `300000` | Downsampling cap for `/api/events`. |
| `QUAKES_FRONTEND_DIST` | `./frontend/dist` | Static files served at `/` when present. |
| `VITE_API_BASE` | *(empty)* | API origin for the frontend. Empty means same origin; in dev, Vite proxies `/api`. |
| `VITE_API_PROXY` | `http://127.0.0.1:8000` | Where the Vite dev server proxies `/api`. |

## Project layout

```
backend/
  src/quakes/
    ingest.py      USGS (year windows, auto-split over 20k, retry/backoff, resumable) + NOAA pages
    clean.py       normalise both sources to one schema, validate, dedupe, write Parquet
    query.py       DuckDB filters, downsampling, summary, meta
    api.py         FastAPI app (Arrow responses, gzip, CORS, caching, static frontend)
    timeutil.py    BCE-safe calendar math
    cli.py         `uv run quakes sample | ingest-usgs | ingest-noaa | ingest-full | clean | serve`
  tests/           pytest: cleaning, queries, ingestion (mocked HTTP), API
frontend/
  src/components/  MapView, FilterSidebar, TimeControls, SummaryPanel, YearChart, Legend,
                   CompletenessNotice, HoverTooltip, PinnedEventCard, StatusOverlays
  src/store/       Zustand store, data sync (debounce + refetch decisions), playback loop
  src/api/         typed client, Arrow decoding
  src/lib/         scales, filters, time, bins, eras, playback, formatting (unit-tested)
data/              raw/ and processed/ (gitignored)
```

Basemap © [CARTO](https://carto.com/attributions), © OpenStreetMap contributors.
## Simulator and historical deaths

Use the **Explore history / Simulator** tabs to switch features. In Simulator,
click the map or enter coordinates, set magnitude and depth, then run a scenario.
Supported inputs are M5.0–7.9 and depths 1–70 km. It estimates effects of a
hypothetical earthquake; it does not forecast earthquake occurrence.

To enrich an existing sample and prepare the model:

```sh
cd backend
uv run quakes ingest-noaa
uv run quakes clean
uv run quakes prepare-simulator
```

Restart the API after rebuilding data or training. Generated assets stay under
the ignored `data/` directory. Root command `npm run prepare-simulator` runs the
last step. Sample and full ingestion now also fetch modern NOAA impact reports.

Historical deaths come from [NOAA NCEI](https://www.ngdc.noaa.gov/hazel/view/hazards/earthquake/search).
Modern reports enrich matching USGS events using time, distance and magnitude;
pre-1900 NOAA events retain their own counts. Missing counts remain unknown.
Approximate tolls display as ranges and are excluded from exact-count sums.
Totals include secondary hazards where NOAA supplies a total; they are incomplete
historical records, not comprehensive worldwide death totals.

Shaking uses the [Allen, Wald & Worden intensity equation](https://docs.openquake.org/oq-engine/master/manual/_modules/openquake/hazardlib/gsim/allen_2012_ipe.html).
Exposure uses [Natural Earth cities](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/).
These city populations omit rural areas, may overlap metropolitan populations,
and use modern estimates for historical training events. The trained fatality
model is conditional on reported historical impacts: missing reports are never
treated as zero. Selection bias, incomplete labels, building vulnerability,
tsunamis and local soil effects prevent calibrated forecasts. Treat its broad
fatality ranges as exploratory comparisons, not emergency-planning estimates.
Each result includes sample size, held-out metrics and model limitations.

`POST /api/simulate` accepts `{latitude, longitude, magnitude, depth_km}` and
returns shaking rings, city exposure, fatality bins, historical analogs and model
metadata. Out-of-domain inputs return 422; missing model assets return 503.
The Arrow events payload adds `deaths`: NaN unknown, nonnegative exact count,
or negative -1 through -4 for NOAA ordinal categories.
