"""Command-line entry point: ``uv run quakes <command>``.

Commands
--------
sample        USGS M5+ 2000-2024 + NOAA pre-1900, then clean (quick end-to-end dataset)
ingest-usgs   Download USGS ComCat for a year range and magnitude floor
ingest-noaa   Download the NOAA Significant Earthquake Database (pre-1900 by default)
ingest-full   USGS 1900-present (default M2.5+) + NOAA, then clean
clean         Rebuild data/processed/earthquakes.parquet from data/raw
serve         Run the API with uvicorn
"""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import UTC, datetime

from quakes.config import Settings


def _ingest_usgs(args: argparse.Namespace, settings: Settings) -> None:
    from quakes.ingest import ingest_usgs

    stats = ingest_usgs(args.start_year, args.end_year, args.min_mag, settings.raw_dir)
    logging.info(
        "USGS done: %d chunks downloaded, %d skipped, %d years already complete, %d requests",
        stats.chunks_downloaded,
        stats.chunks_skipped,
        stats.years_skipped,
        stats.requests,
    )


def _ingest_noaa(args: argparse.Namespace, settings: Settings) -> None:
    from quakes.ingest import ingest_noaa

    stats = ingest_noaa(
        settings.raw_dir, min_year=args.min_year, max_year=args.max_year, force=args.force
    )
    logging.info(
        "NOAA done: %d pages downloaded, %d cached, %d events",
        stats.chunks_downloaded,
        stats.chunks_skipped,
        stats.events_expected,
    )


def _clean(_args: argparse.Namespace, settings: Settings) -> None:
    from quakes.clean import run_clean

    run_clean(settings.raw_dir, settings.parquet_path)


def _sample(args: argparse.Namespace, settings: Settings) -> None:
    args.start_year, args.end_year, args.min_mag = 2000, 2024, 5.0
    args.min_year, args.max_year, args.force = -2150, 1899, False
    _ingest_usgs(args, settings)
    _ingest_noaa(args, settings)
    _clean(args, settings)


def _full(args: argparse.Namespace, settings: Settings) -> None:
    args.start_year, args.end_year = 1900, datetime.now(UTC).year
    args.min_year, args.max_year, args.force = -2150, 1899, False
    _ingest_usgs(args, settings)
    _ingest_noaa(args, settings)
    _clean(args, settings)


def _serve(args: argparse.Namespace, _settings: Settings) -> None:
    import uvicorn

    uvicorn.run("quakes.api:app", host=args.host, port=args.port, reload=args.reload)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="quakes", description=__doc__.split("\n")[0])
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("sample", help="M5+ 2000-2024 + NOAA, then clean").set_defaults(func=_sample)

    full = sub.add_parser("ingest-full", help="USGS 1900-present + NOAA, then clean")
    full.add_argument("--min-mag", type=float, default=2.5, help="magnitude floor (default 2.5)")
    full.set_defaults(func=_full)

    usgs = sub.add_parser("ingest-usgs", help="download USGS ComCat")
    usgs.add_argument("--start-year", type=int, default=2000)
    usgs.add_argument("--end-year", type=int, default=datetime.now(UTC).year)
    usgs.add_argument("--min-mag", type=float, default=5.0)
    usgs.set_defaults(func=_ingest_usgs)

    noaa = sub.add_parser("ingest-noaa", help="download NOAA significant earthquakes")
    noaa.add_argument("--min-year", type=int, default=-2150)
    noaa.add_argument("--max-year", type=int, default=1899)
    noaa.add_argument("--force", action="store_true", help="re-download cached pages")
    noaa.set_defaults(func=_ingest_noaa)

    sub.add_parser("clean", help="rebuild the processed Parquet file").set_defaults(func=_clean)

    serve = sub.add_parser("serve", help="run the API")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=_serve)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        args.func(args, Settings.from_env())
    except KeyboardInterrupt:
        logging.warning("Interrupted; re-run the same command to resume.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
