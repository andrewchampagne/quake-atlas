# Quake Atlas: common tasks. Requires uv, Node 20+ and npm on PATH.
MIN_MAG ?= 2.5

.PHONY: help setup sample ingest-full clean-data dev build start test lint format

help:
	@echo "make setup        install backend (uv) and frontend (npm) dependencies"
	@echo "make sample       download USGS M5+ 2000-2024 + NOAA pre-1900 and build the dataset"
	@echo "make ingest-full  download USGS 1900-present (MIN_MAG=$(MIN_MAG)) + NOAA; resumable"
	@echo "make dev          run the API (:8000) and the Vite dev server (:5173) together"
	@echo "make start        build the frontend and serve everything from FastAPI on :8000"
	@echo "make test         backend pytest + frontend vitest"
	@echo "make lint         ruff + eslint"

setup:
	cd backend && uv sync
	npm install
	npm --prefix frontend install

sample:
	cd backend && uv run quakes sample

ingest-full:
	cd backend && uv run quakes ingest-full --min-mag $(MIN_MAG)

# Rebuild data/processed from whatever is in data/raw.
clean-data:
	cd backend && uv run quakes clean

dev:
	npm run dev

build:
	npm --prefix frontend run build

start: build
	cd backend && uv run uvicorn quakes.api:app --host 127.0.0.1 --port 8000

test:
	cd backend && uv run pytest
	npm --prefix frontend test

lint:
	cd backend && uv run ruff check . && uv run ruff format --check .
	npm --prefix frontend run lint

format:
	cd backend && uv run ruff format . && uv run ruff check --fix .
