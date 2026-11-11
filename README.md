# Quake Atlas

[![CI](https://github.com/andrewchampagne/quake-atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/andrewchampagne/quake-atlas/actions/workflows/ci.yml)
[![Docker image](https://github.com/andrewchampagne/quake-atlas/actions/workflows/docker.yml/badge.svg)](https://github.com/andrewchampagne/quake-atlas/pkgs/container/quake-atlas)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey.svg)](LICENSE)

An interactive dark-themed world map of earthquakes from 2150 BCE to today, with
recorded death tolls, earthquake family trees (which quakes triggered which), a
retrospective aftershock forecast, and a "what if" earthquake simulator.

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

## Run it with Docker (macOS, Windows, Linux)

The easiest way to run Quake Atlas is the prebuilt image, which works on Intel and
Apple Silicon Macs. You only need [Docker Desktop](https://www.docker.com/products/docker-desktop/).

```bash
docker run -d --name quake-atlas -p 8000:8000 -v quake-data:/data ghcr.io/andrewchampagne/quake-atlas:latest
```

Open http://localhost:8000. On first start the container downloads the sample
catalog (USGS M5+ 2000–2024 plus NOAA records) and prepares the simulator, which
takes a few minutes; watch progress with `docker logs -f quake-atlas`. The data is
kept in the `quake-data` volume, so later starts are instant.

Or, from a clone of this repository:

```bash
docker compose up -d        # uses the prebuilt image; add --build to build it locally
```

**Options** (pass with `-e` or set them in `docker-compose.yml`):

| Variable | Default | Meaning |
|---|---|---|
| `QUAKES_DATASET` | `sample` | `full` downloads USGS from 1900 instead of the 2000–2024 sample (30+ minutes, resumable). |
| `QUAKES_MIN_MAG` | `4.5` | Magnitude floor for the `full` dataset. |
| `QUAKES_MAX_POINTS` | `300000` | Point cap before the server downsamples to the strongest events. |

To switch datasets later, remove the volume (`docker rm -f quake-atlas && docker volume rm quake-data`)
and start again. Any command can be run inside the image, for example
`docker compose run --rm quake-atlas quakes ingest-full --min-mag 4.5`.

## Local development

**Prerequisites**
- [uv](https://docs.astral.sh/uv/), which installs Python 3.12 for you.
- Node 22 or newer (Node 24 recommended) and npm.
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

End-to-end UX checks use [Playwright](https://playwright.dev/) with your installed Microsoft Edge, on desktop, tablet and phone viewports. They need the app running with the sample data (`make dev`), so they are not part of CI:

```bash
npm --prefix frontend run e2e            # flows: one date control, filter chips, deep links, playback, no sideways scroll
```

```bash
npm --prefix frontend run e2e:screens    # also writes review screenshots to frontend/e2e/screens/
```

## Data sources and licences

| Data | Source | Terms |
|---|---|---|
| Earthquakes since 1900 | [USGS ComCat](https://earthquake.usgs.gov/fdsnws/event/1/) | U.S. Government work, public domain |
| Historical earthquakes and death tolls | [NOAA NCEI Significant Earthquake Database](https://www.ncei.noaa.gov/products/natural-hazards/tsunamis-earthquakes-volcanoes/earthquakes) | U.S. Government work, public domain |
| City populations and country income groups | [Natural Earth](https://www.naturalearthdata.com/) | Public domain |
| Basemap tiles | [CARTO](https://carto.com/attributions) Dark Matter, data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors | Free with attribution (shown on the map) |
| Place search | [Photon](https://photon.komoot.io/) by komoot, data © OpenStreetMap contributors (ODbL) | Free fair-use API with attribution (shown in the results) |

Downloaded data is never committed: `data/` is gitignored and is rebuilt by the
ingest commands.

## Data completeness by era (read this before drawing conclusions)

**Sparse older data reflects how earthquakes were recorded, not how often they happened.** Global seismicity has been roughly constant over this time span. What changed is our ability to detect and record earthquakes.

| Era | Years | Roughly complete above | Notes |
|---|---|---|---|
| Historical | before 1900 | — (damaging events only) | NOAA lists events that caused damage or deaths and were written down. Coverage follows literate, populated regions (the Mediterranean, the Middle East, China, Japan). Magnitudes are estimated from damage reports. Dates often lack a month or day; missing parts default to 1 January. |
| Early instrumental | 1900–1963 | ~M 6.5–7 | Few seismographs; locations and magnitudes are uncertain. |
| WWSSN / ISC | 1964–1972 | ~M 5.5 | A standardized worldwide network came online. |
| Modern | 1973– | ~M 4.5–5 globally | Dense regional networks (for example in the US and Japan) record much smaller events, so those regions look busier than places with sparse coverage. |

The app keeps this visible in three ways:
- The timeline shades these eras behind its events-per-year track, and its ⓘ button (and the **?** dialog) explains them.
- The track uses a log scale, so sparse historical eras read as sparse records rather than as empty time.
- Events with unknown depth (most NOAA records) are drawn in grey.

Magnitudes mix scales (Mw, Ms, mb, ML and others) as reported by each source. They are not converted to a common scale.

## Using the app

The map fills the screen; each job has one place around it.

- **Map:** each event is one point.
  - **Size** grows with magnitude (each step multiplies the radius by 1.8); **colour** shows depth, from yellow (shallow) through orange and magenta to blue-purple (deep), grey for unknown.
  - **Hover** for a quick summary; **click** to select it.
- **Timeline (bottom)** is the only place that controls time.
  - The track shows events per year over the whole catalog, with shaded catalog eras. It stretches recent years, where most records are, and uses a log scale so sparse historical eras stay visible.
  - Drag its two handles to choose the date range, or click the period label to type years and pick presets (type −464 for 464 BCE).
  - Click a bar to show just that period. **Play** sweeps a window through the range; drag the window to scrub, and ⚙ sets its length, speed and whether earlier years accumulate. **Show all years** (or Esc) clears it.
  - ⓘ explains why older eras look sparse.
- **Filters (top left):** magnitude, depth, sources and *Hide foreshocks and aftershocks*, each with quick presets. Active filters appear as chips beside the button; click a chip to remove it.
- **Inspector (right; a bottom sheet on phones):**
  - With nothing selected: how many earthquakes are shown, recorded deaths, the strongest and deadliest events, the largest earthquake families and an *Events by period* table.
  - With an earthquake selected: its details and source link, plus **Family** (generations, the parent/child tree and how families are found) and, for M6.5+ mainshocks, **Forecast** tabs. The tab you pick stays open as you move between events. Hide the panel with the › button.
- **Shareable links:** the address bar always holds the current filters, window, selected earthquake and tab (for example `#/explore?y=2000..2024&e=21169&tab=family`). Reloading restores the view, and Back undoes a selection.
- **Keyboard:** Space plays or pauses, ← → step the window, Esc deselects and then shows all years. The **?** button lists these, explains catalog completeness and credits the data.
- **Downsampling:** if more than 300,000 events match, the server returns the 300,000 strongest and the inspector says so, with the magnitude cutoff.

Filter changes apply on the GPU immediately; data is refetched (debounced) only when the loaded points can't answer the new filters.

## API

All endpoints are under `/api`. `/api/events` and `/api/summary` share these filter parameters, all optional:

| Parameter | Meaning |
|---|---|
| `start`, `end` | Epoch milliseconds (UTC). `end` is exclusive. BCE dates are negative numbers. |
| `min_mag`, `max_mag` | Inclusive magnitude bounds. |
| `min_depth`, `max_depth` | Inclusive, in km. Events with unknown depth are excluded whenever either bound is set. |
| `sources` | `usgs` and/or `noaa`. Repeatable (`sources=usgs&sources=noaa`) or comma-separated. |
| `declustered` | `true` drops foreshocks and aftershocks, keeping mainshocks, independent events and unclassified NOAA records. |

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
| `deaths` | float32 | See [Simulator and historical deaths](#simulator-and-historical-deaths). |
| `role` | uint8 | Family role: 0 not classified, 1 independent, 2 mainshock, 3 foreshock, 4 aftershock. |

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
| `GET /api/meta` | JSON: time, year, magnitude and depth bounds; `sources` with codes and counts; `total`; `max_points`; `families_ready`. |
| `GET /api/families/stats` | JSON: clustering parameters, threshold, role counts, the nearest-neighbour density histogram and the largest families. |
| `GET /api/families/{rid}` | JSON: the event's role, nearest-neighbour link, generation counts and family members as parallel columns (at most 5,000; the strongest are kept). |
| `GET /api/families/{rid}/forecast` | JSON: Omori–Utsu fit for the family's mainshock (M6.5+). `fit_days` (default 3) and `horizon_days` (default 365) set the windows. |

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
    query.py       DuckDB filters, downsampling, summary, meta, family queries
    families.py    nearest-neighbour clustering into foreshock/mainshock/aftershock families
    aftershocks.py Omori-Utsu fitting and the retrospective aftershock forecast
    api.py         FastAPI app (Arrow responses, gzip, CORS, caching, static frontend)
    timeutil.py    BCE-safe calendar math
    cli.py         `uv run quakes sample | ingest-usgs | ingest-noaa | ingest-full | clean | build-families | serve`
  tests/           pytest: cleaning, queries, ingestion (mocked HTTP), API
frontend/
  src/components/  MapView, Legend, HoverTooltip, HelpDialog, StatusOverlays, FamilyTree,
                   AftershockForecast, ProximityPlot
    timeline/      Timeline, TimelineTrack, DateRangeEditor, PlaybackSettings, EraInfo
    filters/       FilterBar (popover + chips)
    inspector/     Inspector (column / phone sheet), OverviewPanel, EventPanel, FamilyTab
    ui/            Radix popover wrapper, icons
  src/store/       Zustand store, data sync, URL hash sync, playback loop and shortcuts
  src/api/         typed client, Arrow decoding
  src/lib/         scales, filters, URL state, timeline bins, time, eras, playback (unit-tested)
  e2e/             Playwright UX tests and review screenshots
data/              raw/ and processed/ (gitignored)
```

Basemap © [CARTO](https://carto.com/attributions), © OpenStreetMap contributors.
## Simulator and historical deaths

Use the **Explore history / Simulator** tabs to switch features. In Simulator,
search for a place, click the map or enter coordinates, set magnitude and depth,
then run a scenario. Magnitudes from M4.0 to M9.5 and depths from 1 to 70 km are
accepted. The shaking equation was fitted to M5.0–7.9, so other magnitudes are
extrapolated: the app labels them, and the results list why. Above M7.9 the
exposure area grows from 300 km to as much as 1,000 km (at M9.5), because great
earthquakes are felt much further away; a circular footprint still understates
shaking along a long rupture. It estimates effects of a hypothetical
earthquake; it does not forecast earthquake occurrence.

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

## Earthquake families

Large earthquakes trigger aftershocks, aftershocks trigger their own, and
sometimes a quake turns out to have been a foreshock of something bigger. Quake
Atlas groups every instrumental (USGS) event into **families** with the
nearest-neighbour method of [Zaliapin & Ben-Zion (2013)](https://doi.org/10.1002/jgrb.50179):

1. For each event, every earlier event gets a proximity
   `η = t · r^1.6 · 10^(−m)`: time apart in years, epicentral distance in km
   (floored at 1 km) and the earlier event's magnitude. Bigger earthquakes reach
   further in time and space.
2. The earlier event with the smallest η is the event's candidate parent.
3. `log10 η` has two modes: triggered pairs sit orders of magnitude below
   independent "background" events. A two-component Gaussian mixture places the
   threshold between them (log10 η ≈ −5.75 for the sample catalog).
4. Links below the threshold join events into trees. The largest event in a tree
   is its **mainshock**, earlier members are **foreshocks**, later ones
   **aftershocks**; events with no link are **independent**.

```sh
cd backend
uv run quakes build-families            # about 10 s for the 44k-event sample
uv run quakes build-families --min-mag 4.5
```

`clean`, `sample` and `ingest-full` rebuild the families automatically (row ids
change with every clean). The result is `data/processed/families.parquet`; the
API ignores it, with a warning, if it was built for a different catalog. The
search is exact without comparing every pair: it only evaluates pairs whose
proximity could fall below a cap (log10 η < −1.5) and finds them shell by shell
in distance, using either a time window or a KD-tree, whichever is smaller. The
tests check it against brute force.

**In the app:**
- Select an event: the inspector says whether it is a mainshock, foreshock,
  aftershock or independent, and lines on the map join every family member to
  its parent. The bright chain runs from the family's first event to the
  selected one. Links follow the playback window.
- The **Family** tab shows event counts, generations, a collapsible parent/child
  tree (click to select) and *How families are found*, which plots the two
  populations in rescaled time and distance with the threshold line.
- **Hide foreshocks and aftershocks** (Filters) shows a declustered catalog:
  about a third of the sample's instrumental events disappear, and the timeline
  shows background seismicity. The largest families are listed in the overview.

**Retrospective aftershock forecast.** For families with an M6.5+ mainshock, the
panel fits the Omori–Utsu law `λ(t) = K / (t + c)^p` (maximum likelihood with K
profiled out) to the first 1, 3, 7 or 30 days of aftershocks, forecasts the
count up to 30 days, 1 year or 3 years, and compares it with what the catalog
recorded. With fewer than 20 aftershocks to fit, p and c are fixed at the
generic values of Reasenberg & Jones (1989). The 95% band covers Poisson
randomness only.

**Caveats:**
- Families depend on the catalog. Events below the magnitude floor are missing,
  so sparse regions look more independent.
- Catalogs miss many early aftershocks right after big mainshocks. Fits to the
  first days can therefore overstate how fast a sequence decays. In the sample,
  Tohoku's 3-day fit forecasts 93 aftershocks for the rest of its first year
  (95%: 75–113); the catalog recorded 310.
- An Omori fit ignores secondary sequences, which ETAS models describe.
- The forecast is a teaching tool that uses hindsight data, not an operational
  forecast.

## License

The code is released under the [MIT License](LICENSE). Data and map tiles keep the
terms of their sources listed above.
