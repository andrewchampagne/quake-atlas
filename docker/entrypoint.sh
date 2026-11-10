#!/bin/sh
# Container entrypoint.
#
# With no arguments: make sure a dataset exists in $QUAKES_DATA_DIR (downloading
# it on first run), prepare the simulator, then start the server.
# With arguments: run them instead, e.g.
#   docker compose run --rm quake-atlas quakes ingest-full --min-mag 4.5
set -eu

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

DATA="${QUAKES_DATA_DIR:-/data}"
DATASET="${QUAKES_DATASET:-sample}"

if [ ! -f "$DATA/processed/earthquakes.parquet" ]; then
  if [ "$DATASET" = "full" ]; then
    echo "First run: downloading the full catalog (USGS 1900-present, M${QUAKES_MIN_MAG:-4.5}+, plus NOAA)."
    echo "This can take 30+ minutes; it resumes if interrupted."
    quakes ingest-full --min-mag "${QUAKES_MIN_MAG:-4.5}"
  else
    echo "First run: downloading the sample catalog (USGS M5+ 2000-2024 plus NOAA)."
    echo "This takes a few minutes; later starts reuse the /data volume."
    quakes sample
  fi
fi

if [ ! -f "$DATA/processed/fatality_model.joblib" ]; then
  echo "Preparing the simulator (city populations + scenario model)..."
  quakes prepare-simulator || echo "Simulator setup failed; the explorer still works. Restart the container to retry."
fi

echo "Quake Atlas is ready on http://localhost:${PORT:-8000}"
exec uvicorn quakes.api:app --host 0.0.0.0 --port "${PORT:-8000}" --proxy-headers
